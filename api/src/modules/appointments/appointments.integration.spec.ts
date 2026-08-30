import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

import { AppExceptionFilter } from '../../common/filters/app-exception.filter';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { DbModule } from '../../db/db.module';
import { appointments } from '../../db/schema';
import { HealthModule } from '../health/health.module';
import { AvailabilityModule } from '../availability/availability.module';
import { AppointmentsModule } from './appointments.module';

// UUID จาก db/seed.sql — ตรงกับ docs/api.http
const STAFF_ID = '44444444-4444-4444-4444-444444444401';
const DR_ANAN = '22222222-2222-2222-2222-222222222201'; // จ–ศ 09:00–16:00 พักเที่ยง 12:00–13:00
const DR_PIYADA = '22222222-2222-2222-2222-222222222202'; // จ พุธ ศุกร์ 13:00–20:00
const DR_THANAWAT = '22222222-2222-2222-2222-222222222203'; // อังคาร พฤหัส 08:00–12:00 เท่านั้น
const DR_MANATNAN = '22222222-2222-2222-2222-222222222204'; // จ–ศ 09:00–17:00, เสาร์ walk-in only

const PT_WICHAI = '33333333-3333-3333-3333-333333333301';
const PT_NATTAPON = '33333333-3333-3333-3333-333333333303';

interface AppointmentResponseBody {
  data: {
    id: string;
    appointmentNo: string;
    patientId: string;
    doctorId: string;
    departmentId: string;
    typeCode: string;
    startsAt: string;
    endsAt: string;
    status: string;
    reason: string | null;
    createdBy: string;
  };
}

interface ErrorResponseBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

