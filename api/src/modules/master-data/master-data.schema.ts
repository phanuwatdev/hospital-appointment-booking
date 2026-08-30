import { z } from 'zod';

// รูปแบบ UUID แบบหลวม (8-4-4-4-12 hex) — ไม่เช็ค version/variant nibble
// เพราะ UUID ใน db/seed.sql เป็นค่าคงที่ที่อ่านง่าย ไม่ใช่ UUID v4 จริง (เหมือน availability.schema.ts)
const UUID_LIKE_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidLike = (message: string) => z.string().regex(UUID_LIKE_REGEX, message);

export const doctorIdParamSchema = uuidLike('doctorId ต้องเป็นรูปแบบ UUID');

export const doctorsQuerySchema = z.object({
  departmentId: uuidLike('departmentId ต้องเป็นรูปแบบ UUID').optional(),
});

export type DoctorsQuery = z.infer<typeof doctorsQuerySchema>;

export const patientsQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
});

export type PatientsQuery = z.infer<typeof patientsQuerySchema>;
