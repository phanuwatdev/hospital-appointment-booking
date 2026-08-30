// -----------------------------------------------------------------------------
// แปล error code จาก api/ (ดู api/src/common/errors/error-codes.ts) เป็นข้อความไทยที่ผู้ใช้อ่านรู้เรื่อง
// -----------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  SLOT_TAKEN: 'ช่วงเวลานี้ถูกจองไปแล้ว กรุณาเลือกเวลาอื่น',
  PATIENT_DOUBLE_BOOKED: 'คนไข้มีนัดอื่นในช่วงเวลาเดียวกันอยู่แล้ว',
  OUTSIDE_WORKING_HOURS: 'อยู่นอกเวลาทำการของแพทย์',
  DURING_BREAK: 'ช่วงเวลานี้ทับเวลาพักของแพทย์',
  IN_THE_PAST: 'ไม่สามารถจองเวลาที่ผ่านมาแล้วได้',
  LEAD_TIME_VIOLATION: 'ต้องจองล่วงหน้าอย่างน้อยตามระยะเวลาที่กำหนด',
  TOO_FAR_IN_ADVANCE: 'จองล่วงหน้าไกลเกินไป กรุณาเลือกวันที่ใกล้กว่านี้',
  SCHEDULE_NOT_BOOKABLE: 'แพทย์ไม่เปิดรับนัดล่วงหน้าในวันนี้ (รับเฉพาะ walk-in)',
  DOCTOR_ON_LEAVE: 'แพทย์ลาในวันนี้',
  INVALID_STATUS_TRANSITION: 'ไม่สามารถเปลี่ยนสถานะนัดนี้ได้',
  CONCURRENT_MODIFICATION: 'ข้อมูลนัดนี้ถูกแก้ไขโดยคนอื่นไปก่อนแล้ว กรุณาลองใหม่',
  NOT_FOUND: 'ไม่พบข้อมูลที่ต้องการ',
  VALIDATION_ERROR: 'ข้อมูลที่ส่งมาไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
};

const FALLBACK_MESSAGE = 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง';

export function errorMessageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}
