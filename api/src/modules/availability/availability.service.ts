import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';

import { AppException } from '../../common/errors/app-exception';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import {
  appointments,
  appointmentTypes,
  doctorSchedules,
  scheduleBreaks,
  scheduleExceptions,
} from '../../db/schema';
import { generateSlots, type Interval } from '../../domain/slots';
import { addDaysIso, dayOfWeekOf, formatBangkokIso, toBangkokInstant } from './local-time.util';

export type AppointmentTypeCode = 'NEW_PATIENT' | 'FOLLOW_UP' | 'CONSULTATION' | 'PROCEDURE';

export type AvailabilityReason = 'NO_SCHEDULE' | 'SCHEDULE_NOT_BOOKABLE' | 'DOCTOR_ON_LEAVE' | 'FULLY_BOOKED';

export interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
}

export interface AvailabilityResult {
  doctorId: string;
  date: string;
  typeCode: AppointmentTypeCode;
  durationMin: number;
  slots: AvailabilitySlot[];
  reason?: AvailabilityReason;
}

@Injectable()
export class AvailabilityService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async getAvailability(
    doctorId: string,
    date: string,
    typeCode: AppointmentTypeCode,
  ): Promise<AvailabilityResult> {
    // ----- 1. ประเภทการนัด -----
    const [appointmentType] = await this.db
      .select()
      .from(appointmentTypes)
      .where(eq(appointmentTypes.code, typeCode))
      .limit(1);

    if (!appointmentType) {
      throw new AppException('VALIDATION_ERROR', `ไม่พบประเภทการนัด: ${typeCode}`, { typeCode });
    }

    const noSlots = (reason: AvailabilityReason): AvailabilityResult => ({
      doctorId,
      date,
      typeCode,
      durationMin: appointmentType.durationMin,
      slots: [],
      reason,
    });

    // ----- 2. ตารางเวรของวันนั้น -----
    const dayOfWeek = dayOfWeekOf(date);
    const schedulesOfDay = await this.db
      .select()
      .from(doctorSchedules)
      .where(
        and(
          eq(doctorSchedules.doctorId, doctorId),
          eq(doctorSchedules.dayOfWeek, dayOfWeek),
          lte(doctorSchedules.validFrom, date),
          or(isNull(doctorSchedules.validTo), gte(doctorSchedules.validTo, date)),
        ),
      );

    if (schedulesOfDay.length === 0) {
      return noSlots('NO_SCHEDULE');
    }

    const bookableSchedules = schedulesOfDay
      .filter((s) => s.acceptsBooking)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    if (bookableSchedules.length === 0) {
      return noSlots('SCHEDULE_NOT_BOOKABLE');
    }

    const schedule = bookableSchedules[0];

    // ----- 3. ข้อยกเว้นของวันนั้น -----
    const [exception] = await this.db
      .select()
      .from(scheduleExceptions)
      .where(and(eq(scheduleExceptions.doctorId, doctorId), eq(scheduleExceptions.exceptionDate, date)))
      .limit(1);

    if (exception?.kind === 'DAY_OFF') {
      return noSlots('DOCTOR_ON_LEAVE');
    }

    // exception_hours_consistent (DB CHECK) รับประกันว่า CUSTOM_HOURS ต้องมี start/end เสมอ
    const workStartLocal = exception?.kind === 'CUSTOM_HOURS' ? exception.startTime! : schedule.startTime;
    const workEndLocal = exception?.kind === 'CUSTOM_HOURS' ? exception.endTime! : schedule.endTime;

    // ----- 4. เวลาพักของตารางเวรนั้น -----
    const breaks = await this.db.select().from(scheduleBreaks).where(eq(scheduleBreaks.scheduleId, schedule.id));

    // ----- 5. นัดที่จองแล้วในวันนั้น — เทียบด้วย occupied_range ให้ตรงกับ exclusion constraint -----
    const dayStart = toBangkokInstant(date, '00:00:00');
    const dayEnd = toBangkokInstant(addDaysIso(date, 1), '00:00:00');

    const bookedAppointments = await this.db
      .select({ startsAt: appointments.startsAt, blocksUntil: appointments.blocksUntil })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          ne(appointments.status, 'cancelled'),
          sql`${appointments.occupiedRange} && tstzrange(${dayStart.toISOString()}::timestamptz, ${dayEnd.toISOString()}::timestamptz, '[)')`,
        ),
      );

    // ----- 6. แปลง local time เป็น Date (Asia/Bangkok) แล้วเรียก generateSlots -----
    const breakIntervals: Interval[] = breaks.map((b) => ({
      start: toBangkokInstant(date, b.startTime),
      end: toBangkokInstant(date, b.endTime),
    }));

    const bookedIntervals: Interval[] = bookedAppointments.map((a) => ({
      start: a.startsAt,
      end: a.blocksUntil,
    }));

    const slotStarts = generateSlots({
      workStart: toBangkokInstant(date, workStartLocal),
      workEnd: toBangkokInstant(date, workEndLocal),
      breaks: breakIntervals,
      booked: bookedIntervals,
      durationMin: appointmentType.durationMin,
      bufferMin: appointmentType.bufferAfterMin,
      stepMin: schedule.slotIntervalMin,
      now: new Date(),
      leadTimeMin: appointmentType.minLeadTimeMin,
    });

    // ----- 7. ผลลัพธ์ -----
    if (slotStarts.length === 0) {
      return noSlots('FULLY_BOOKED');
    }

    const slots: AvailabilitySlot[] = slotStarts.map((start) => {
      const end = new Date(start.getTime() + appointmentType.durationMin * 60_000);
      return { startsAt: formatBangkokIso(start), endsAt: formatBangkokIso(end) };
    });

    return {
      doctorId,
      date,
      typeCode,
      durationMin: appointmentType.durationMin,
      slots,
    };
  }
}
