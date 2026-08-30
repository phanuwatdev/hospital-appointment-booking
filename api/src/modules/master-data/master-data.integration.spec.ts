import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppExceptionFilter } from '../../common/filters/app-exception.filter';
import { DbModule } from '../../db/db.module';
import { MasterDataModule } from './master-data.module';

// UUID จาก db/seed.sql — ตรงกับ docs/api.http
const DEPT_IM = '11111111-1111-1111-1111-111111111101';
const DR_ANAN = '22222222-2222-2222-2222-222222222201'; // D001 — IM, จ–ศ 09:00–16:00 พักเที่ยง 12:00–13:00
const NOT_A_DOCTOR = '22222222-2222-2222-2222-222222222299';

interface DataResponse<T> {
  data: T[];
}

interface DepartmentBody {
  id: string;
  code: string;
  name: string;
}

interface DoctorBody {
  id: string;
  code: string;
  departmentCode: string;
  departmentName: string;
}

interface PatientBody {
  id: string;
  hn: string;
  fullName: string;
}

interface AppointmentTypeBody {
  code: string;
  sortOrder: number;
}

interface ScheduleBody {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  breaks: { startTime: string; endTime: string }[];
}

describe('master-data endpoints (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule, MasterDataModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/departments คืนแผนกทั้ง 4 เรียงตาม code', async () => {
    const res = await request(app.getHttpServer()).get('/api/departments').expect(200);
    const body = res.body as DataResponse<DepartmentBody>;

    expect(body.data.map((d) => d.code)).toEqual(['CARDIO', 'IM', 'ORTHO', 'PEDS']);
  });

  it('GET /api/doctors คืนแพทย์ทั้ง 5 พร้อมชื่อแผนก เรียงตาม code', async () => {
    const res = await request(app.getHttpServer()).get('/api/doctors').expect(200);
    const body = res.body as DataResponse<DoctorBody>;

    expect(body.data.map((d) => d.code)).toEqual(['D001', 'D002', 'D003', 'D004', 'D005']);
    const anan = body.data.find((d) => d.id === DR_ANAN);
    expect(anan?.departmentCode).toBe('IM');
    expect(anan?.departmentName).toBe('Internal Medicine');
  });

  it('GET /api/doctors?departmentId= กรองเฉพาะแพทย์แผนกนั้น', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/doctors')
      .query({ departmentId: DEPT_IM })
      .expect(200);
    const body = res.body as DataResponse<DoctorBody>;

    expect(body.data.map((d) => d.code)).toEqual(['D001', 'D002']);
  });

  it('GET /api/patients คืนคนไข้ทั้ง 5 เรียงตาม hn', async () => {
    const res = await request(app.getHttpServer()).get('/api/patients').expect(200);
    const body = res.body as DataResponse<PatientBody>;

    expect(body.data.map((p) => p.hn)).toEqual(['HN000001', 'HN000002', 'HN000003', 'HN000004', 'HN000005']);
  });

  it('GET /api/patients?q= ค้นจาก full_name ได้', async () => {
    const res = await request(app.getHttpServer()).get('/api/patients').query({ q: 'วิชัย' }).expect(200);
    const body = res.body as DataResponse<PatientBody>;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].hn).toBe('HN000001');
  });

  it('GET /api/patients?q= ค้นจาก hn ได้', async () => {
    const res = await request(app.getHttpServer()).get('/api/patients').query({ q: 'HN000002' }).expect(200);
    const body = res.body as DataResponse<PatientBody>;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].fullName).toBe('สุนีย์ แสงทอง');
  });

  it('GET /api/appointment-types คืนเฉพาะ active เรียงตาม sort_order', async () => {
    const res = await request(app.getHttpServer()).get('/api/appointment-types').expect(200);
    const body = res.body as DataResponse<AppointmentTypeBody>;

    expect(body.data.map((t) => t.code)).toEqual(['NEW_PATIENT', 'FOLLOW_UP', 'CONSULTATION', 'PROCEDURE']);
  });

  it('GET /api/doctors/:id/schedules คืนตารางเวรพร้อม breaks ที่ผูกอยู่', async () => {
    const res = await request(app.getHttpServer()).get(`/api/doctors/${DR_ANAN}/schedules`).expect(200);
    const body = res.body as DataResponse<ScheduleBody>;

    expect(body.data).toHaveLength(5);
    expect(body.data.map((s) => s.dayOfWeek)).toEqual([1, 2, 3, 4, 5]);
    for (const schedule of body.data) {
      expect(schedule.startTime).toBe('09:00:00');
      expect(schedule.endTime).toBe('16:00:00');
      expect(schedule.breaks).toHaveLength(1);
      expect(schedule.breaks[0].startTime).toBe('12:00:00');
      expect(schedule.breaks[0].endTime).toBe('13:00:00');
    }
  });

  it('GET /api/doctors/:id/schedules ไม่เจอ doctor → 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get(`/api/doctors/${NOT_A_DOCTOR}/schedules`).expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/doctors/:id/schedules id ผิดรูปแบบ → 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer()).get('/api/doctors/not-a-uuid/schedules').expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
