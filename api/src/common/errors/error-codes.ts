// -----------------------------------------------------------------------------
// รายการ error code ทั้งหมดที่ API ตอบกลับได้ — ต้องตรงกับ docs/api.http เท่านั้น
// ห้ามเพิ่ม code ใหม่ที่ไม่มีอยู่ใน docs/api.http
// -----------------------------------------------------------------------------

export const ERROR_CODES = [
  'SLOT_TAKEN',
  'OUTSIDE_WORKING_HOURS',
  'DURING_BREAK',
  'IN_THE_PAST',
  'SCHEDULE_NOT_BOOKABLE',
  'DOCTOR_ON_LEAVE',
  'PATIENT_DOUBLE_BOOKED',
  'TOO_FAR_IN_ADVANCE',
  'LEAD_TIME_VIOLATION',
  'INVALID_STATUS_TRANSITION',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONCURRENT_MODIFICATION',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
