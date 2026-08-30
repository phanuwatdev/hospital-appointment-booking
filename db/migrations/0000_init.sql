-- =============================================================================
-- Appointment Booking Module — initial schema
--
-- หลักการออกแบบ 3 ข้อ:
--   1. กฎที่ห้ามละเมิดเด็ดขาด บังคับที่ระดับฐานข้อมูล ไม่ใช่ที่ application
--      (โดยเฉพาะการจองซ้อนเวลา ซึ่ง application ป้องกันเองไม่ได้ 100%)
--   2. ไม่มีการลบข้อมูลถาวร ทุกอย่างเปลี่ยนสถานะ + เก็บผู้กระทำและเวลาไว้
--   3. ตารางเวรเก็บเป็น template รายสัปดาห์ ไม่ generate เป็นแถวรายวันล่วงหน้า
--
-- เวลาทั้งหมดเก็บเป็น timestamptz. เวลาในตารางเวรเก็บเป็น time (เวลาท้องถิ่น)
-- และตีความด้วย timezone ของโรงพยาบาล = Asia/Bangkok
-- =============================================================================

BEGIN;

-- btree_gist จำเป็นสำหรับการรวมคอลัมน์ปกติ (uuid, smallint) เข้ากับ range
-- ในหนึ่ง exclusion constraint. เป็น trusted extension ติดตั้งได้โดยไม่ต้องเป็น superuser
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
-- Postgres ไม่มี range type สำหรับ `time` มาให้ จึงสร้างเอง
-- ใช้กับ: ช่วงเวลาพัก และช่วงเวลาออกตรวจในตารางเวร
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION time_subtype_diff(x time, y time)
RETURNS float8
LANGUAGE sql IMMUTABLE STRICT
AS $$ SELECT EXTRACT(EPOCH FROM (x - y)) $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'timerange') THEN
    CREATE TYPE timerange AS RANGE (
      subtype      = time,
      subtype_diff = time_subtype_diff
    );
  END IF;
END $$;

-- =============================================================================
-- Master data
-- =============================================================================

CREATE TABLE departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  name_th    text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doctors (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  full_name             text NOT NULL,
  license_no            text UNIQUE,
  primary_department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE patients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hn            text NOT NULL UNIQUE,          -- Hospital Number
  full_name     text NOT NULL,
  date_of_birth date,
  phone         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ในระบบจริงตารางนี้จะผูกกับระบบ authentication ของโรงพยาบาล
-- ที่นี่ทำเป็น stub เพื่อให้บันทึกได้ว่า "ใครเป็นคนจอง / ใครเป็นคนยกเลิก"
CREATE TABLE staff_users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username   text NOT NULL UNIQUE,
  full_name  text NOT NULL,
  role       text NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'admin')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- ประเภทการนัด — duration/buffer เก็บเป็นข้อมูล ไม่ hardcode ในโค้ด
-- เพื่อให้ admin ปรับได้โดยไม่ต้อง deploy ใหม่
--
-- buffer_after_min = เวลาที่บล็อกไว้หลังจบการตรวจ (เตรียมห้อง/ทำความสะอาด)
-- คนไข้จะเห็นแค่ช่วง duration แต่ระบบกันเวลาไว้ duration + buffer
-- -----------------------------------------------------------------------------
CREATE TABLE appointment_types (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE
                      CHECK (code IN ('NEW_PATIENT', 'FOLLOW_UP', 'CONSULTATION', 'PROCEDURE')),
  name              text NOT NULL,
  name_th           text,
  duration_min      int  NOT NULL CHECK (duration_min > 0 AND duration_min % 5 = 0),
  buffer_after_min  int  NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
  min_lead_time_min int  NOT NULL DEFAULT 30  CHECK (min_lead_time_min >= 0),
  max_advance_days  int  NOT NULL DEFAULT 90  CHECK (max_advance_days > 0),
  is_active         boolean NOT NULL DEFAULT true,
  sort_order        int NOT NULL DEFAULT 0
);

-- =============================================================================
-- ตารางเวรแพทย์
-- =============================================================================

