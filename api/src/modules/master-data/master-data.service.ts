import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { asc, eq, ilike, inArray, or } from 'drizzle-orm';

import { AppException } from '../../common/errors/app-exception';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { appointmentTypes, departments, doctors, doctorSchedules, patients, scheduleBreaks } from '../../db/schema';
import type { AppointmentTypeCode } from '../availability/availability.service';

const PATIENTS_LIMIT = 50;

export interface DepartmentDto {
  id: string;
  code: string;
  name: string;
  nameTh: string | null;
  isActive: boolean;
}

export interface DoctorDto {
  id: string;
  code: string;
  fullName: string;
  licenseNo: string | null;
  primaryDepartmentId: string;
  departmentCode: string;
  departmentName: string;
  isActive: boolean;
}

export interface PatientDto {
  id: string;
  hn: string;
  fullName: string;
  dateOfBirth: string | null;
  phone: string | null;
}

export interface AppointmentTypeDto {
  id: string;
  code: AppointmentTypeCode;
  name: string;
  nameTh: string | null;
  durationMin: number;
  bufferAfterMin: number;
  minLeadTimeMin: number;
  maxAdvanceDays: number;
  sortOrder: number;
}

export interface ScheduleBreakDto {
  id: string;
  startTime: string;
  endTime: string;
  label: string;
}

export interface DoctorScheduleDto {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotIntervalMin: number;
  acceptsBooking: boolean;
  validFrom: string;
  validTo: string | null;
  breaks: ScheduleBreakDto[];
}

@Injectable()
export class MasterDataService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async listDepartments(): Promise<DepartmentDto[]> {
    const rows = await this.db.select().from(departments).orderBy(asc(departments.code));

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      nameTh: row.nameTh,
      isActive: row.isActive,
    }));
  }

  async listDoctors(departmentId?: string): Promise<DoctorDto[]> {
    const rows = await this.db
      .select({
        id: doctors.id,
        code: doctors.code,
        fullName: doctors.fullName,
        licenseNo: doctors.licenseNo,
        primaryDepartmentId: doctors.primaryDepartmentId,
        isActive: doctors.isActive,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(doctors)
      .innerJoin(departments, eq(doctors.primaryDepartmentId, departments.id))
      .where(departmentId ? eq(doctors.primaryDepartmentId, departmentId) : undefined)
      .orderBy(asc(doctors.code));

    return rows;
  }

  async listPatients(q?: string): Promise<PatientDto[]> {
    const rows = await this.db
      .select()
      .from(patients)
      .where(q ? or(ilike(patients.hn, `%${q}%`), ilike(patients.fullName, `%${q}%`)) : undefined)
      .orderBy(asc(patients.hn))
      .limit(PATIENTS_LIMIT);

    return rows.map((row) => ({
      id: row.id,
      hn: row.hn,
      fullName: row.fullName,
      dateOfBirth: row.dateOfBirth,
      phone: row.phone,
    }));
  }

  async listAppointmentTypes(): Promise<AppointmentTypeDto[]> {
    const rows = await this.db
      .select()
      .from(appointmentTypes)
      .where(eq(appointmentTypes.isActive, true))
      .orderBy(asc(appointmentTypes.sortOrder));

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      nameTh: row.nameTh,
      durationMin: row.durationMin,
      bufferAfterMin: row.bufferAfterMin,
      minLeadTimeMin: row.minLeadTimeMin,
      maxAdvanceDays: row.maxAdvanceDays,
      sortOrder: row.sortOrder,
    }));
  }

  async getDoctorSchedules(doctorId: string): Promise<DoctorScheduleDto[]> {
    const [doctor] = await this.db.select({ id: doctors.id }).from(doctors).where(eq(doctors.id, doctorId)).limit(1);

    if (!doctor) {
      throw new AppException('NOT_FOUND', 'ไม่พบแพทย์นี้', { doctorId }, HttpStatus.NOT_FOUND);
    }

    const schedules = await this.db
      .select()
      .from(doctorSchedules)
      .where(eq(doctorSchedules.doctorId, doctorId))
      .orderBy(asc(doctorSchedules.dayOfWeek), asc(doctorSchedules.startTime));

    if (schedules.length === 0) {
      return [];
    }

    const breaks = await this.db
      .select()
      .from(scheduleBreaks)
      .where(
        inArray(
          scheduleBreaks.scheduleId,
          schedules.map((s) => s.id),
        ),
      );

    const breaksBySchedule = new Map<string, ScheduleBreakDto[]>();
    for (const b of breaks) {
      const list = breaksBySchedule.get(b.scheduleId) ?? [];
      list.push({ id: b.id, startTime: b.startTime, endTime: b.endTime, label: b.label });
      breaksBySchedule.set(b.scheduleId, list);
    }

    return schedules.map((s) => ({
      id: s.id,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      slotIntervalMin: s.slotIntervalMin,
      acceptsBooking: s.acceptsBooking,
      validFrom: s.validFrom,
      validTo: s.validTo,
      breaks: breaksBySchedule.get(s.id) ?? [],
    }));
  }
}
