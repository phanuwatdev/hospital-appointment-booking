// -----------------------------------------------------------------------------
// helper แปลงระหว่าง "วันที่/เวลาท้องถิ่น Asia/Bangkok" กับ Date (UTC instant)
// ล้วนเป็น pure function ไม่พึ่ง DB — ใช้ประกอบ input ให้ domain/slots.ts
// -----------------------------------------------------------------------------

import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export const HOSPITAL_TIMEZONE = 'Asia/Bangkok';

/** 0 = อาทิตย์ ... 6 = เสาร์ ตรงกับ EXTRACT(DOW) ของ Postgres — คำนวณจากปฏิทินล้วนๆ ไม่เกี่ยว timezone */
export function dayOfWeekOf(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** บวกวันแบบปฏิทินล้วนๆ คืนสตริง YYYY-MM-DD */
export function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** รวม "YYYY-MM-DD" กับ "HH:MM:SS" ตีความเป็นเวลาท้องถิ่น Asia/Bangkok แล้วคืน Date (UTC instant) */
export function toBangkokInstant(isoDate: string, localTime: string): Date {
  return fromZonedTime(`${isoDate}T${localTime}`, HOSPITAL_TIMEZONE);
}

/** แปลง Date เป็นสตริง ISO พร้อม offset +07:00 เช่น 2026-08-31T10:00:00+07:00 */
export function formatBangkokIso(instant: Date): string {
  return formatInTimeZone(instant, HOSPITAL_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** วันที่ปฏิทินท้องถิ่น Asia/Bangkok ของ instant นั้น เช่น "2026-09-07" */
export function bangkokDateOf(instant: Date): string {
  return formatInTimeZone(instant, HOSPITAL_TIMEZONE, 'yyyy-MM-dd');
}
