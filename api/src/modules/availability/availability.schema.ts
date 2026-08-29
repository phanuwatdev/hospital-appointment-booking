import { isValid, parse } from 'date-fns';
import { z } from 'zod';

// รูปแบบ UUID แบบหลวม (8-4-4-4-12 hex) — ไม่เช็ค version/variant nibble
// เพราะ UUID ใน db/seed.sql เป็นค่าคงที่ที่อ่านง่าย ไม่ใช่ UUID v4 จริง
const UUID_LIKE_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const doctorIdParamSchema = z
  .string()
  .regex(UUID_LIKE_REGEX, 'doctorId ต้องเป็นรูปแบบ UUID');

// ต้องตรงกับ appointment_types.code ที่อนุญาตใน schema.ts
const APPOINTMENT_TYPE_CODES = ['NEW_PATIENT', 'FOLLOW_UP', 'CONSULTATION', 'PROCEDURE'] as const;

export const availabilityQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ต้องเป็นรูปแบบ YYYY-MM-DD')
    .refine((value) => isValid(parse(value, 'yyyy-MM-dd', new Date())), 'date ไม่ใช่วันที่ที่มีอยู่จริง'),
  typeCode: z.enum(APPOINTMENT_TYPE_CODES),
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
