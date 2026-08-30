-- =============================================================================
-- Query สำเร็จรูปสำหรับเปิดดูใน TablePlus / psql
--
-- TablePlus:  Host localhost · Port 5432 · User postgres · Password postgres
--             Database booking
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. ตารางเวรแพทย์ทั้งหมด พร้อมเวลาพัก
-- -----------------------------------------------------------------------------
SELECT d.code,
       d.full_name                                   AS doctor,
       dept.name_th                                  AS department,
       CASE s.day_of_week
         WHEN 0 THEN 'อาทิตย์' WHEN 1 THEN 'จันทร์' WHEN 2 THEN 'อังคาร'
         WHEN 3 THEN 'พุธ'     WHEN 4 THEN 'พฤหัส'  WHEN 5 THEN 'ศุกร์'
         ELSE 'เสาร์' END                            AS day,
       s.start_time || ' – ' || s.end_time           AS shift,
       coalesce(string_agg(b.start_time || '–' || b.end_time, ', '), '—') AS breaks,
       s.accepts_booking                             AS bookable
FROM doctor_schedules s
JOIN doctors d       ON d.id = s.doctor_id
JOIN departments dept ON dept.id = s.department_id
LEFT JOIN schedule_breaks b ON b.schedule_id = s.id
GROUP BY d.code, d.full_name, dept.name_th, s.day_of_week, s.start_time, s.end_time, s.accepts_booking
ORDER BY d.code, s.day_of_week;


-- -----------------------------------------------------------------------------
-- 2. นัดทั้งหมดที่ยังใช้งานอยู่ เรียงตามเวลา
--    สังเกต: blocks_until ของหัตถการจะมากกว่า ends_at อยู่ 15 นาที (buffer)
-- -----------------------------------------------------------------------------
SELECT a.appointment_no,
       to_char(a.starts_at    AT TIME ZONE 'Asia/Bangkok', 'DD/MM HH24:MI') AS start_time,
       to_char(a.ends_at      AT TIME ZONE 'Asia/Bangkok', 'HH24:MI')       AS end_time,
       to_char(a.blocks_until AT TIME ZONE 'Asia/Bangkok', 'HH24:MI')       AS blocked_until,
       t.name_th   AS type,
       d.full_name AS doctor,
       p.hn, p.full_name AS patient,
       a.status,
       a.reason
FROM appointments a
JOIN doctors d           ON d.id = a.doctor_id
JOIN patients p          ON p.id = a.patient_id
JOIN appointment_types t ON t.id = a.appointment_type_id
ORDER BY a.starts_at;


-- -----------------------------------------------------------------------------
-- 3. constraint ที่กันการจองซ้อน — ดูนิยามจริงที่ Postgres บังคับใช้
-- -----------------------------------------------------------------------------
SELECT conname AS constraint_name,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'appointments'::regclass
  AND contype IN ('x', 'c')
ORDER BY contype DESC, conname;


-- -----------------------------------------------------------------------------
-- 4. พิสูจน์ว่าจองซ้อนไม่ได้ — ควรได้ ERROR 23P01 exclusion_violation
--    (แก้ starts_at ให้ตรงกับนัดที่มีอยู่จริงจาก query ข้อ 2 ก่อนรัน)
-- -----------------------------------------------------------------------------
-- INSERT INTO appointments
--   (patient_id, doctor_id, department_id, appointment_type_id,
--    starts_at, ends_at, blocks_until, created_by)
-- SELECT '33333333-3333-3333-3333-333333333303',
--        a.doctor_id, a.department_id, a.appointment_type_id,
--        a.starts_at, a.ends_at, a.blocks_until,
--        '44444444-4444-4444-4444-444444444401'
-- FROM appointments a
-- WHERE a.status = 'booked'
-- LIMIT 1;


-- -----------------------------------------------------------------------------
-- 5. พิสูจน์ว่าการยกเลิกคืน slot ให้ระบบ
--    นัดที่ถูกยกเลิกจะไม่อยู่ใน index ของ exclusion constraint
--    จึงมี slot เวลาเดียวกันซ้อนอยู่ได้โดยไม่ถูกปฏิเสธ
-- -----------------------------------------------------------------------------
SELECT to_char(starts_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM HH24:MI') AS slot,
       count(*)                                           AS total_rows,
       count(*) FILTER (WHERE status <> 'cancelled')      AS occupying_rows,
       string_agg(status, ', ')                           AS statuses
FROM appointments
GROUP BY doctor_id, starts_at
HAVING count(*) > 1
ORDER BY starts_at;


-- -----------------------------------------------------------------------------
-- 6. หา slot ว่างด้วย SQL ล้วน (เวอร์ชันตรวจสอบ)
--    ตรรกะจริงอยู่ใน src/domain/slots.ts — query นี้ไว้ cross-check ว่าตรงกัน
--    เปลี่ยน :doctor และ :date ก่อนรัน
-- -----------------------------------------------------------------------------
WITH params AS (
  SELECT '22222222-2222-2222-2222-222222222201'::uuid AS doctor_id,
         (CURRENT_DATE + (((8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int) % 7)
           + CASE WHEN EXTRACT(ISODOW FROM CURRENT_DATE)::int = 1 THEN 7 ELSE 0 END))::date AS target_date,
         15  AS duration_min,
         15  AS step_min
),
sched AS (
  SELECT s.*, p.target_date, p.duration_min, p.step_min
  FROM doctor_schedules s, params p
  WHERE s.doctor_id = p.doctor_id
    AND s.day_of_week = EXTRACT(DOW FROM p.target_date)::int
    AND s.accepts_booking
    AND p.target_date BETWEEN s.valid_from AND coalesce(s.valid_to, 'infinity'::date)
    AND NOT EXISTS (
      SELECT 1 FROM schedule_exceptions e
      WHERE e.doctor_id = s.doctor_id
        AND e.exception_date = p.target_date
        AND e.kind = 'DAY_OFF'
    )
),
candidates AS (
  -- generate_series ไม่รองรับ type `time` จึงต้องประกอบเป็น timestamp ก่อน
  SELECT gs AT TIME ZONE 'Asia/Bangkok' AS starts_at, s.*
  FROM sched s,
       generate_series(
         s.target_date + s.start_time,
         s.target_date + s.end_time - make_interval(mins => s.duration_min),
         make_interval(mins => s.step_min)
       ) AS gs
)
SELECT to_char(c.starts_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS available_slot
FROM candidates c
WHERE NOT EXISTS (                                    -- ไม่ทับเวลาพัก
        SELECT 1 FROM schedule_breaks b
        WHERE b.schedule_id = c.id
          AND b.break_range && timerange(
                (c.starts_at AT TIME ZONE 'Asia/Bangkok')::time,
                ((c.starts_at + make_interval(mins => c.duration_min)) AT TIME ZONE 'Asia/Bangkok')::time,
                '[)')
      )
  AND NOT EXISTS (                                    -- ไม่ทับนัดที่มีอยู่
        SELECT 1 FROM appointments a
        WHERE a.doctor_id = c.doctor_id
          AND a.status <> 'cancelled'
          AND a.occupied_range && tstzrange(
                c.starts_at, c.starts_at + make_interval(mins => c.duration_min), '[)')
      )
  AND c.starts_at > now() + interval '30 min'         -- lead time
ORDER BY 1;
