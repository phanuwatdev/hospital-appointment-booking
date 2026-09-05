// -----------------------------------------------------------------------------
// กฎการรับจองนัด — pure function ล้วน
//
// ไฟล์นี้ห้ามพึ่งพา NestJS, drizzle หรือฐานข้อมูลใดๆ (เหมือน slots.ts)
//
// แยกเป็นสองกลุ่มตามความจำเป็นในการ query DB:
//   checkTimingRules      — ไม่ต้องแตะ DB เลย (ใช้แค่ appointment_type ที่ query มาแล้ว)
//                            ต้องเรียกก่อนเสมอ ก่อนที่ service จะไป query ตารางเวร
//                            เพื่อให้ error ตรงกับความผิดของผู้ใช้จริงๆ และไม่ query โดยเปล่าประโยชน์
//   checkWorkingHoursRules — ต้องมีตารางเวรที่ resolve แล้ว (workStart/workEnd/breaks จริง)
//                            เรียกหลังจาก service เช็คว่ามีตารางเวรและไม่ได้ลาแล้วเท่านั้น
// -----------------------------------------------------------------------------

import { intervalContains, intervalsOverlap, subtractIntervals, type Interval } from './slots';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

export type TimingRuleErrorCode = 'IN_THE_PAST' | 'LEAD_TIME_VIOLATION' | 'TOO_FAR_IN_ADVANCE';
export type WorkingHoursRuleErrorCode = 'OUTSIDE_WORKING_HOURS' | 'DURING_BREAK';
export type BookingRuleErrorCode = TimingRuleErrorCode | WorkingHoursRuleErrorCode;

export interface TimingRulesInput {
  /** เวลาเริ่มนัดที่ขอจอง */
  startsAt: Date;
  /** เวลาปัจจุบันฝั่ง server — ห้ามเชื่อเวลาจาก client */
  now: Date;
  /** ต้องจองล่วงหน้าอย่างน้อยกี่นาที */
  minLeadTimeMin: number;
  /** จองล่วงหน้าได้ไม่เกินกี่วัน */
  maxAdvanceDays: number;
}

/**
 * ตรวจกฎเรื่องเวลาล้วนๆ — ไม่พึ่งตารางเวรของแพทย์เลย จึงตรวจได้ก่อน query DB ใดๆ เพิ่มเติม
 * คืน error code ตัวแรกที่เจอ (IN_THE_PAST → LEAD_TIME_VIOLATION → TOO_FAR_IN_ADVANCE) หรือ null ถ้าผ่าน
 */

// checkTimingRules()
// ─────────────────
// รับแค่: เวลาที่จอง, เวลาปัจจุบัน
// ไม่ต้องมีตารางเวรเลย

// เช็ค:
// - IN_THE_PAST
// - LEAD_TIME_VIOLATION
// - TOO_FAR_IN_ADVANCE
export function checkTimingRules(input: TimingRulesInput): TimingRuleErrorCode | null {
  const { startsAt, now, minLeadTimeMin, maxAdvanceDays } = input;

  if (startsAt.getTime() < now.getTime()) {
    return 'IN_THE_PAST';
  }

  if (startsAt.getTime() < now.getTime() + minLeadTimeMin * MS_PER_MINUTE) {
    return 'LEAD_TIME_VIOLATION';
  }

  if (startsAt.getTime() > now.getTime() + maxAdvanceDays * MS_PER_DAY) {
    return 'TOO_FAR_IN_ADVANCE';
  }

  return null;
}

export interface WorkingHoursRulesInput {
  /** เวลาเริ่มนัดที่ขอจอง */
  startsAt: Date;
  /** ระยะเวลาที่คนไข้เห็นบนใบนัด */
  durationMin: number;
  /** เวลาเตรียมห้องหลังจบ */
  bufferMin: number;
  /** เวลาเริ่ม/เลิกออกตรวจของวันนั้น — resolve จากตารางเวรหรือ CUSTOM_HOURS แล้วเสมอ */
  workStart: Date;
  workEnd: Date;
  /** ช่วงพักของตารางเวรวันนั้น */
  breaks: Interval[];
}

/**
 * ตรวจว่า block (รวม buffer) อยู่ในเวลาทำการหรือไม่ และไม่ทับเวลาพัก
 * เรียกได้ก็ต่อเมื่อ service ยืนยันแล้วว่ามีตารางเวรวันนั้นจริง (ไม่ใช่ OUTSIDE_WORKING_HOURS แบบไม่มีตารางเวรเลย)
 */


// checkWorkingHoursRules()
// ──────────────────────
// รับ: เวลาที่จอง + ตารางเวรที่ query มาแล้ว
// ต้องมีตารางเวรก่อนถึงจะเช็คได้

// เช็ค:
// - OUTSIDE_WORKING_HOURS
// - DURING_BREAK
export function checkWorkingHoursRules(input: WorkingHoursRulesInput): WorkingHoursRuleErrorCode | null {
  const { startsAt, durationMin, bufferMin, workStart, workEnd, breaks } = input;

  // block = ช่วงที่กันเวลาแพทย์ไว้จริง เหมือนนิยามใน slots.ts
  const block: Interval = {
    start: startsAt,
    end: new Date(startsAt.getTime() + (durationMin + bufferMin) * MS_PER_MINUTE),
  };

  // หักพักออกจากเวลาทำงานแล้วเช็คว่า block อยู่ครบในช่วงใดช่วงหนึ่ง — ตรรกะเดียวกับ generateSlots()
  const working = subtractIntervals({ start: workStart, end: workEnd }, breaks);
  const isWithinWorkingHours = working.some((interval) => intervalContains(interval, block));

  if (!isWithinWorkingHours) {
    // ทับเวลาพักโดยเฉพาะ ให้ error ที่เจาะจงกว่า "นอกเวลาทำการ" เฉยๆ
    const overlapsBreak = breaks.some((b) => intervalsOverlap(block, b));
    return overlapsBreak ? 'DURING_BREAK' : 'OUTSIDE_WORKING_HOURS';
  }

  return null;
}
