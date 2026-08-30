# Appointment Booking Module

ชื่อผู้ทำ: ภานุวัฒน์ สิทธิศักดิ์ธนกุล

โมดูลจองนัดผู้ป่วยนอกสำหรับระบบสารสนเทศโรงพยาบาล
แนวทางการเลือก Tech Stack สำหรับโปรเจคนี้ไม่ได้เลือกจากความถนัดแต่เลือกจาก Tech Stack ของบริษัทตามที่ลงประกาศ
- React(Next.js), TypeScript
- NestJS (เลือกก่อน Go lang เพราะมีความซับซ้อนน้อยกว่า)
- DB Postgres
- K6 สำหรับทำ Test
- และสิ่งสำคัญที่สุดเนื่องจากมีเวลาพัฒนาระบบจำกัด และตัดสินใจไม่เลือก Tech Stack ที่ถนัดแต่เลือกตามที่ต้องใช้จริงๆ
  จึงมีการใช้ Claude Code เข้ามาช่วย ความถูกต้องของระบบไม่ได้มาจากเครื่องมือที่ใช้เขียน แต่มาจากสองอย่างคือ exclusion constrain ที่ทำให้การจองซ้อนเป็นไปไม่ได้ตั้งแต่ระดับฐานข้อมูล และเทสต์ที่ครอบคลุมตรรกะการหา slot กับกฎการจองทั้งหมด

ออกแบบระบบ [docs/DESIGN.md](docs/DESIGN.md)

## เริ่มต้นใช้งาน (Quick start)

ต้องมี Docker
ต้องมี Node ตามเวอร์ชันที่ระบุในไฟล์ `.nvmrc`

```bash
git clone <this-repo>
cd hospital-appointment-booking

nvm use            # อ่านเวอร์ชัน Node จาก .nvmrc
npm run setup      # ติดตั้ง dependencies ของ api/ และ web/ แล้วเปิด Postgres ใน Docker
npm run api:dev    # เปิด API (NestJS) ที่ http://localhost:3001
npm run web:dev    # เปิดอีกเทอร์มินัลหนึ่ง เว็บ (Next.js) จะรันที่ http://localhost:3000
```

เปิดเบราว์เซอร์ไปที่ http://localhost:3000

| ส่วนไหน | port  |
|---|---|
| เว็บ (Next.js) | `:3000` |
| API (NestJS) | `:3001` |
| Postgres 16 | `:5432` (container ชื่อ `booking-db`, database ชื่อ `booking`) |

ไฟล์ migration `db/migrations/0000_init.sql` และ seed data `db/seed.sql` จะถูก mount เข้า container Postgres เป็นสคริปต์ `docker-entrypoint-initdb.d`
สคริปต์พวกนี้จะรันอัตโนมัติตั้งแต่ครั้งแรกที่ volume ของ container ถูกสร้าง ไม่ต้องทำอะไรเพิ่ม

ถ้าต้องการล้างข้อมูลแล้ว seed ใหม่ ใช้ `npm run db:reset` คำสั่งนี้จะลบ volume แล้วสร้างใหม่
ส่วน `npm run db:psql` ใช้เปิด `psql` เข้า container ที่กำลังรันอยู่

## Tech stack

API: **NestJS** + **Drizzle** + **Postgres 16**
เว็บ: **Next.js** + **shadcn/ui**

