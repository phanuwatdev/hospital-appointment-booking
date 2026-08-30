import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lt, lte, or, type SQL } from 'drizzle-orm';
import postgres from 'postgres';

import { AppException } from '../../common/errors/app-exception';
import {
  checkTimingRules,
  checkWorkingHoursRules,
  type BookingRuleErrorCode,
} from '../../domain/booking-rules';
import type { Interval } from '../../domain/slots';
import { canTransition, type AppointmentStatus } from '../../domain/status';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import {
  appointments,
  appointmentTypes,
  doctors,
  doctorSchedules,
  scheduleBreaks,
  scheduleExceptions,
} from '../../db/schema';
import type { AppointmentTypeCode } from '../availability/availability.service';
import {
  addDaysIso,
  bangkokDateOf,
  dayOfWeekOf,
  formatBangkokIso,
  toBangkokInstant,
} from '../availability/local-time.util';

export type { AppointmentStatus };

export interface CreateAppointmentInput {
  patientId: string;
  doctorId: string;
  typeCode: AppointmentTypeCode;
  /** ISO 8601 พร้อม offset — เวลาที่คนไข้ต้องการจอง ตามที่ client ส่งมา */
  startsAt: string;
  reason?: string;
  /** จาก header X-Staff-Id */
  createdBy: string;
  /** จาก header Idempotency-Key (ถ้ามี) */
  idempotencyKey?: string;
}

export interface AppointmentDto {
  id: string;
  appointmentNo: string;
  patientId: string;
  doctorId: string;
  departmentId: string;
  typeCode: AppointmentTypeCode;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  reason: string | null;
  createdBy: string;
  version: number;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
}

export interface CreateAppointmentResult {
  appointment: AppointmentDto;
  /** true = สร้างใหม่ (ควรตอบ 201), false = idempotent replay (ควรตอบ 200) */
  created: boolean;
}

export interface ListAppointmentsFilter {
  doctorId?: string;
  patientId?: string;
  /** YYYY-MM-DD ตามปฏิทินท้องถิ่น Asia/Bangkok */
  date?: string;
  status?: AppointmentStatus;
}

export interface CancelAppointmentInput {
  id: string;
  reason: string;
  /** จาก header X-Staff-Id — คนที่กดยกเลิก */
  staffId: string;
}

// ผลลัพธ์จาก select ที่ join กับ appointment_types เพื่อเอา typeCode มาด้วย
// ใช้ทุกที่ที่ต้อง map เป็น AppointmentDto: idempotency replay, get by id, list, cancel
type AppointmentRow = {
  id: string;
  appointmentNo: string;
  patientId: string;
  doctorId: string;
  departmentId: string;
  typeCode: AppointmentTypeCode;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  reason: string | null;
  createdBy: string;
  version: number;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
};

const IDEMPOTENCY_UNIQUE_INDEX = 'idx_appt_idempotency';
const DOCTOR_OVERLAP_CONSTRAINT = 'appt_no_doctor_overlap';
const PATIENT_OVERLAP_CONSTRAINT = 'appt_no_patient_overlap';

// คอลัมน์มาตรฐานสำหรับ select ที่ join appointment_types แล้ว — ใช้ร่วมกันทุก query ที่คืน AppointmentDto
const APPOINTMENT_ROW_COLUMNS = {
  id: appointments.id,
  appointmentNo: appointments.appointmentNo,
  patientId: appointments.patientId,
  doctorId: appointments.doctorId,
  departmentId: appointments.departmentId,
  typeCode: appointmentTypes.code,
  startsAt: appointments.startsAt,
  endsAt: appointments.endsAt,
  status: appointments.status,
  reason: appointments.reason,
  createdBy: appointments.createdBy,
  version: appointments.version,
  cancelledAt: appointments.cancelledAt,
  cancelledBy: appointments.cancelledBy,
  cancellationReason: appointments.cancellationReason,
} as const;

