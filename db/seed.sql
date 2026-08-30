-- =============================================================================
-- Seed data
--
-- UUID ทุกตัวเป็นค่าคงที่ที่อ่านได้ด้วยตา เพื่อให้ Postman collection และ
-- docs/api.http อ้างถึงได้โดยตรงโดยไม่ต้อง query หา id ก่อน
--
--   departments  1111...
--   doctors      2222...
--   patients     3333...
--   staff        4444...
--
-- วันที่ของนัดตัวอย่างอิงจาก "วันจันทร์ถัดไป" เสมอ ดังนั้นข้อมูล seed
-- จะอยู่ในอนาคตไม่ว่าจะรันวันไหน — คนตรวจจะไม่เจอตารางว่างเปล่า
--
-- รันซ้ำได้ (idempotent): ล้างข้อมูลธุรกรรมก่อนเสมอ
-- =============================================================================

BEGIN;

TRUNCATE appointments, schedule_exceptions, schedule_breaks,
         doctor_schedules, appointment_types, patients, doctors,
         departments, staff_users
  RESTART IDENTITY CASCADE;

ALTER SEQUENCE appointment_no_seq RESTART WITH 1;

-- -----------------------------------------------------------------------------
-- Helper: วันจันทร์ถัดไป (ISODOW 1 = จันทร์, 7 = อาทิตย์)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_next_monday() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (
    CURRENT_DATE
    + (((8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int) % 7)
       + CASE WHEN EXTRACT(ISODOW FROM CURRENT_DATE)::int = 1 THEN 7 ELSE 0 END)
  )::date
$$;