CREATE TABLE doctor_schedules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id         uuid NOT NULL REFERENCES doctors(id)     ON DELETE RESTRICT,
  department_id     uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,

  -- 0 = อาทิตย์ ... 6 = เสาร์ (ตรงกับ EXTRACT(DOW) ของ Postgres และ Date.getDay() ของ JS)
  day_of_week       smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time        time NOT NULL,
  end_time          time NOT NULL,

  -- ระยะห่างของ slot ที่เสนอให้เลือก (นาที) ค่าเริ่มต้น 15 นาที
  slot_interval_min int NOT NULL DEFAULT 15 CHECK (slot_interval_min > 0),

  -- false = ออกตรวจแต่ไม่เปิดรับนัดล่วงหน้า (เช่น คลินิก walk-in อย่างเดียว)
  accepts_booking   boolean NOT NULL DEFAULT true,

  -- ช่วงที่ตารางเวรนี้มีผล — ทำให้แก้ตารางเวรได้โดยไม่กระทบนัดในอดีต
  valid_from        date NOT NULL DEFAULT CURRENT_DATE,
  valid_to          date,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  shift_range       timerange GENERATED ALWAYS AS (timerange(start_time, end_time, '[)')) STORED,
  validity          daterange GENERATED ALWAYS AS (daterange(valid_from, valid_to, '[]')) STORED,

  CONSTRAINT schedule_time_order  CHECK (end_time > start_time),
  CONSTRAINT schedule_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from),

  -- แพทย์คนเดียวกันจะมีตารางเวรที่ทับเวลากันในวันเดียวกันไม่ได้
  -- (ป้องกันข้อมูล master ที่ขัดแย้งกันเอง ซึ่งจะทำให้การหา slot ได้ผลลัพธ์ซ้ำซ้อน)
  CONSTRAINT schedule_no_self_overlap EXCLUDE USING gist (
    doctor_id   WITH =,
    day_of_week WITH =,
    validity    WITH &&,
    shift_range WITH &&
  )
);

CREATE INDEX idx_schedules_lookup ON doctor_schedules (doctor_id, day_of_week);

-- -----------------------------------------------------------------------------
-- เวลาพัก — หนึ่งตารางเวรมีได้หลายช่วงพัก (พักเที่ยง + พักเบรก)
-- -----------------------------------------------------------------------------
CREATE TABLE schedule_breaks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES doctor_schedules(id) ON DELETE CASCADE,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  label       text NOT NULL DEFAULT 'พักกลางวัน',

  break_range timerange GENERATED ALWAYS AS (timerange(start_time, end_time, '[)')) STORED,

  CONSTRAINT break_time_order CHECK (end_time > start_time),
  CONSTRAINT break_no_overlap EXCLUDE USING gist (
    schedule_id WITH =,
    break_range WITH &&
  )
);

CREATE INDEX idx_breaks_schedule ON schedule_breaks (schedule_id);

-- -----------------------------------------------------------------------------
-- ข้อยกเว้นรายวัน — วันลา / วันหยุดนักขัตฤกษ์ / วันที่ออกตรวจเวลาพิเศษ
--
-- ไม่ได้อยู่ในโจทย์โดยตรง แต่โรงพยาบาลจริงขาดไม่ได้:
-- ถ้าไม่มีตารางนี้ ระบบจะเสนอ slot ในวันที่แพทย์ลาพักร้อน
-- -----------------------------------------------------------------------------
CREATE TABLE schedule_exceptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id      uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('DAY_OFF', 'CUSTOM_HOURS')),
  start_time     time,
  end_time       time,
  reason         text,
  created_by     uuid REFERENCES staff_users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (doctor_id, exception_date),

  CONSTRAINT exception_hours_consistent CHECK (
    (kind = 'DAY_OFF'      AND start_time IS NULL AND end_time IS NULL)
    OR
    (kind = 'CUSTOM_HOURS' AND start_time IS NOT NULL AND end_time IS NOT NULL
                           AND end_time > start_time)
  )
);

CREATE INDEX idx_exceptions_lookup ON schedule_exceptions (doctor_id, exception_date);

-- =============================================================================
-- การนัดหมาย
-- =============================================================================

CREATE SEQUENCE appointment_no_seq;