@Injectable()
export class AppointmentsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async createAppointment(input: CreateAppointmentInput): Promise<CreateAppointmentResult> {
    // ----- a. idempotency replay — ต้องเช็คก่อนทุกอย่าง คืน 200 ใบเดิม ไม่ใช่สร้างซ้ำ -----
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        return { appointment: this.toDto(existing), created: false };
      }
    }

    // ----- b. ประเภทการนัด -----
    const [appointmentType] = await this.db
      .select()
      .from(appointmentTypes)
      .where(eq(appointmentTypes.code, input.typeCode))
      .limit(1);

    if (!appointmentType) {
      throw new AppException('VALIDATION_ERROR', `ไม่พบประเภทการนัด: ${input.typeCode}`, {
        typeCode: input.typeCode,
      });
    }

    // ----- c. คำนวณเวลาฝั่ง server เท่านั้น -----
    const startsAt = new Date(input.startsAt);
    const now = new Date();
    const endsAt = new Date(startsAt.getTime() + appointmentType.durationMin * 60_000);
    const blocksUntil = new Date(
      startsAt.getTime() + (appointmentType.durationMin + appointmentType.bufferAfterMin) * 60_000,
    );

    // ----- กฎเรื่องเวลาล้วนๆ (ไม่ต้องแตะ DB เลย) ต้องตรวจก่อน query ตารางเวรเสมอ —
    // ทั้งเพื่อให้ error ตรงกับความผิดของผู้ใช้จริงๆ (เช่นจองย้อนหลังควรได้ IN_THE_PAST
    // ไม่ใช่ OUTSIDE_WORKING_HOURS เพราะบังเอิญไม่มีตารางเวรของวันนั้นในอดีต)
    // และเพื่อไม่ query ตารางเวรโดยเปล่าประโยชน์เมื่อ request ผิดอยู่แล้วตั้งแต่ต้น
    const timingError = checkTimingRules({
      startsAt,
      now,
      minLeadTimeMin: appointmentType.minLeadTimeMin,
      maxAdvanceDays: appointmentType.maxAdvanceDays,
    });

    if (timingError) {
      throw new AppException(timingError, this.messageFor(timingError), {
        doctorId: input.doctorId,
        startsAt: input.startsAt,
      });
    }

    // แพทย์ — ต้องมีเพื่อใช้ primary_department_id เป็น department เริ่มต้น (ไม่มี departmentId ใน request)
    const [doctor] = await this.db
      .select({ primaryDepartmentId: doctors.primaryDepartmentId })
      .from(doctors)
      .where(eq(doctors.id, input.doctorId))
      .limit(1);

    if (!doctor) {
      throw new AppException('VALIDATION_ERROR', `ไม่พบแพทย์: ${input.doctorId}`, { doctorId: input.doctorId });
    }

    const localDate = bangkokDateOf(startsAt);
    const dayOfWeek = dayOfWeekOf(localDate);

    // ----- d. ตารางเวรของวันนั้น -----
    const schedulesOfDay = await this.db
      .select()
      .from(doctorSchedules)
      .where(
        and(
          eq(doctorSchedules.doctorId, input.doctorId),
          eq(doctorSchedules.dayOfWeek, dayOfWeek),
          lte(doctorSchedules.validFrom, localDate),
          or(isNull(doctorSchedules.validTo), gte(doctorSchedules.validTo, localDate)),
        ),
      );

    if (schedulesOfDay.length === 0) {
      throw new AppException('OUTSIDE_WORKING_HOURS', 'แพทย์ไม่มีตารางเวรในวันนี้', {
        doctorId: input.doctorId,
        date: localDate,
      });
    }

    const bookableSchedules = schedulesOfDay
      .filter((s) => s.acceptsBooking)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    if (bookableSchedules.length === 0) {
      throw new AppException('SCHEDULE_NOT_BOOKABLE', 'แพทย์ไม่เปิดรับนัดล่วงหน้าในวันนี้', {
        doctorId: input.doctorId,
        date: localDate,
      });
    }

    const schedule = bookableSchedules[0];

    // ----- e. ข้อยกเว้นของวันนั้น -----
    const [exception] = await this.db
      .select()
      .from(scheduleExceptions)
      .where(and(eq(scheduleExceptions.doctorId, input.doctorId), eq(scheduleExceptions.exceptionDate, localDate)))
      .limit(1);

    if (exception?.kind === 'DAY_OFF') {
      throw new AppException('DOCTOR_ON_LEAVE', 'แพทย์ลาในวันนี้', { doctorId: input.doctorId, date: localDate });
    }

    // exception_hours_consistent (DB CHECK) รับประกันว่า CUSTOM_HOURS ต้องมี start/end เสมอ
    const workStartLocal = exception?.kind === 'CUSTOM_HOURS' ? exception.startTime! : schedule.startTime;
    const workEndLocal = exception?.kind === 'CUSTOM_HOURS' ? exception.endTime! : schedule.endTime;

    // ----- f. เวลาทำการ/พัก ตรวจผ่าน domain/booking-rules.ts (ต้องมีตารางเวร resolve แล้วเท่านั้น) -----
    const breaksOfSchedule = await this.db
      .select()
      .from(scheduleBreaks)
      .where(eq(scheduleBreaks.scheduleId, schedule.id));

    const breakIntervals: Interval[] = breaksOfSchedule.map((b) => ({
      start: toBangkokInstant(localDate, b.startTime),
      end: toBangkokInstant(localDate, b.endTime),
    }));

    const workingHoursError = checkWorkingHoursRules({
      startsAt,
      durationMin: appointmentType.durationMin,
      bufferMin: appointmentType.bufferAfterMin,
      workStart: toBangkokInstant(localDate, workStartLocal),
      workEnd: toBangkokInstant(localDate, workEndLocal),
      breaks: breakIntervals,
    });

    if (workingHoursError) {
      throw new AppException(workingHoursError, this.messageFor(workingHoursError), {
        doctorId: input.doctorId,
        startsAt: input.startsAt,
      });
    }

    // ----- g. INSERT ตรง ห้าม SELECT เช็คก่อน — การกันจองซ้อนพึ่ง exclusion constraint ใน Postgres ล้วนๆ -----
    try {
      const [inserted] = await this.db
        .insert(appointments)
        .values({
          patientId: input.patientId,
          doctorId: input.doctorId,
          departmentId: doctor.primaryDepartmentId,
          appointmentTypeId: appointmentType.id,
          startsAt,
          endsAt,
          blocksUntil,
          reason: input.reason,
          createdBy: input.createdBy,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();

      const appointment: AppointmentDto = {
        id: inserted.id,
        appointmentNo: inserted.appointmentNo,
        patientId: inserted.patientId,
        doctorId: inserted.doctorId,
        departmentId: inserted.departmentId,
        typeCode: input.typeCode,
        startsAt: formatBangkokIso(inserted.startsAt),
        endsAt: formatBangkokIso(inserted.endsAt),
        status: inserted.status,
        reason: inserted.reason,
        createdBy: inserted.createdBy,
        version: inserted.version,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
      };

      return { appointment, created: true };
    } catch (err) {
      // drizzle ห่อ error จริงจาก postgres.js ไว้ใน DrizzleQueryError เสมอ ตัว error ดิบอยู่ที่ .cause
      const cause = err instanceof Error ? err.cause : undefined;

      if (cause instanceof postgres.PostgresError) {
        if (cause.code === '23P01' && cause.constraint_name === DOCTOR_OVERLAP_CONSTRAINT) {
          throw new AppException(
            'SLOT_TAKEN',
            'ช่วงเวลานี้ถูกจองไปแล้ว',
            { doctorId: input.doctorId, startsAt: input.startsAt },
            HttpStatus.CONFLICT,
          );
        }

        if (cause.code === '23P01' && cause.constraint_name === PATIENT_OVERLAP_CONSTRAINT) {
          throw new AppException(
            'PATIENT_DOUBLE_BOOKED',
            'คนไข้มีนัดอื่นในช่วงเวลาเดียวกันแล้ว',
            { patientId: input.patientId, startsAt: input.startsAt },
            HttpStatus.CONFLICT,
          );
        }

        if (cause.code === '23505' && cause.constraint_name === IDEMPOTENCY_UNIQUE_INDEX && input.idempotencyKey) {
          // มี request อื่นที่ใช้ idempotency key เดียวกัน insert สำเร็จไปก่อนแบบ race — กู้ใบเดิมมาคืนแทน
          const existing = await this.findByIdempotencyKey(input.idempotencyKey);
          if (existing) {
            return { appointment: this.toDto(existing), created: false };
          }
        }
      }

      throw err;
    }
  }

  /** ดูรายละเอียดนัดใบเดียว — โยน NOT_FOUND ถ้าไม่เจอ */
  async getAppointmentById(id: string): Promise<AppointmentDto> {
    const row = await this.findById(id);
    if (!row) {
      throw new AppException('NOT_FOUND', 'ไม่พบนัดหมายนี้', { id }, HttpStatus.NOT_FOUND);
    }
    return this.toDto(row);
  }

  /** filter ได้ทุกตัว optional เรียงตาม starts_at */
  async listAppointments(filter: ListAppointmentsFilter): Promise<AppointmentDto[]> {
    const conditions: SQL[] = [];

    if (filter.doctorId) {
      conditions.push(eq(appointments.doctorId, filter.doctorId));
    }
    if (filter.patientId) {
      conditions.push(eq(appointments.patientId, filter.patientId));
    }
    if (filter.status) {
      conditions.push(eq(appointments.status, filter.status));
    }
    if (filter.date) {
      const dayStart = toBangkokInstant(filter.date, '00:00:00');
      const dayEnd = toBangkokInstant(addDaysIso(filter.date, 1), '00:00:00');
      conditions.push(gte(appointments.startsAt, dayStart));
      conditions.push(lt(appointments.startsAt, dayEnd));
    }

    const rows = await this.db
      .select(APPOINTMENT_ROW_COLUMNS)
      .from(appointments)
      .innerJoin(appointmentTypes, eq(appointments.appointmentTypeId, appointmentTypes.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(appointments.startsAt);

    return rows.map((row) => this.toDto(row));
  }

  async cancelAppointment(input: CancelAppointmentInput): Promise<AppointmentDto> {
    const current = await this.findById(input.id);
    if (!current) {
      throw new AppException('NOT_FOUND', 'ไม่พบนัดหมายนี้', { id: input.id }, HttpStatus.NOT_FOUND);
    }

    if (!canTransition(current.status, 'cancelled')) {
      throw new AppException(
        'INVALID_STATUS_TRANSITION',
        `ไม่สามารถยกเลิกนัดที่มีสถานะ ${current.status} ได้`,
        { id: input.id, from: current.status, to: 'cancelled' },
        HttpStatus.CONFLICT,
      );
    }

    // optimistic locking — WHERE ...AND version=<version ที่อ่านมาก่อนหน้า>
    // ถ้ามีคนอื่นแก้แถวนี้ไปก่อนแล้ว (version เปลี่ยน) rowCount จะเป็น 0
    const [updated] = await this.db
      .update(appointments)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: input.staffId,
        cancellationReason: input.reason,
      })
      .where(and(eq(appointments.id, input.id), eq(appointments.version, current.version)))
      .returning();

    if (!updated) {
      throw new AppException(
        'CONCURRENT_MODIFICATION',
        'ข้อมูลนัดนี้ถูกแก้ไขโดยคนอื่นไปก่อนแล้ว กรุณาลองใหม่',
        { id: input.id },
        HttpStatus.CONFLICT,
      );
    }

    return this.toDto({ ...updated, typeCode: current.typeCode });
  }

  private async findById(id: string): Promise<AppointmentRow | undefined> {
    const [row] = await this.db
      .select(APPOINTMENT_ROW_COLUMNS)
      .from(appointments)
      .innerJoin(appointmentTypes, eq(appointments.appointmentTypeId, appointmentTypes.id))
      .where(eq(appointments.id, id))
      .limit(1);

    return row;
  }

  private async findByIdempotencyKey(idempotencyKey: string): Promise<AppointmentRow | undefined> {
    const [row] = await this.db
      .select(APPOINTMENT_ROW_COLUMNS)
      .from(appointments)
      .innerJoin(appointmentTypes, eq(appointments.appointmentTypeId, appointmentTypes.id))
      .where(eq(appointments.idempotencyKey, idempotencyKey))
      .limit(1);

    return row;
  }

  private toDto(row: AppointmentRow): AppointmentDto {
    return {
      id: row.id,
      appointmentNo: row.appointmentNo,
      patientId: row.patientId,
      doctorId: row.doctorId,
      departmentId: row.departmentId,
      typeCode: row.typeCode,
      startsAt: formatBangkokIso(row.startsAt),
      endsAt: formatBangkokIso(row.endsAt),
      status: row.status,
      reason: row.reason,
      createdBy: row.createdBy,
      version: row.version,
      cancelledAt: row.cancelledAt ? formatBangkokIso(row.cancelledAt) : null,
      cancelledBy: row.cancelledBy,
      cancellationReason: row.cancellationReason,
    };
  }

  private messageFor(code: BookingRuleErrorCode): string {
    switch (code) {
      case 'IN_THE_PAST':
        return 'ไม่สามารถจองเวลาที่ผ่านมาแล้วได้';
      case 'LEAD_TIME_VIOLATION':
        return 'ต้องจองล่วงหน้าอย่างน้อยตามระยะเวลาที่กำหนด';
      case 'TOO_FAR_IN_ADVANCE':
        return 'จองล่วงหน้าไกลเกินไป';
      case 'OUTSIDE_WORKING_HOURS':
        return 'อยู่นอกเวลาทำการของแพทย์';
      case 'DURING_BREAK':
        return 'ช่วงเวลานี้ทับเวลาพักของแพทย์';
    }
  }
}
