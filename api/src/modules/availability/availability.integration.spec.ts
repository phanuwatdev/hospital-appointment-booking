import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppExceptionFilter } from '../../common/filters/app-exception.filter';
import { DbModule } from '../../db/db.module';
import { HealthModule } from '../health/health.module';
import { AvailabilityModule } from './availability.module';
import { addDaysIso } from './local-time.util';

// UUID จาก db/seed.sql — ตรงกับ docs/api.http
const DR_ANAN = '22222222-2222-2222-2222-222222222201'; // จ–ศ 09:00–16:00 พักเที่ยง 12:00–13:00
const DR_MANATNAN = '22222222-2222-2222-2222-222222222204'; // เสาร์ 09:00–12:00 walk-in only

interface AvailabilityResponseBody {
  data: {
    doctorId: string;
    date: string;
    typeCode: string;
    durationMin: number;
    slots: { startsAt: string; endsAt: string }[];
    reason?: string;
  };
}

/** ดึงเฉพาะ HH:MM ของเวลาไทยจากสตริง ISO ที่ service คืนมา (เช่น 2026-08-31T10:00:00+07:00 → 10:00) */
const bangkokTimeOf = (iso: string): string => iso.slice(11, 16);

describe('GET /api/doctors/:doctorId/availability (integration)', () => {
  let app: INestApplication;
  let nextMonday: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule, HealthModule, AvailabilityModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();

    // ข้อมูล seed อิงจาก "วันจันทร์ถัดไป" เสมอ — อ่านค่าเดียวกับที่ health endpoint คำนวณ
    // เพื่อไม่ต้องคำนวณซ้ำและรับประกันว่าตรงกับ seed จริง ไม่ว่าจะรันวันไหน
    const healthRes = await request(app.getHttpServer()).get('/api/health').expect(200);
    nextMonday = (healthRes.body as { nextMonday: string }).nextMonday;
  });

  afterAll(async () => {
    await app.close();
  });

  it('นพ.อนันต์ วันจันทร์ FOLLOW_UP: ไม่มี 09:00, 12:00, 11:30 และมี 15:45', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/doctors/${DR_ANAN}/availability`)
      .query({ date: nextMonday, typeCode: 'FOLLOW_UP' })
      .expect(200);

    const body = res.body as AvailabilityResponseBody;
    const times = body.data.slots.map((slot) => bangkokTimeOf(slot.startsAt));

    expect(times).not.toContain('09:00');
    expect(times).not.toContain('12:00');
    expect(times).not.toContain('11:30');
    expect(times).toContain('15:45');
    expect(body.data.durationMin).toBe(15);
    expect(body.data.reason).toBeUndefined();
  });

  it('นพ.อนันต์ วันพุธ (ลาพักร้อน): คืน slots ว่างพร้อม reason DOCTOR_ON_LEAVE', async () => {
    const wednesday = addDaysIso(nextMonday, 2);

    const res = await request(app.getHttpServer())
      .get(`/api/doctors/${DR_ANAN}/availability`)
      .query({ date: wednesday, typeCode: 'FOLLOW_UP' })
      .expect(200);

    const body = res.body as AvailabilityResponseBody;
    expect(body.data.slots).toEqual([]);
    expect(body.data.reason).toBe('DOCTOR_ON_LEAVE');
  });

  it('พญ.มนัสนันท์ วันเสาร์: คืน reason SCHEDULE_NOT_BOOKABLE', async () => {
    const saturday = addDaysIso(nextMonday, 5);

    const res = await request(app.getHttpServer())
      .get(`/api/doctors/${DR_MANATNAN}/availability`)
      .query({ date: saturday, typeCode: 'FOLLOW_UP' })
      .expect(200);

    const body = res.body as AvailabilityResponseBody;
    expect(body.data.slots).toEqual([]);
    expect(body.data.reason).toBe('SCHEDULE_NOT_BOOKABLE');
  });

  it('typeCode ที่ไม่รู้จัก → 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/doctors/${DR_ANAN}/availability`)
      .query({ date: nextMonday, typeCode: 'NOT_A_TYPE' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('date ผิดรูปแบบ → 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/doctors/${DR_ANAN}/availability`)
      .query({ date: '31-08-2026', typeCode: 'FOLLOW_UP' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
