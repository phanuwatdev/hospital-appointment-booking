import { isValid, parse } from 'date-fns';
import { z } from 'zod';

import type { AppointmentStatus } from '../../domain/status';

// รูปแบบ UUID แบบหลวม (8-4-4-4-12 hex) — ไม่เช็ค version/variant nibble
// เพราะ UUID ใน db/seed.sql เป็นค่าคงที่ที่อ่านง่าย ไม่ใช่ UUID v4 จริง (เหมือน availability.schema.ts)
const UUID_LIKE_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidLike = (message: string) => z.string().regex(UUID_LIKE_REGEX, message);

// ต้องตรงกับ appointment_types.code ที่อนุญาตใน schema.ts
const APPOINTMENT_TYPE_CODES = ['NEW_PATIENT', 'FOLLOW_UP', 'CONSULTATION', 'PROCEDURE'] as const;

// ต้องตรงกับ AppointmentStatus ใน domain/status.ts
const APPOINTMENT_STATUSES = [
  'booked',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const satisfies readonly AppointmentStatus[];

export const staffIdHeaderSchema = uuidLike('X-Staff-Id ต้องเป็นรูปแบบ UUID');

// Idempotency-Key เป็น header อิสระ ไม่บังคับรูปแบบ UUID เพราะ client ฝั่งไหนก็ส่งได้
// แค่ไม่ว่างพอ ให้ตรงกับคอลัมน์ idempotency_key ที่เป็น text ธรรมดา
export const idempotencyKeyHeaderSchema = z.string().min(1).max(255).optional();

export const createAppointmentBodySchema = z.object({
  patientId: uuidLike('patientId ต้องเป็นรูปแบบ UUID'),
  doctorId: uuidLike('doctorId ต้องเป็นรูปแบบ UUID'),
  typeCode: z.enum(APPOINTMENT_TYPE_CODES),
  // ต้องมี offset เสมอ — ห้ามคลุมเครือว่าเป็นเวลาโซนไหน
  startsAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1).optional(),
});

export type CreateAppointmentBody = z.infer<typeof createAppointmentBodySchema>;

export const appointmentIdParamSchema = uuidLike('id ต้องเป็นรูปแบบ UUID');

// reason ห้ามว่าง ห้ามเป็นช่องว่างล้วน — .trim() ตัดช่องว่างหัวท้ายก่อนเช็ค .min(1)
export const cancelAppointmentBodySchema = z.object({
  reason: z.string().trim().min(1, 'ต้องระบุเหตุผลในการยกเลิก'),
});

export type CancelAppointmentBody = z.infer<typeof cancelAppointmentBodySchema>;

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ต้องเป็นรูปแบบ YYYY-MM-DD')
  .refine((value) => isValid(parse(value, 'yyyy-MM-dd', new Date())), 'date ไม่ใช่วันที่ที่มีอยู่จริง');

// ทุก filter เป็น optional — ไม่ระบุตัวไหนเลยก็ query ได้ (คืนทุกนัด เรียงตาม starts_at)
export const listAppointmentsQuerySchema = z.object({
  doctorId: uuidLike('doctorId ต้องเป็นรูปแบบ UUID').optional(),
  patientId: uuidLike('patientId ต้องเป็นรูปแบบ UUID').optional(),
  date: dateOnlySchema.optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});

export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
