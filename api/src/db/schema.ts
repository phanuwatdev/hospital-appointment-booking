// -----------------------------------------------------------------------------
// Drizzle schema — type layer สำหรับ query เท่านั้น
// โครงสร้างตารางจริงมาจาก db/migrations/0000_init.sql (เขียนมือ)
// ห้ามรัน drizzle-kit generate ทับไฟล์ migration ที่มีอยู่
// -----------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// -----------------------------------------------------------------------------
// Range types: tstzrange/daterange มีอยู่แล้วใน Postgres, timerange สร้างเองใน migration
// เก็บฝั่ง TS เป็น string ดิบตามที่ Postgres คืนมา (เช่น '["09:00:00","16:00:00")')
// เพราะคอลัมน์เหล่านี้เป็น generated column ใช้อ่านอย่างเดียว ไม่เคย insert/update
// -----------------------------------------------------------------------------
const tstzrange = customType<{ data: string }>({
  dataType() {
    return 'tstzrange';
  },
});

const daterange = customType<{ data: string }>({
  dataType() {
    return 'daterange';
  },
});

const timerange = customType<{ data: string }>({
  dataType() {
    return 'timerange';
  },
});

// =============================================================================
// Master data
// =============================================================================

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  nameTh: text('name_th'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const doctors = pgTable('doctors', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  fullName: text('full_name').notNull(),
  licenseNo: text('license_no').unique(),
  primaryDepartmentId: uuid('primary_department_id')
    .notNull()
    .references(() => departments.id, { onDelete: 'restrict' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const patients = pgTable('patients', {
  id: uuid('id').primaryKey().defaultRandom(),
  hn: text('hn').notNull().unique(),
  fullName: text('full_name').notNull(),
  dateOfBirth: date('date_of_birth', { mode: 'string' }),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const staffUsers = pgTable(
  'staff_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull().unique(),
    fullName: text('full_name').notNull(),
    role: text('role').notNull().default('staff').$type<'staff' | 'admin'>(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('staff_users_role_check', sql`${t.role} IN ('staff', 'admin')`)],
);

export const appointmentTypes = pgTable(
  'appointment_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code')
      .notNull()
      .unique()
      .$type<'NEW_PATIENT' | 'FOLLOW_UP' | 'CONSULTATION' | 'PROCEDURE'>(),
    name: text('name').notNull(),
    nameTh: text('name_th'),
    durationMin: integer('duration_min').notNull(),
    bufferAfterMin: integer('buffer_after_min').notNull().default(0),
    minLeadTimeMin: integer('min_lead_time_min').notNull().default(30),
    maxAdvanceDays: integer('max_advance_days').notNull().default(90),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    check(
      'appointment_types_code_check',
      sql`${t.code} IN ('NEW_PATIENT', 'FOLLOW_UP', 'CONSULTATION', 'PROCEDURE')`,
    ),
    check(
      'appointment_types_duration_check',
      sql`${t.durationMin} > 0 AND ${t.durationMin} % 5 = 0`,
    ),
    check('appointment_types_buffer_check', sql`${t.bufferAfterMin} >= 0`),
    check('appointment_types_lead_time_check', sql`${t.minLeadTimeMin} >= 0`),
    check('appointment_types_advance_check', sql`${t.maxAdvanceDays} > 0`),
  ],
);

// =============================================================================
// ตารางเวรแพทย์
// =============================================================================

export const doctorSchedules = pgTable(
  'doctor_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),

    // 0 = อาทิตย์ ... 6 = เสาร์
    dayOfWeek: smallint('day_of_week').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),

    slotIntervalMin: integer('slot_interval_min').notNull().default(15),
    acceptsBooking: boolean('accepts_booking').notNull().default(true),

    validFrom: date('valid_from', { mode: 'string' }).notNull().default(sql`CURRENT_DATE`),
    validTo: date('valid_to', { mode: 'string' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // generated columns — Postgres คำนวณเองจาก start_time/end_time และ valid_from/valid_to
    // ห้าม insert/update ตรงๆ (generatedAlwaysAs ทำให้ drizzle ตัดออกจาก insert/update type ให้อัตโนมัติ)
    shiftRange: timerange('shift_range').generatedAlwaysAs(
      sql`timerange(start_time, end_time, '[)')`,
    ),
    validity: daterange('validity').generatedAlwaysAs(
      sql`daterange(valid_from, valid_to, '[]')`,
    ),
  },
  (t) => [
    check('schedule_day_of_week_check', sql`${t.dayOfWeek} BETWEEN 0 AND 6`),
    check('schedule_time_order', sql`${t.endTime} > ${t.startTime}`),
    check('schedule_valid_range', sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
    index('idx_schedules_lookup').on(t.doctorId, t.dayOfWeek),
    // schedule_no_self_overlap: EXCLUDE USING gist — ประกาศไว้ใน migration SQL เท่านั้น
    // (drizzle-orm ยังไม่มี API สำหรับ EXCLUDE constraint)
  ],
);

export const scheduleBreaks = pgTable(
  'schedule_breaks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => doctorSchedules.id, { onDelete: 'cascade' }),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    label: text('label').notNull().default('พักกลางวัน'),

    breakRange: timerange('break_range').generatedAlwaysAs(
      sql`timerange(start_time, end_time, '[)')`,
    ),
  },
  (t) => [
    check('break_time_order', sql`${t.endTime} > ${t.startTime}`),
    index('idx_breaks_schedule').on(t.scheduleId),
    // break_no_overlap: EXCLUDE USING gist — ประกาศไว้ใน migration SQL เท่านั้น
  ],
);

export const scheduleExceptions = pgTable(
  'schedule_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'cascade' }),
    exceptionDate: date('exception_date', { mode: 'string' }).notNull(),
    kind: text('kind').notNull().$type<'DAY_OFF' | 'CUSTOM_HOURS'>(),
    startTime: time('start_time'),
    endTime: time('end_time'),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => staffUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('schedule_exceptions_kind_check', sql`${t.kind} IN ('DAY_OFF', 'CUSTOM_HOURS')`),
    check(
      'exception_hours_consistent',
      sql`(${t.kind} = 'DAY_OFF' AND ${t.startTime} IS NULL AND ${t.endTime} IS NULL)
          OR (${t.kind} = 'CUSTOM_HOURS' AND ${t.startTime} IS NOT NULL AND ${t.endTime} IS NOT NULL
              AND ${t.endTime} > ${t.startTime})`,
    ),
    unique('schedule_exceptions_doctor_date_unique').on(t.doctorId, t.exceptionDate),
    index('idx_exceptions_lookup').on(t.doctorId, t.exceptionDate),
  ],
);

// =============================================================================
// การนัดหมาย
// =============================================================================

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    appointmentNo: text('appointment_no')
      .notNull()
      .unique()
      .default(
        sql`'APT-' || to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD')
            || '-' || lpad(nextval('appointment_no_seq')::text, 4, '0')`,
      ),

    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    appointmentTypeId: uuid('appointment_type_id')
      .notNull()
      .references(() => appointmentTypes.id, { onDelete: 'restrict' }),

    // starts_at/ends_at/blocks_until คำนวณฝั่ง server เสมอ ห้ามรับค่าจาก client
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    blocksUntil: timestamp('blocks_until', { withTimezone: true }).notNull(),

    status: text('status')
      .notNull()
      .default('booked')
      .$type<'booked' | 'checked_in' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'>(),

    reason: text('reason'),
    notes: text('notes'),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => staffUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // optimistic locking — trigger touch_row() เดินค่านี้ให้อัตโนมัติทุกครั้งที่ UPDATE
    version: integer('version').notNull().default(1),

    idempotencyKey: text('idempotency_key'),

    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => staffUsers.id),
    cancellationReason: text('cancellation_reason'),

    rescheduledFromId: uuid('rescheduled_from_id').references(
      (): AnyPgColumn => appointments.id,
      { onDelete: 'set null' },
    ),

    // occupied_range = ช่วงที่กันเวลาแพทย์ไว้จริง (รวม buffer)
    // clinical_range = ช่วงที่คนไข้ต้องอยู่จริง (ไม่รวม buffer)
    occupiedRange: tstzrange('occupied_range').generatedAlwaysAs(
      sql`tstzrange(starts_at, blocks_until, '[)')`,
    ),
    clinicalRange: tstzrange('clinical_range').generatedAlwaysAs(
      sql`tstzrange(starts_at, ends_at, '[)')`,
    ),
  },
  (t) => [
    check(
      'appointments_status_check',
      sql`${t.status} IN ('booked', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show')`,
    ),
    check('appt_time_order', sql`${t.endsAt} > ${t.startsAt}`),
    check('appt_buffer_after_end', sql`${t.blocksUntil} >= ${t.endsAt}`),
    check(
      'appt_cancellation_complete',
      sql`(${t.status} = 'cancelled'
             AND ${t.cancelledAt} IS NOT NULL AND ${t.cancelledBy} IS NOT NULL
             AND ${t.cancellationReason} IS NOT NULL)
          OR (${t.status} <> 'cancelled'
             AND ${t.cancelledAt} IS NULL AND ${t.cancelledBy} IS NULL
             AND ${t.cancellationReason} IS NULL)`,
    ),
    uniqueIndex('idx_appt_idempotency')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index('idx_appt_patient').on(t.patientId, t.startsAt.desc()),
    index('idx_appt_doctor_day').on(t.doctorId, t.startsAt),
    index('idx_appt_active').on(t.startsAt).where(sql`${t.status} = 'booked'`),
    index('idx_appt_no').on(t.appointmentNo),
    // appt_no_doctor_overlap / appt_no_patient_overlap: EXCLUDE USING gist
    // นี่คือกลไกกันจองซ้อนหลักของระบบ ประกาศไว้ใน migration SQL เท่านั้น
    // (drizzle-orm ยังไม่มี API สำหรับ EXCLUDE constraint)
  ],
);