เหตุผลที่เลือกแต่ละตัวอยู่ที่ [docs/DESIGN.md#tech-stack](docs/DESIGN.md#tech-stack)

## Data model

| ตาราง | เก็บอะไร |
|---|---|
| `departments` | แผนกของโรงพยาบาล |
| `doctors` | บุคลากรทางการแพทย์ |
| `patients` | คนไข้ ระบุตัวตนด้วย `hn` |
| `staff_users` | stub ผู้ใช้งานฝั่งเจ้าหน้าที่ สำหรับบันทึกว่าใครทำรายการ |
| `appointment_types` | ประเภทนัด พร้อม duration/buffer/lead time/max advance |
| `doctor_schedules` | ตารางเวรรายสัปดาห์แบบ template ของแพทย์ |
| `schedule_breaks` | ช่วงพักของแต่ละตารางเวร |
| `schedule_exceptions` | วันลา/วันหยุดพิเศษของแพทย์ |
| `appointments` | ตัวนัดหมาย |

รายละเอียดของแต่ละตารางอยู่ที่ [docs/DESIGN.md#data-model](docs/DESIGN.md#data-model)

## Key design decisions

**1. ทำไม Postgres**
เลือก Postgres เพราะ exclusion constraint บน range type ช่วยให้ database ป้องกันการจองที่เวลาทับกันได้เอง ไม่ต้องพึ่งการล็อกฝั่งแอป
รายละเอียดและตารางเปรียบเทียบทางเลือกอื่นอยู่ที่ [docs/DESIGN.md#1-ทำไมต้อง-postgres](docs/DESIGN.md#1-ทำไมต้อง-postgres)

**2. Availability ต้องใช้ range เดียวกับ constraint**
endpoint หา slot ว่างต้องเช็คด้วย `occupied_range` ตัวเดียวกับที่ exclusion constraint ใช้ ไม่งั้นผู้ใช้อาจเห็น slot ว่างแล้วพอกดจองจริงกลับได้ 409 ซ้ำ
รายละเอียดอยู่ที่ [docs/DESIGN.md#3-availability-ต้องตรงกับ-constraint](docs/DESIGN.md#3-availability-ต้องตรงกับ-constraint)

**3. ตารางเวรเป็น template ไม่ใช่แถวรายวัน**
`doctor_schedules` เก็บเป็น template รายสัปดาห์บวก `valid_from`/`valid_to` แก้เวลาออกตรวจแล้วมีผลไปข้างหน้าโดยไม่กระทบนัดในอดีต
รายละเอียดอยู่ที่ [docs/DESIGN.md#4-ตารางเวรเป็น-template-รายสัปดาห์](docs/DESIGN.md#4-ตารางเวรเป็น-template-รายสัปดาห์)

## Appointment types

| Code | ชื่อ | ระยะเวลา | Buffer หลังจบ | ต้องจองล่วงหน้าอย่างน้อย | จองล่วงหน้าได้ไม่เกิน |
|---|---|---|---|---|---|
| `NEW_PATIENT` | ผู้ป่วยใหม่ | 30 นาที | 0 นาที | 30 นาที | 90 วัน |
| `FOLLOW_UP` | นัดติดตามอาการ | 15 นาที | 0 นาที | 30 นาที | 90 วัน |
| `CONSULTATION` | ปรึกษาแพทย์ | 30 นาที | 0 นาที | 30 นาที | 90 วัน |
| `PROCEDURE` | หัตถการ | 60 นาที | 15 นาที | 1440 นาที (24 ชม.) | 60 วัน |

`buffer_after_min` คือเวลาเผื่อเตรียมห้อง คนไข้จะเห็นแค่ `duration_min` แต่ระบบจะกันเวลาไว้จริงเป็น `duration_min` บวก `buffer_after_min`

## Appointment status

| สถานะ | กิน slot ไหม | เพราะอะไร |
|---|---|---|
| `booked` | กิน | เป็นการจองที่ยังใช้งานอยู่ตามเวลาของแพทย์ |
| `checked_in` | กิน | คนไข้มาถึงและเช็คอินแล้วจริง |
| `in_progress` | กิน | กำลังตรวจอยู่ |
| `completed` | กิน | การตรวจเกิดขึ้นไปแล้ว เวลานั้นถูกใช้ไปจริง จองทับย้อนหลังไม่ได้อยู่แล้ว |
| `cancelled` | ไม่กิน | ยกเลิกแล้ว การมาพบจะไม่เกิดขึ้น เวลานั้นจึงกลับมาว่าง |
| `no_show` | กิน | แพทย์กันเวลาไว้ให้คนไข้ที่ไม่มาตามนัด เวลานั้นถือว่าถูกใช้ไปแล้วในทางปฏิบัติ ถ้าปล่อยให้ว่างจะไม่ตรงกับสิ่งที่เกิดขึ้นจริง |

ยกเลิกนัดแล้ว slot จะกลับมาว่างทันที รายละเอียดเรื่อง state machine และนโยบายยกเลิกอยู่ที่ [docs/DESIGN.md#appointment-status-state-machine](docs/DESIGN.md#appointment-status-state-machine)

## API reference

รายละเอียด request และ response แบบเต็มอยู่ที่ `docs/api.http`
ไฟล์นี้รันได้ด้วย VS Code REST Client หรือ IntelliJ/WebStorm
ดู `docs/postman/` เพิ่มเติมได้เช่นกัน

สรุป endpoint ทั้งหมด:

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/health` | เช็คว่าระบบยังทำงานอยู่ |
| GET | `/api/departments` | รายชื่อแผนก |
| GET | `/api/doctors` | รายชื่อแพทย์ |
| GET | `/api/doctors/:id/schedules` | ตารางเวรรายสัปดาห์ของแพทย์คนนั้น |
| GET | `/api/doctors/:id/availability?date&typeCode` | slot ที่จองได้ ของแพทย์/วันที่/ประเภทนัดที่ระบุ |
| GET | `/api/patients` | รายชื่อ / ค้นหาคนไข้ |
| GET | `/api/appointment-types` | รายการประเภทนัด |
| POST | `/api/appointments` | จองนัด (รองรับ header `Idempotency-Key`) |
| GET | `/api/appointments` | รายการนัด กรองได้ด้วย `doctorId`/`patientId`/`date`/`status` |
| GET | `/api/appointments/:id` | ดูรายละเอียดนัดหนึ่งรายการ |
| POST | `/api/appointments/:id/cancel` | ยกเลิกนัด (ต้องระบุ `reason`) |

Error codes ทั้งหมดอยู่ที่ `api/src/common/errors/error-codes.ts`:

| Code | ความหมาย |
|---|---|
| `IN_THE_PAST` | เวลาที่ขอจองเป็นเวลาที่ผ่านมาแล้ว |
| `LEAD_TIME_VIOLATION` | จองใกล้เกินไป น้อยกว่า `min_lead_time_min` ของประเภทนัดนั้น |
| `TOO_FAR_IN_ADVANCE` | จองล่วงหน้าเกิน `max_advance_days` ของประเภทนัดนั้น |
| `OUTSIDE_WORKING_HOURS` | อยู่นอกเวลาทำการของแพทย์ในวันนั้น รวมถึงกรณีไม่มีตารางเวรเลย |
| `SCHEDULE_NOT_BOOKABLE` | แพทย์มีตารางเวรวันนั้นจริง แต่เปิดแบบ walk-in อย่างเดียว (`accepts_booking = false`) |
| `DOCTOR_ON_LEAVE` | มีแถวใน `schedule_exceptions` ชนิด `DAY_OFF` ครอบคลุมวันนั้น |
| `DURING_BREAK` | ตรงกับช่วงเวลาพักของแพทย์ |
| `SLOT_TAKEN` | exclusion constraint ปฏิเสธการ insert เพราะมีคนอื่นจองเวลานั้นไปแล้ว |
| `PATIENT_DOUBLE_BOOKED` | คนไข้คนเดียวกันมีนัดที่ทับเวลากันอยู่กับแพทย์อีกคนแล้ว |
| `INVALID_STATUS_TRANSITION` | การเปลี่ยนสถานะที่ขอมาไม่ได้รับอนุญาตจากสถานะปัจจุบัน |
| `VALIDATION_ERROR` | ข้อมูลที่ส่งมา (body/query) ไม่ผ่านการตรวจของ zod |
| `NOT_FOUND` | ไม่พบข้อมูลที่ขอ เช่น appointment id ที่ไม่มีอยู่จริง |
| `CONCURRENT_MODIFICATION` | มีคนอื่นแก้ไขนัดเดียวกันไปก่อนแล้วระหว่างที่ทำรายการนี้อยู่ |

รูปแบบ error response ทุกกรณี:

```json
{ "error": { "code": "SLOT_TAKEN", "message": "...", "details": {} } }
```

## Web UI

![หน้าจองนัด](docs/screenshots/booking.png)

![เมนูการจองนัด](docs/screenshots/booking2.png)

หน้าเว็บมีหน้าเดียวที่ `http://localhost:3000`
ฝั่งซ้ายเลือกแพทย์ วันที่ ประเภทนัด แล้วคลิก slot เพื่อจอง
ฝั่งขวาเป็นรายการนัดของวันนั้น พร้อมปุ่มยกเลิก

ถ้า slot ที่เลือกเพิ่งถูกคนอื่นจองไปก่อน ระบบจะแจ้งเตือนแล้วโหลดเวลาว่างใหม่ให้ทันที
เหตุผลของการออกแบบจุดนี้อยู่ที่ [docs/DESIGN.md#web-ui-การจัดการ-availability-ที่ล้าสมัย](docs/DESIGN.md#web-ui-การจัดการ-availability-ที่ล้าสมัย)

## Testing

ทั้งหมด 108 เทสต์ ใน 6 suite รันด้วย `npm test --prefix api`

**Domain tests** มี 69 เทสต์ ใน 3 suite คือ `slots.spec.ts`, `booking-rules.spec.ts`, `status.spec.ts`
เทสต์กลุ่มนี้ทดสอบ pure function ใน `api/src/domain/` ตรงๆ ไม่ต้องมีฐานข้อมูล ไม่ต้องมี NestJS มีแค่ input กับ output ล้วนๆ
รันเฉพาะกลุ่มนี้ด้วย `npm test --prefix api -- src/domain`

**Integration tests** มี 39 เทสต์ ใน 3 suite คือ `appointments.integration.spec.ts`, `availability.integration.spec.ts`, `master-data.integration.spec.ts`
เทสต์กลุ่มนี้เปิด Nest module ทั้งชุดแล้วยิงผ่าน `supertest` เข้า Postgres จริง
ต้องรัน `npm run db:up` ให้พร้อมก่อนเสมอ

`npm run typecheck` ที่ root รัน `tsc --noEmit` ให้ทั้ง `api/` และ `web/`

## Load test

ทดสอบว่า exclusion constraint กันการจองซ้อนได้จริงเมื่อยิงพร้อมกัน

ต้องมี k6 ก่อน ดูวิธีติดตั้งที่ https://grafana.com/docs/k6/latest/set-up/install-k6/

npm run db:reset
npm run api:dev
k6 run --env BASE_URL=http://localhost:3001 tests/load/concurrent-booking.js

ยิง 50 request พร้อมกันไปที่ slot เดียวกัน ผลที่ได้

booking_created................: 1
booking_rejected_conflict......: 49
booking_unexpected.............: 0
checks_succeeded...............: 100.00%
http_req_duration..............: avg=460ms max=492ms

threshold ในสคริปต์บังคับไว้ว่าต้องสำเร็จ 1 และถูกปฏิเสธ 49 เท่านั้น
ถ้าไม่ตรง k6 จะ exit ด้วย code ไม่เป็นศูนย์

## Assumptions

ทุกข้อต่อไปนี้คือสิ่งที่ตัดสินใจเอง เพราะโจทย์ไม่ได้ระบุไว้

- ล็อก timezone เป็น `Asia/Bangkok` ทั้งระบบ เพราะไทยไม่มี DST เลยไม่ต้องจัดการเรื่อง offset ที่เปลี่ยนตามช่วงเวลา เวลาทั้งหมดเก็บเป็น `timestamptz`
- ตาราง slot ที่เสนอให้จองจะเดินทีละ 15 นาที โดยกำหนดผ่านค่า `slot_interval_min` ใน `doctor_schedules` ซึ่งค่านี้ไม่ขึ้นกับ duration ของประเภทนัด
- ค่า duration, buffer และ lead time ของแต่ละประเภทนัด เป็นค่าที่ seed ไว้ใน `db/seed.sql` สามารถดูค่าจริงได้จากตาราง Appointment types ด้านบน ค่าพวกนี้ไม่ได้มาจากโจทย์ แต่เป็นค่าที่ตั้งเองให้เหมาะกับการใช้งานของคลินิกทั่วไป
- หนึ่ง slot รับคนไข้ได้หนึ่งคนเท่านั้น ไม่มี overbooking หรือ slot ที่รองรับหลายคนไข้
- ระบบยืนยันตัวตนเจ้าหน้าที่ตอนนี้เป็นแค่ stub ทุก request ต้องส่ง header `X-Staff-Id` เพื่อระบุว่าใครเป็นคนทำ ยังไม่มี flow login จริงอยู่เบื้องหลัง

## Known limitations

- UUID ที่ seed ไว้ตั้งใจทำให้อ่านง่ายแต่เป็น UUID ปลอม เช่น `22222222-2222-2222-2222-222222222201` ซึ่งไม่ใช่ UUID v4 ตาม RFC 4122 จริง การ validate จึงเช็คแค่รูปแบบ hex `8-4-4-4-12` แบบหลวม ๆ ผ่าน `UUID_LIKE_REGEX` ใน `appointments.schema.ts` ยังไม่ได้เช็ค version หรือ variant ของ UUID แบบเข้ม
- ยังไม่มีระบบ authentication จริง ทุก request เชื่อจาก header `X-Staff-Id` เพียงอย่างเดียว
- ถ้าแก้ตารางเวรของแพทย์ตอนที่มีนัดค้างอยู่ในอนาคต ตอนนี้ระบบยังไม่มีการเตือนผู้ใช้ว่าการแก้อาจทำให้นัดที่มีอยู่หลุดออกนอกเวลาทำการใหม่ และระบบก็ยังปล่อยให้แก้ผ่าน
- ไม่รองรับ overbooking หรือคิว walk-in เพราะ exclusion constraint บังคับไว้ตั้งแต่การออกแบบว่าแพทย์หนึ่งคนมีได้แค่หนึ่งนัดต่อช่วงเวลา
- หน้าเว็บมีหน้าเดียว มีแค่จองนัดกับรายการนัดของวันนั้น ยังไม่มีหน้าสำหรับจัดการตารางเวรหรือจัดการคนไข้

## What I'd do next

- เพิ่ม audit log สำหรับทุกการกระทำที่เปลี่ยนสถานะ เช่น ใครจอง ใครยกเลิก ใครเช็คอิน และเมื่อไหร่ เพื่อให้ตรวจสอบย้อนหลังได้มากกว่าฟิลด์ที่มีอยู่แล้วใน `appointments`
- เพิ่ม OpenTelemetry สำหรับ trace การ query availability และ transaction การจองแบบ end-to-end โดย metric ที่ควรตั้ง alert คืออัตราการชนของ exclusion constraint หรือความถี่ของ `23P01` เพราะตัวเลขนี้ช่วยบอกได้ว่า slot ยอดนิยมมีการแย่งกันมากแค่ไหน
- ใช้ Temporal หรือเทียบเท่า สำหรับเตือนนัดล่วงหน้าและเปลี่ยนสถานะเป็น no-show อัตโนมัติหลังพ้นช่วงผ่อนผัน
- เพิ่ม Playwright E2E ให้ครอบคลุม flow การจองและการยกเลิกผ่านหน้าเว็บจริง
- เพิ่ม endpoint สำหรับเลื่อนนัด (reschedule) ตอนนี้ทำได้แค่ยกเลิกแล้วจองใหม่ ซึ่งทำให้ความเชื่อมโยงผ่าน `rescheduled_from_id` ที่มีอยู่ใน schema ยังไม่ได้ถูกใช้งาน
- เพิ่ม rate limiting บน endpoint จองนัด
- เพิ่ม cursor-based pagination บน `GET /api/appointments` และ `GET /api/patients` ตอนนี้ทั้งสอง endpoint ยังไม่มีการแบ่งหน้า
- ตั้ง Statement Timeout ไว้ที่ 5 วินาที เพื่อป้องกันไม่ให้ Request ต้องค้างรอ Lock ที่ GiST Index นานเกินไป กรณีที่มีหลาย Request เข้ามาแย่ง Slot เดียวกันเยอะ ๆ จากที่ลองทดสอบด้วย k6 ที่ 50 Request พร้อมกัน Latency สูงสุดอยู่ประมาณ 500ms ซึ่งยังห่างจาก Timeout 5 วินาทีพอสมควร เลยถือว่ายังมี Buffer อยู่ค่อนข้างเยอะ