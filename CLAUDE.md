# Hospital Appointment Booking Module

Take-home test — outpatient appointment booking for a Hospital Information System.

Monorepo: `api/` (NestJS, port 3001) · `web/` (Next.js, port 3000) · `db/` (SQL) · `docs/` (API spec)

## Commands (รันจาก root)
- `npm run db:up` / `npm run db:reset` — Postgres ใน docker (migration + seed รันอัตโนมัติ)
- `npm run api:dev` — NestJS ที่ 3001
- `npm run web:dev` — Next.js ที่ 3000
- `npm run db:psql` — เปิด psql เข้า container

ก่อนบอกว่าเสร็จ ต้องรัน `npm run typecheck` ให้ผ่านเสมอ

## Architecture (api/src)
- `domain/`  — pure functions ล้วน ห้าม import @nestjs/*, ห้ามแตะ DB
               ตรรกะหา slot และกฎการจองอยู่ที่นี่ ต้องเทสต์ได้โดยไม่ต้องมีฐานข้อมูล
- `modules/` — NestJS modules. controller = HTTP layer บางๆ, service = ประสาน domain + db
- `db/`      — drizzle schema + client เป็น type layer สำหรับ query เท่านั้น
- `common/`  — exception filter, error codes, zod validation pipe

Controller ห้ามมี business logic. Service ห้ามรู้จัก HTTP.

## Domain rules — ห้ามละเมิด
- `ends_at` และ `blocks_until` คำนวณฝั่ง server จากตาราง appointment_types เท่านั้น
  ห้ามรับค่าเหล่านี้จาก client
- การกันนัดซ้อนพึ่ง exclusion constraint ใน Postgres
  **ห้ามเขียน SELECT-เช็ค-แล้ว-INSERT** เพราะเป็น race condition
  ให้ INSERT ตรง แล้วจับ SQLSTATE `23P01` ตอบ 409 SLOT_TAKEN
- timezone = Asia/Bangkok เก็บทุกอย่างเป็น timestamptz
- ห้าม DELETE นัด ให้เปลี่ยน status พร้อมบันทึก cancelled_by / cancelled_at / cancellation_reason
- ห้ามเชื่อเวลาจาก client ใช้เวลาฝั่ง server เสมอ
- `db/migrations/*.sql` เขียนมือ ห้ามให้ drizzle-kit generate ทับ

## API contract
`docs/api.http` และ `docs/postman/` คือ spec — ห้ามคิด endpoint หรือ error code ใหม่เอง

error format: `{ "error": { "code": "...", "message": "...", "details": {} } }`

codes: SLOT_TAKEN · OUTSIDE_WORKING_HOURS · DURING_BREAK · IN_THE_PAST ·
SCHEDULE_NOT_BOOKABLE · DOCTOR_ON_LEAVE · PATIENT_DOUBLE_BOOKED ·
TOO_FAR_IN_ADVANCE · LEAD_TIME_VIOLATION · INVALID_STATUS_TRANSITION · VALIDATION_ERROR

## Conventions
- ห้าม `any` ห้าม `@ts-ignore`
- validate ด้วย zod ที่ขอบ ไม่ใช่ class-validator
- comment ภาษาไทยได้ ชื่อตัวแปรและฟังก์ชันเป็นอังกฤษ