CREATE TABLE appointments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- เลขที่ใบนัดสำหรับสื่อสารกับคนไข้ (uuid ไม่เหมาะจะให้คนอ่าน/พูดทางโทรศัพท์)
  appointment_no text NOT NULL UNIQUE
                   DEFAULT 'APT-' || to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD')
                        || '-' || lpad(nextval('appointment_no_seq')::text, 4, '0'),

  patient_id          uuid NOT NULL REFERENCES patients(id)          ON DELETE RESTRICT,
  doctor_id           uuid NOT NULL REFERENCES doctors(id)           ON DELETE RESTRICT,
  department_id       uuid NOT NULL REFERENCES departments(id)       ON DELETE RESTRICT,
  appointment_type_id uuid NOT NULL REFERENCES appointment_types(id) ON DELETE RESTRICT,

  -- starts_at / ends_at  = ช่วงเวลาที่คนไข้เห็นบนใบนัด
  -- blocks_until         = ends_at + buffer ของประเภทนัด (เวลาที่กันไว้จริง)
  -- ทั้งสามค่าคำนวณฝั่ง server เสมอ ห้ามรับจาก client
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  blocks_until timestamptz NOT NULL,

  status text NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show')),

  reason text,
  notes  text,

  created_by uuid NOT NULL REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- optimistic locking กัน lost update เวลามีคนแก้นัดเดียวกันพร้อมกัน
  version int NOT NULL DEFAULT 1,

  -- กันการสร้างซ้ำจากการกดปุ่มรัว หรือ client retry หลัง network timeout
  idempotency_key text,

  cancelled_at        timestamptz,
  cancelled_by        uuid REFERENCES staff_users(id),
  cancellation_reason text,

  -- ตามรอยได้ว่านัดนี้เกิดจากการเลื่อนนัดใบไหน
  rescheduled_from_id uuid REFERENCES appointments(id) ON DELETE SET NULL,

  -- ช่วงที่กันเวลาแพทย์ไว้จริง (รวม buffer)
  occupied_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, blocks_until, '[)')) STORED,
  -- ช่วงที่คนไข้ต้องอยู่จริง (ไม่รวม buffer เพราะ buffer เป็นเวลาเตรียมห้อง ไม่ใช่เวลาคนไข้)
  clinical_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,

  CONSTRAINT appt_time_order       CHECK (ends_at > starts_at),
  CONSTRAINT appt_buffer_after_end CHECK (blocks_until >= ends_at),

  -- โจทย์ข้อ 7: การยกเลิกต้องบันทึกเหตุผล ผู้ยกเลิก และเวลา — บังคับที่ DB
  -- ทำให้เป็นไปไม่ได้ที่จะมีนัดสถานะ cancelled โดยไม่มีข้อมูลกำกับ
  CONSTRAINT appt_cancellation_complete CHECK (
    (status = 'cancelled'
       AND cancelled_at IS NOT NULL
       AND cancelled_by IS NOT NULL
       AND cancellation_reason IS NOT NULL)
    OR
    (status <> 'cancelled'
       AND cancelled_at IS NULL
       AND cancelled_by IS NULL
       AND cancellation_reason IS NULL)
  ),

  -- ===========================================================================
  -- หัวใจของโมดูลนี้
  --
  -- ปัญหา: การ SELECT เช็คก่อนแล้วค่อย INSERT เป็น race condition (TOCTOU)
  -- ถ้าเจ้าหน้าที่สองคนกดจอง slot เดียวกันห่างกันไม่กี่มิลลิวินาที
  -- ทั้งคู่จะเห็นว่าว่างและ INSERT สำเร็จทั้งคู่ — แพทย์มีคนไข้สองคนพร้อมกัน
  -- transaction แบบ READ COMMITTED ไม่ช่วย เพราะแถวที่ยังไม่ถูก insert
  -- ไม่มีอะไรให้ล็อก
  --
  -- ทางแก้: ให้ Postgres ปฏิเสธเองที่ระดับ storage engine
  -- ต่อให้ยิงพร้อมกันกี่ request ก็ผ่านได้แค่ตัวเดียว ที่เหลือได้ SQLSTATE 23P01
  -- ซึ่ง application map เป็น HTTP 409
  --
  -- WHERE clause ทำให้นัดที่ยกเลิกแล้วไม่กินที่ — slot กลับมาว่างอัตโนมัติ
  -- โดยไม่ต้องมีโค้ดพิเศษใดๆ (ตอบโจทย์ข้อ 6 และ 7 ในตัว)
  --
  -- ขอบเขต '[)' สำคัญ: นัด 09:00–09:30 กับ 09:30–10:00 ต้องไม่ถือว่าชนกัน
  -- ===========================================================================
  CONSTRAINT appt_no_doctor_overlap EXCLUDE USING gist (
    doctor_id      WITH =,
    occupied_range WITH &&
  ) WHERE (status IN ('booked', 'checked_in', 'in_progress', 'completed', 'no_show')),

  -- คนไข้หนึ่งคนก็อยู่สองที่พร้อมกันไม่ได้เช่นกัน (ข้อที่มักถูกลืม)
  CONSTRAINT appt_no_patient_overlap EXCLUDE USING gist (
    patient_id     WITH =,
    clinical_range WITH &&
  ) WHERE (status IN ('booked', 'checked_in', 'in_progress', 'completed', 'no_show'))
);

CREATE UNIQUE INDEX idx_appt_idempotency
  ON appointments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_appt_patient   ON appointments (patient_id, starts_at DESC);
CREATE INDEX idx_appt_doctor_day ON appointments (doctor_id, starts_at);
CREATE INDEX idx_appt_active     ON appointments (starts_at) WHERE status = 'booked';
CREATE INDEX idx_appt_no         ON appointments (appointment_no);

-- =============================================================================
-- Trigger: อัปเดต updated_at และเดิน version อัตโนมัติ
-- ทำให้ optimistic locking ฝั่ง application ใช้ได้โดยไม่ต้องจำเอง:
--   UPDATE appointments SET ... WHERE id = $1 AND version = $2
--   → ถ้า rowCount = 0 แปลว่ามีคนอื่นแก้ไปแล้ว ตอบ 409
-- =============================================================================
CREATE OR REPLACE FUNCTION touch_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version    := OLD.version + 1;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_appointments_touch
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION touch_row();

COMMIT;