describe('POST /api/appointments (integration)', () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let nextMonday: string; // YYYY-MM-DD ของวันจันทร์ถัดไป ตรงกับที่ seed ใช้

  const addDaysIso = (isoDate: string, days: number): string => {
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule, HealthModule, AvailabilityModule, AppointmentsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();

    db = moduleRef.get<DrizzleDb>(DRIZZLE);

    // ข้อมูล seed อิงจาก "วันจันทร์ถัดไป" เสมอ — อ่านค่าเดียวกับที่ health endpoint คำนวณ
    const healthRes = await request(app.getHttpServer()).get('/api/health').expect(200);
    nextMonday = (healthRes.body as { nextMonday: string }).nextMonday;
  });

  afterAll(async () => {
    // ลบนัดที่เทสต์นี้สร้างไว้ทั้งหมด (reason เป็นค่าคงที่ 'ทดสอบ' เสมอ) เพื่อไม่ให้ค้างชน slot เดิม
    // ตอนรันเทสต์ซ้ำในครั้งถัดไปโดยไม่ได้ db:reset ก่อน
    await db.delete(appointments).where(eq(appointments.reason, 'ทดสอบ'));
    await app.close();
  });

  const bookingBody = (overrides: Record<string, unknown> = {}) => ({
    patientId: PT_NATTAPON,
    doctorId: DR_ANAN,
    typeCode: 'FOLLOW_UP',
    startsAt: `${nextMonday}T14:00:00+07:00`,
    reason: 'ทดสอบ',
    ...overrides,
  });

  const post = () => request(app.getHttpServer()).post('/api/appointments').set('X-Staff-Id', STAFF_ID);

  // ---------------------------------------------------------------------------
  // หัวข้อ 03 — Invalid booking: ทุกเคสต้องถูกปฏิเสธ
  // ---------------------------------------------------------------------------
  describe('03 — invalid booking', () => {
    it('นอกเวลาทำการ (07:00 แต่แพทย์เริ่ม 09:00) → 400 OUTSIDE_WORKING_HOURS', async () => {
      const res = await post()
        .send(bookingBody({ startsAt: `${nextMonday}T07:00:00+07:00` }))
        .expect(400);

      expect((res.body as ErrorResponseBody).error.code).toBe('OUTSIDE_WORKING_HOURS');
    });

    it('ตรงกับเวลาพักกลางวัน (12:15) → 400 DURING_BREAK', async () => {
      const res = await post()
        .send(bookingBody({ startsAt: `${nextMonday}T12:15:00+07:00` }))
        .expect(400);

      expect((res.body as ErrorResponseBody).error.code).toBe('DURING_BREAK');
    });

    it('หัตถการ 60 นาที เริ่ม 11:30 คร่อมเข้าเวลาพัก → 400 DURING_BREAK', async () => {
      // PROCEDURE ต้องจองล่วงหน้าอย่างน้อย 24 ชม. (min_lead_time_min=1440) — nextMonday เพียงอย่างเดียว
      // อาจใกล้เกินไปแล้วแต่ตอนที่รันเทสต์ จึงใช้จันทร์ถัดไปอีกสัปดาห์ (ยังเป็นวันจันทร์ปกติ ไม่มี exception)
      const monday = addDaysIso(nextMonday, 7);

      const res = await post()
        .send(
          bookingBody({
            typeCode: 'PROCEDURE',
            startsAt: `${monday}T11:30:00+07:00`,
          }),
        )
        .expect(400);

      expect((res.body as ErrorResponseBody).error.code).toBe('DURING_BREAK');
    });

    it('ซ้อนกับนัดที่มีอยู่แล้ว (09:00) → 409 SLOT_TAKEN', async () => {
      const res = await post()
        .send(bookingBody({ startsAt: `${nextMonday}T09:00:00+07:00` }))
        .expect(409);

      expect((res.body as ErrorResponseBody).error.code).toBe('SLOT_TAKEN');
    });

    it('ซ้อนกับช่วง buffer ของหัตถการ (11:35) → 409 SLOT_TAKEN', async () => {
      const res = await post()
        .send(bookingBody({ startsAt: `${nextMonday}T11:35:00+07:00` }))
        .expect(409);

      expect((res.body as ErrorResponseBody).error.code).toBe('SLOT_TAKEN');
    });

    it('จองย้อนหลังในอดีต → 400 IN_THE_PAST', async () => {
      // 2020-01-06 อยู่ก่อน valid_from ของตารางเวรทุกตัวใน seed (จึงไม่มีตารางเวรของวันนั้นเลยถ้ามองแยก)
      // แต่กฎเรื่องเวลาต้องถูกตรวจก่อน query ตารางเวรเสมอ (ดู "ยืนยันลำดับการตรวจ" ด้านล่าง)
      // จึงต้องได้ IN_THE_PAST ไม่ใช่ OUTSIDE_WORKING_HOURS
      const res = await post()
        .send(bookingBody({ startsAt: '2020-01-06T10:00:00+07:00' }))
        .expect(400);

      expect((res.body as ErrorResponseBody).error.code).toBe('IN_THE_PAST');
    });

    it('ยืนยันลำดับการตรวจ: กฎเรื่องเวลาต้องมาก่อน query ตารางเวรเสมอ แม้แพทย์จะไม่มีตารางเวรวันนั้นเลย', async () => {
      // drThanawat ออกตรวจเฉพาะอังคาร/พฤหัสเท่านั้น — 2027-12-01 เป็นวันพุธ (ไม่มีตารางเวรเลย)
      // และไกลเกิน 90 วัน (max_advance_days ของ FOLLOW_UP) ด้วย
      // ถ้า service ไป query ตารางเวรก่อนเช็คกฎเรื่องเวลา จะได้ OUTSIDE_WORKING_HOURS (ผิด)
      // ลำดับที่ถูกต้องต้องได้ TOO_FAR_IN_ADVANCE เพราะเป็นกฎที่ตรวจได้โดยไม่ต้องพึ่งตารางเวรเลย
      const res = await post()
        .send(bookingBody({ doctorId: DR_THANAWAT, startsAt: '2027-12-01T10:00:00+07:00' }))
        .expect(400);

      expect((res.body as ErrorResponseBody).error.code).toBe('TOO_FAR_IN_ADVANCE');
    });

    it('แพทย์เปิดตรวจแต่ไม่รับนัดล่วงหน้า → 400 SCHEDULE_NOT_BOOKABLE', async () => {
      const saturday = addDaysIso(nextMonday, 5);

      const res = await post()
        .send(
          bookingBody({
            doctorId: DR_MANATNAN,
            startsAt: `${saturday}T10:00:00+07:00`,
          }),
        )
        .expect(400);

      expect((res.body as ErrorResponseBody).error.code).toBe('SCHEDULE_NOT_BOOKABLE');
    });

    it('แพทย์ลา (วันพุธ = nextMonday + 2) → 400 DOCTOR_ON_LEAVE', async () => {
      const wednesday = addDaysIso(nextMonday, 2);

      const res = await post()
        .send(bookingBody({ startsAt: `${wednesday}T10:00:00+07:00` }))
        .expect(400);

      expect((res.body as ErrorResponseBody).error.code).toBe('DOCTOR_ON_LEAVE');
    });

    it('คนไข้คนเดิมมีนัดกับแพทย์อีกคนในเวลาซ้อนกัน → 409 PATIENT_DOUBLE_BOOKED', async () => {
      // docs/api.http ใช้ drThanawat กับ @date (วันจันทร์) คู่กัน แต่ตามตารางเวรใน db/seed.sql
      // D003 ออกตรวจเฉพาะอังคาร/พฤหัสเท่านั้น — จองวันจันทร์จะชน OUTSIDE_WORKING_HOURS ก่อนถึงขั้นตรวจคนไข้ซ้อน
      // จึงใช้ drManatnan (ออกตรวจจันทร์–ศุกร์ 09:00–17:00) แทน เพื่อให้เคสนี้ไปถึง exclusion constraint
      // ของคนไข้จริงๆ ตามเจตนาของเคส (ptWichai มีนัดกับ drAnan อยู่แล้ว 09:00–09:15 ในวันจันทร์)
      const res = await post()
        .send(
          bookingBody({
            patientId: PT_WICHAI,
            doctorId: DR_MANATNAN,
            startsAt: `${nextMonday}T09:05:00+07:00`,
          }),
        )
        .expect(409);

      expect((res.body as ErrorResponseBody).error.code).toBe('PATIENT_DOUBLE_BOOKED');
    });

    it('จองไกลเกิน 90 วัน → 400 TOO_FAR_IN_ADVANCE', async () => {
      const res = await post()
        .send(bookingBody({ startsAt: '2027-12-01T10:00:00+07:00' }))
        .expect(400);

      expect((res.body as ErrorResponseBody).error.code).toBe('TOO_FAR_IN_ADVANCE');
    });

    it('typeCode ที่ไม่รู้จัก → 400 VALIDATION_ERROR', async () => {
      const res = await post()
        .send(bookingBody({ typeCode: 'NOT_A_TYPE' }))
        .expect(400);

      expect((res.body as ErrorResponseBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('ไม่ส่ง X-Staff-Id → 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/appointments')
        .send(bookingBody())
        .expect(400);

      expect((res.body as ErrorResponseBody).error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // Happy path เสริม: จองสำเร็จจริง แล้วตรวจ response shape
  // ---------------------------------------------------------------------------
  describe('happy path', () => {
    it('จองสำเร็จ → 201 พร้อม ends_at/blocks_until ที่ server คำนวณเอง', async () => {
      const res = await post()
        .send(bookingBody({ doctorId: DR_PIYADA, startsAt: `${nextMonday}T18:00:00+07:00` }))
        .expect(201);

      const body = res.body as AppointmentResponseBody;
      expect(body.data.id).toBeTruthy();
      expect(body.data.appointmentNo).toMatch(/^APT-/);
      expect(body.data.status).toBe('booked');
      expect(body.data.startsAt).toBe(`${nextMonday}T18:00:00+07:00`);
      expect(body.data.endsAt).toBe(`${nextMonday}T18:15:00+07:00`); // FOLLOW_UP 15 นาที
      expect(body.data.doctorId).toBe(DR_PIYADA);
      expect(body.data.typeCode).toBe('FOLLOW_UP');

      // department ไม่ได้ส่งมาใน body → ต้องใช้ primary_department_id ของหมอ
      expect(body.data.departmentId).toBe('11111111-1111-1111-1111-111111111101');
    });
  });

  // ---------------------------------------------------------------------------
  // หัวข้อ 05 — Idempotency
  // ---------------------------------------------------------------------------
  describe('05 — idempotency', () => {
    it('ยิงซ้ำด้วย Idempotency-Key เดียวกัน: ครั้งแรก 201 ครั้งที่สอง 200 คืนใบเดิม ไม่สร้างซ้ำ', async () => {
      const idempotencyKey = randomUUID();
      const body = bookingBody({ doctorId: DR_PIYADA, startsAt: `${nextMonday}T19:00:00+07:00` });

      const first = await post().set('Idempotency-Key', idempotencyKey).send(body).expect(201);

      const second = await post().set('Idempotency-Key', idempotencyKey).send(body).expect(200);

      const firstBody = first.body as AppointmentResponseBody;
      const secondBody = second.body as AppointmentResponseBody;

      expect(secondBody.data.id).toBe(firstBody.data.id);
      expect(secondBody.data.appointmentNo).toBe(firstBody.data.appointmentNo);

      const rows = await db.select().from(appointments).where(eq(appointments.idempotencyKey, idempotencyKey));
      expect(rows).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // เทสต์สำคัญที่สุด: ยิงพร้อมกัน 20 request จอง slot เดียวกัน
  // ต้องสำเร็จแค่ 1 ที่เหลือ 409 SLOT_TAKEN และ DB มีแถวเดียว
  // ---------------------------------------------------------------------------
  describe('concurrency', () => {
    it('20 request จอง slot เดียวกันพร้อมกัน → สำเร็จ 1 ได้ 409 SLOT_TAKEN 19 แถวเดียวใน DB', async () => {
      const startsAt = `${nextMonday}T13:15:00+07:00`;
      const body = bookingBody({ doctorId: DR_ANAN, startsAt });

      const responses = await Promise.all(
        Array.from({ length: 20 }, () => post().send(body)),
      );

      const succeeded = responses.filter((r) => r.status === 201);
      const conflicted = responses.filter((r) => r.status === 409);

      expect(succeeded).toHaveLength(1);
      expect(conflicted).toHaveLength(19);
      expect(conflicted.every((r) => (r.body as ErrorResponseBody).error.code === 'SLOT_TAKEN')).toBe(true);

      const rows = await db
        .select()
        .from(appointments)
        .where(eq(appointments.doctorId, DR_ANAN));

      const matching = rows.filter(
        (row) => row.startsAt.toISOString() === new Date(startsAt).toISOString() && row.status === 'booked',
      );
      expect(matching).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // หัวข้อ 04 — Cancellation
  // ---------------------------------------------------------------------------
  describe('04 — cancellation', () => {
    const cancel = (id: string) =>
      request(app.getHttpServer()).post(`/api/appointments/${id}/cancel`).set('X-Staff-Id', STAFF_ID);

    it('ยกเลิกสำเร็จแล้ว slot กลับมาว่างใน availability', async () => {
      const startsAt = `${nextMonday}T14:00:00+07:00`;
      const booked = await post().send(bookingBody({ startsAt })).expect(201);
      const id = (booked.body as AppointmentResponseBody).data.id;

      const cancelRes = await cancel(id).send({ reason: 'ผู้ป่วยติดภารกิจ ขอเลื่อนนัด' }).expect(200);
      const cancelled = (cancelRes.body as AppointmentResponseBody).data;
      expect(cancelled.status).toBe('cancelled');

      const availRes = await request(app.getHttpServer())
        .get(`/api/doctors/${DR_ANAN}/availability`)
        .query({ date: nextMonday, typeCode: 'FOLLOW_UP' })
        .expect(200);

      const body = availRes.body as { data: { slots: { startsAt: string }[] } };
      const times = body.data.slots.map((slot) => slot.startsAt.slice(11, 16));
      expect(times).toContain('14:00');
    });

    it('ยกเลิกซ้ำ → 409 INVALID_STATUS_TRANSITION', async () => {
      const startsAt = `${nextMonday}T14:15:00+07:00`;
      const booked = await post().send(bookingBody({ startsAt })).expect(201);
      const id = (booked.body as AppointmentResponseBody).data.id;

      await cancel(id).send({ reason: 'ยกเลิกครั้งแรก' }).expect(200);

      const res = await cancel(id).send({ reason: 'ยกเลิกซ้ำ' }).expect(409);
      expect((res.body as ErrorResponseBody).error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('ยกเลิกโดยไม่ระบุเหตุผล (ไม่มี field / เป็นช่องว่างล้วน) → 400 VALIDATION_ERROR', async () => {
      const startsAt = `${nextMonday}T14:30:00+07:00`;
      const booked = await post().send(bookingBody({ startsAt })).expect(201);
      const id = (booked.body as AppointmentResponseBody).data.id;

      const resMissing = await cancel(id).send({}).expect(400);
      expect((resMissing.body as ErrorResponseBody).error.code).toBe('VALIDATION_ERROR');

      const resBlank = await cancel(id).send({ reason: '   ' }).expect(400);
      expect((resBlank.body as ErrorResponseBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('ยกเลิกนัดที่ completed แล้ว → 409 INVALID_STATUS_TRANSITION', async () => {
      const startsAt = `${nextMonday}T14:45:00+07:00`;
      const booked = await post().send(bookingBody({ startsAt })).expect(201);
      const id = (booked.body as AppointmentResponseBody).data.id;

      // ไม่มี endpoint เปลี่ยนเป็น completed ในโจทย์นี้ — จำลองด้วยการ UPDATE ตรงๆ ในเทสต์
      await db.update(appointments).set({ status: 'completed' }).where(eq(appointments.id, id));

      const res = await cancel(id).send({ reason: 'พยายามยกเลิกนัดที่เสร็จแล้ว' }).expect(409);
      expect((res.body as ErrorResponseBody).error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('ยกเลิกนัดที่ไม่มีอยู่จริง → 404 NOT_FOUND', async () => {
      const res = await cancel(randomUUID()).send({ reason: 'ทดสอบ' }).expect(404);
      expect((res.body as ErrorResponseBody).error.code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/appointments/:id และ GET /api/appointments (list + filter)
  // ---------------------------------------------------------------------------
  describe('get by id / list', () => {
    it('GET /api/appointments/:id ที่ไม่มีอยู่จริง → 404 NOT_FOUND', async () => {
      const res = await request(app.getHttpServer()).get(`/api/appointments/${randomUUID()}`).expect(404);
      expect((res.body as ErrorResponseBody).error.code).toBe('NOT_FOUND');
    });

    it('GET /api/appointments/:id คืนรายละเอียดนัดที่จองไว้', async () => {
      const startsAt = `${nextMonday}T15:00:00+07:00`;
      const booked = await post().send(bookingBody({ doctorId: DR_MANATNAN, startsAt })).expect(201);
      const id = (booked.body as AppointmentResponseBody).data.id;

      const res = await request(app.getHttpServer()).get(`/api/appointments/${id}`).expect(200);
      expect((res.body as AppointmentResponseBody).data.id).toBe(id);
      expect((res.body as AppointmentResponseBody).data.doctorId).toBe(DR_MANATNAN);
    });

    it('GET /api/appointments?doctorId=&date= filter ได้ และเรียงตาม starts_at', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/appointments')
        .query({ doctorId: DR_ANAN, date: nextMonday })
        .expect(200);

      const body = res.body as { data: { doctorId: string; startsAt: string }[] };
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((a) => a.doctorId === DR_ANAN)).toBe(true);

      const sorted = [...body.data].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      expect(body.data).toEqual(sorted);
    });
  });
});