-- -----------------------------------------------------------------------------
-- Helper: สร้างนัดโดยให้ระบบคำนวณ ends_at / blocks_until จากประเภทนัด
-- (ตรรกะเดียวกับที่ service layer ทำ)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_book(
  p_patient uuid, p_doctor uuid, p_type text, p_start timestamptz, p_reason text
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO appointments (
    patient_id, doctor_id, department_id, appointment_type_id,
    starts_at, ends_at, blocks_until, reason, created_by
  )
  SELECT p_patient, p_doctor, d.primary_department_id, t.id,
         p_start,
         p_start + make_interval(mins => t.duration_min),
         p_start + make_interval(mins => t.duration_min + t.buffer_after_min),
         p_reason,
         '44444444-4444-4444-4444-444444444401'
  FROM doctors d, appointment_types t
  WHERE d.id = p_doctor AND t.code = p_type;
$$;

-- =============================================================================
-- Departments
-- =============================================================================
INSERT INTO departments (id, code, name, name_th) VALUES
  ('11111111-1111-1111-1111-111111111101', 'IM',   'Internal Medicine', 'อายุรกรรม'),
  ('11111111-1111-1111-1111-111111111102', 'ORTHO','Orthopedics',       'ศัลยกรรมกระดูก'),
  ('11111111-1111-1111-1111-111111111103', 'PEDS', 'Pediatrics',        'กุมารเวชกรรม'),
  ('11111111-1111-1111-1111-111111111104', 'CARDIO','Cardiology',       'อายุรกรรมหัวใจ');

-- =============================================================================
-- Staff
-- =============================================================================
INSERT INTO staff_users (id, username, full_name, role) VALUES
  ('44444444-4444-4444-4444-444444444401', 'somchai.n', 'สมชาย นิลรัตน์',   'staff'),
  ('44444444-4444-4444-4444-444444444402', 'kanya.p',   'กัญญา พงษ์ไพศาล', 'staff'),
  ('44444444-4444-4444-4444-444444444403', 'admin',     'ผู้ดูแลระบบ',      'admin');

-- =============================================================================
-- Doctors
-- =============================================================================
INSERT INTO doctors (id, code, full_name, license_no, primary_department_id) VALUES
  ('22222222-2222-2222-2222-222222222201', 'D001', 'นพ. อนันต์ วรวิทย์',    'MD-10001', '11111111-1111-1111-1111-111111111101'),
  ('22222222-2222-2222-2222-222222222202', 'D002', 'พญ. ปิยะดา ศรีสุวรรณ',  'MD-10002', '11111111-1111-1111-1111-111111111101'),
  ('22222222-2222-2222-2222-222222222203', 'D003', 'นพ. ธนวัฒน์ เกียรติกุล','MD-10003', '11111111-1111-1111-1111-111111111102'),
  ('22222222-2222-2222-2222-222222222204', 'D004', 'พญ. มนัสนันท์ ใจดี',    'MD-10004', '11111111-1111-1111-1111-111111111103'),
  ('22222222-2222-2222-2222-222222222205', 'D005', 'นพ. ศุภชัย ทองแท้',     'MD-10005', '11111111-1111-1111-1111-111111111104');

-- =============================================================================
-- Patients
-- =============================================================================
INSERT INTO patients (id, hn, full_name, date_of_birth, phone) VALUES
  ('33333333-3333-3333-3333-333333333301', 'HN000001', 'วิชัย มั่นคง',     '1968-03-12', '081-234-5678'),
  ('33333333-3333-3333-3333-333333333302', 'HN000002', 'สุนีย์ แสงทอง',    '1975-11-02', '082-345-6789'),
  ('33333333-3333-3333-3333-333333333303', 'HN000003', 'ณัฐพล จันทร์เพ็ญ', '1990-06-25', '083-456-7890'),
  ('33333333-3333-3333-3333-333333333304', 'HN000004', 'ด.ช. ปกรณ์ สุขใจ', '2018-01-09', '084-567-8901'),
  ('33333333-3333-3333-3333-333333333305', 'HN000005', 'อารีย์ พูนผล',     '1955-08-30', '085-678-9012');

-- =============================================================================
-- Appointment types
--
-- สมมติฐานเรื่องระยะเวลา (อธิบายไว้ใน README):
--   NEW_PATIENT  30 นาที — ต้องซักประวัติและลงทะเบียนใหม่
--   FOLLOW_UP    15 นาที — ติดตามอาการและปรับยา ใช้เวลาสั้นที่สุด
--   CONSULTATION 30 นาที — ปรึกษาเฉพาะทาง มีการอธิบายทางเลือกการรักษา
--   PROCEDURE    60 นาที + buffer 15 นาที — ต้องเตรียมและทำความสะอาดห้องหัตถการ
--                และต้องจองล่วงหน้าอย่างน้อย 1 วัน เพื่อเตรียมอุปกรณ์
-- =============================================================================
INSERT INTO appointment_types
  (id, code, name, name_th, duration_min, buffer_after_min, min_lead_time_min, max_advance_days, sort_order) VALUES
  ('55555555-5555-5555-5555-555555555501', 'NEW_PATIENT',  'New patient visit', 'ผู้ป่วยใหม่',   30,  0,   30, 90, 1),
  ('55555555-5555-5555-5555-555555555502', 'FOLLOW_UP',    'Follow-up visit',   'นัดติดตามอาการ', 15,  0,   30, 90, 2),
  ('55555555-5555-5555-5555-555555555503', 'CONSULTATION', 'Consultation',      'ปรึกษาแพทย์',   30,  0,   30, 90, 3),
  ('55555555-5555-5555-5555-555555555504', 'PROCEDURE',    'Procedure',         'หัตถการ',       60, 15, 1440, 60, 4);

-- =============================================================================
-- Doctor schedules
-- =============================================================================

-- D001 — จันทร์ถึงศุกร์ 09:00–16:00 พักเที่ยง 12:00–13:00
INSERT INTO doctor_schedules (id, doctor_id, department_id, day_of_week, start_time, end_time)
SELECT ('66666666-0001-0000-0000-00000000000' || dow)::uuid,
       '22222222-2222-2222-2222-222222222201',
       '11111111-1111-1111-1111-111111111101',
       dow, '09:00', '16:00'
FROM generate_series(1, 5) AS dow;

INSERT INTO schedule_breaks (schedule_id, start_time, end_time, label)
SELECT id, '12:00', '13:00', 'พักกลางวัน'
FROM doctor_schedules WHERE doctor_id = '22222222-2222-2222-2222-222222222201';

-- D002 — จันทร์ พุธ ศุกร์ ช่วงบ่ายถึงค่ำ 13:00–20:00 พักเบรก 16:00–16:30
INSERT INTO doctor_schedules (id, doctor_id, department_id, day_of_week, start_time, end_time)
SELECT ('66666666-0002-0000-0000-00000000000' || dow)::uuid,
       '22222222-2222-2222-2222-222222222202',
       '11111111-1111-1111-1111-111111111101',
       dow, '13:00', '20:00'
FROM unnest(ARRAY[1, 3, 5]) AS dow;

INSERT INTO schedule_breaks (schedule_id, start_time, end_time, label)
SELECT id, '16:00', '16:30', 'พักเบรก'
FROM doctor_schedules WHERE doctor_id = '22222222-2222-2222-2222-222222222202';

-- D003 — อังคาร พฤหัส เช้าอย่างเดียว 08:00–12:00 ไม่มีพัก
INSERT INTO doctor_schedules (id, doctor_id, department_id, day_of_week, start_time, end_time)
SELECT ('66666666-0003-0000-0000-00000000000' || dow)::uuid,
       '22222222-2222-2222-2222-222222222203',
       '11111111-1111-1111-1111-111111111102',
       dow, '08:00', '12:00'
FROM unnest(ARRAY[2, 4]) AS dow;

-- D004 — จันทร์ถึงศุกร์ 09:00–17:00 พักเที่ยง
INSERT INTO doctor_schedules (id, doctor_id, department_id, day_of_week, start_time, end_time)
SELECT ('66666666-0004-0000-0000-00000000000' || dow)::uuid,
       '22222222-2222-2222-2222-222222222204',
       '11111111-1111-1111-1111-111111111103',
       dow, '09:00', '17:00'
FROM generate_series(1, 5) AS dow;

INSERT INTO schedule_breaks (schedule_id, start_time, end_time, label)
SELECT id, '12:00', '13:00', 'พักกลางวัน'
FROM doctor_schedules WHERE doctor_id = '22222222-2222-2222-2222-222222222204';

-- D004 — เสาร์ 09:00–12:00 ออกตรวจ แต่ *ไม่เปิดรับนัดล่วงหน้า* (walk-in only)
-- ใช้ทดสอบกฎ "Booking into an unavailable schedule" ของโจทย์ข้อ 5
INSERT INTO doctor_schedules
  (id, doctor_id, department_id, day_of_week, start_time, end_time, accepts_booking)
VALUES
  ('66666666-0004-0000-0000-000000000006',
   '22222222-2222-2222-2222-222222222204',
   '11111111-1111-1111-1111-111111111103',
   6, '09:00', '12:00', false);

-- D005 — จันทร์ถึงศุกร์ 10:00–15:00 พักสั้น 12:00–12:30
INSERT INTO doctor_schedules (id, doctor_id, department_id, day_of_week, start_time, end_time)
SELECT ('66666666-0005-0000-0000-00000000000' || dow)::uuid,
       '22222222-2222-2222-2222-222222222205',
       '11111111-1111-1111-1111-111111111104',
       dow, '10:00', '15:00'
FROM generate_series(1, 5) AS dow;

INSERT INTO schedule_breaks (schedule_id, start_time, end_time, label)
SELECT id, '12:00', '12:30', 'พักกลางวัน'
FROM doctor_schedules WHERE doctor_id = '22222222-2222-2222-2222-222222222205';

-- =============================================================================
-- ข้อยกเว้น: D001 ลาพักร้อนวันพุธถัดไป
-- ใช้ทดสอบว่าระบบไม่เสนอ slot ในวันที่แพทย์ไม่อยู่
-- =============================================================================
INSERT INTO schedule_exceptions
  (doctor_id, exception_date, kind, reason, created_by)
VALUES
  ('22222222-2222-2222-2222-222222222201',
   seed_next_monday() + 2,
   'DAY_OFF',
   'ลาพักร้อน',
   '44444444-4444-4444-4444-444444444403');

-- =============================================================================
-- นัดตัวอย่าง (วันจันทร์ถัดไป) — จงใจเว้นช่องว่างไว้ให้ทดลองจอง
--
-- ตาราง D001 วันจันทร์หลัง seed:
--   09:00–09:15  จองแล้ว (FOLLOW_UP)
--   09:15–09:45  จองแล้ว (NEW_PATIENT)
--   09:45–10:30  ว่าง
--   10:30–11:30  จองแล้ว (PROCEDURE 60 นาที + buffer 15 → บล็อกถึง 11:45)
--   11:45–12:00  ว่าง
--   12:00–13:00  พักกลางวัน
--   13:00–16:00  ว่างทั้งหมด
-- =============================================================================
SELECT seed_book(
  '33333333-3333-3333-3333-333333333301',
  '22222222-2222-2222-2222-222222222201',
  'FOLLOW_UP',
  (seed_next_monday() + time '09:00') AT TIME ZONE 'Asia/Bangkok',
  'ติดตามอาการความดันโลหิตสูง'
);

SELECT seed_book(
  '33333333-3333-3333-3333-333333333302',
  '22222222-2222-2222-2222-222222222201',
  'NEW_PATIENT',
  (seed_next_monday() + time '09:15') AT TIME ZONE 'Asia/Bangkok',
  'ปวดท้องเรื้อรัง 2 สัปดาห์'
);

SELECT seed_book(
  '33333333-3333-3333-3333-333333333305',
  '22222222-2222-2222-2222-222222222201',
  'PROCEDURE',
  (seed_next_monday() + time '10:30') AT TIME ZONE 'Asia/Bangkok',
  'ส่องกล้องทางเดินอาหารส่วนต้น'
);

SELECT seed_book(
  '33333333-3333-3333-3333-333333333303',
  '22222222-2222-2222-2222-222222222205',
  'CONSULTATION',
  (seed_next_monday() + time '10:00') AT TIME ZONE 'Asia/Bangkok',
  'ปรึกษาผลตรวจคลื่นไฟฟ้าหัวใจ'
);

-- นัดที่ถูกยกเลิกไปแล้ว — พิสูจน์ว่า slot กลับมาว่างได้จริง
-- (ลองเรียก availability ของ D004 วันจันทร์ จะเห็น 14:00 ว่างอยู่)
SELECT seed_book(
  '33333333-3333-3333-3333-333333333304',
  '22222222-2222-2222-2222-222222222204',
  'FOLLOW_UP',
  (seed_next_monday() + time '14:00') AT TIME ZONE 'Asia/Bangkok',
  'ตรวจพัฒนาการตามนัด'
);

UPDATE appointments
SET status              = 'cancelled',
    cancelled_at        = now(),
    cancelled_by        = '44444444-4444-4444-4444-444444444402',
    cancellation_reason = 'ผู้ปกครองขอเลื่อนนัด'
WHERE doctor_id = '22222222-2222-2222-2222-222222222204'
  AND starts_at = (seed_next_monday() + time '14:00') AT TIME ZONE 'Asia/Bangkok'
  AND status = 'booked';

-- -----------------------------------------------------------------------------
DROP FUNCTION seed_book(uuid, uuid, text, timestamptz, text);
DROP FUNCTION seed_next_monday();

COMMIT;

-- สรุปผล
SELECT 'departments' AS table_name, count(*) FROM departments
UNION ALL SELECT 'doctors',           count(*) FROM doctors
UNION ALL SELECT 'patients',          count(*) FROM patients
UNION ALL SELECT 'staff_users',       count(*) FROM staff_users
UNION ALL SELECT 'appointment_types', count(*) FROM appointment_types
UNION ALL SELECT 'doctor_schedules',  count(*) FROM doctor_schedules
UNION ALL SELECT 'schedule_breaks',   count(*) FROM schedule_breaks
UNION ALL SELECT 'exceptions',        count(*) FROM schedule_exceptions
UNION ALL SELECT 'appointments',      count(*) FROM appointments;
