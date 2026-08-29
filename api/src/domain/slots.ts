// -----------------------------------------------------------------------------
// ตรรกะการหา slot ว่าง — pure function ล้วน
//
// ไฟล์นี้ห้ามพึ่งพา NestJS, drizzle หรือฐานข้อมูลใดๆ
// input ทุกอย่างถูกส่งเข้ามาเป็นพารามิเตอร์ ทำให้เทสต์ได้โดยไม่ต้องมี DB
//
// นิยามที่ใช้ตลอดทั้งไฟล์:
//   ทุกช่วงเวลาเป็นแบบครึ่งเปิด [start, end) เหมือน tstzrange '[)' ใน Postgres
//   → นัด 09:00–09:30 กับ 09:30–10:00 ไม่ถือว่าชนกัน
//
//   block = [start, start + durationMin + bufferMin)
//   คือช่วงที่กันเวลาแพทย์ไว้จริง ตรงกับ occupied_range ใน DB
//   block นี้ถูกใช้ทั้งตอนเช็คว่าอยู่ในเวลาทำงานไหม และตอนเช็คว่าชนนัดเดิมไหม
//   ทำให้ slot ที่เสนอออกไปแล้วนำไป INSERT จะไม่โดน exclusion constraint ตีกลับ
// -----------------------------------------------------------------------------

const MS_PER_MINUTE = 60_000;

export type Interval = { start: Date; end: Date };

/** ช่วงเวลาในหน่วย epoch millis — ใช้ภายในเพื่อเลี่ยงการสร้าง Date ระหว่างคำนวณ */
type Span = { start: number; end: number };

function toSpan(interval: Interval): Span {
  return { start: interval.start.getTime(), end: interval.end.getTime() };
}

/**
 * ช่วงที่มีความยาวจริง — คัดช่วงว่างเปล่า (start >= end) และ Invalid Date ทิ้ง
 * (การเปรียบเทียบกับ NaN ให้ค่าเท็จเสมอ ช่วงที่มีวันที่พังจึงถูกคัดออกที่นี่)
 */
function isNonEmpty(span: Span): boolean {
  return span.start < span.end;
}

/** สองช่วงแบบ [) ทับกันหรือไม่ */
function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/** ช่วง inner อยู่ครบทั้งก้อนภายใน outer หรือไม่ */
function contains(outer: Span, inner: Span): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/**
 * หักช่วง cuts ออกจาก base คืนส่วนที่เหลือเรียงตามเวลา
 *
 * cuts ที่ทับกันเอง เรียงมาสลับกัน หรือล้นออกนอก base จัดการให้หมด
 * ไม่แก้ไข array ที่รับเข้ามา
 *
 * ตัวอย่าง: [09:00,16:00) หักพักเที่ยง [12:00,13:00)
 *          → [[09:00,12:00), [13:00,16:00)]
 */
export function subtractIntervals(base: Interval, cuts: Interval[]): Interval[] {
  const { start: baseStart, end: baseEnd } = toSpan(base);
  if (!(baseStart < baseEnd)) return [];

  // clip เข้ากรอบ base ก่อน แล้วค่อยเรียง — map() สร้าง array ใหม่ sort() จึงไม่กระทบผู้เรียก
  const clipped = cuts
    .map(toSpan)
    .map((cut) => ({
      start: Math.max(cut.start, baseStart),
      end: Math.min(cut.end, baseEnd),
    }))
    .filter(isNonEmpty)
    .sort((a, b) => a.start - b.start);

  const remaining: Interval[] = [];
  let cursor = baseStart;

  for (const cut of clipped) {
    // ช่องว่างระหว่าง cursor กับ cut ตัวนี้คือส่วนที่เหลืออยู่
    if (cut.start > cursor) {
      remaining.push({ start: new Date(cursor), end: new Date(cut.start) });
    }
    // max() ทำให้ cut ที่ทับกันเองหรือถูกกลืนอยู่ข้างในรวมร่างกันเองโดยไม่ต้องมีเคสพิเศษ
    if (cut.end > cursor) cursor = cut.end;
    if (cursor >= baseEnd) break;
  }

  if (cursor < baseEnd) {
    remaining.push({ start: new Date(cursor), end: new Date(baseEnd) });
  }

  return remaining;
}

export interface GenerateSlotsInput {
  /** เวลาเริ่มออกตรวจของวันนั้น */
  workStart: Date;
  /** เวลาเลิก */
  workEnd: Date;
  /** ช่วงพัก */
  breaks: Interval[];
  /** ช่วงที่ถูกจองแล้ว — มาจาก occupied_range ซึ่งรวม buffer ของนัดนั้นแล้ว */
  booked: Interval[];
  /** ระยะเวลาที่คนไข้เห็นบนใบนัด */
  durationMin: number;
  /** เวลาเตรียมห้องหลังจบ */
  bufferMin: number;
  /** ระยะห่างของ slot ที่เสนอ เช่น 15 */
  stepMin: number;
  now: Date;
  /** ต้องจองล่วงหน้าอย่างน้อยกี่นาที */
  leadTimeMin: number;
}

/**
 * หา slot ว่างที่เสนอให้จองได้ คืนเฉพาะ "เวลาเริ่ม" เรียงจากเช้าไปเย็น
 *
 * ลำดับการคัด:
 *   1. หักช่วงพักออกจาก [workStart, workEnd) → working intervals
 *   2. เดินทีละ stepMin จาก workStart สร้าง candidate
 *   3. เก็บเฉพาะ candidate ที่ block อยู่ครบในช่วงเดียว (ห้ามคร่อมสองช่วง)
 *   4. ตัด candidate ที่ block ทับกับ booked
 *   5. ตัด candidate ที่เริ่มเร็วกว่า now + leadTimeMin
 *
 * input ที่ไม่สมเหตุสมผล (ไม่มีเวลาทำงาน, พักกลืนทั้งวัน, ค่าติดลบ) คืน [] ไม่ throw
 */
export function generateSlots(input: GenerateSlotsInput): Date[] {
  const {
    workStart,
    workEnd,
    breaks,
    booked,
    durationMin,
    bufferMin,
    stepMin,
    now,
    leadTimeMin,
  } = input;

  // guard กัน infinite loop และค่าที่เป็นไปไม่ได้
  // (DB มี CHECK คุมค่าเหล่านี้อยู่แล้ว ที่นี่กันไว้เพื่อให้ฟังก์ชันไม่มีทางค้าง)
  if (!(stepMin > 0) || !(durationMin > 0) || !(bufferMin >= 0)) return [];

  const blockMs = (durationMin + bufferMin) * MS_PER_MINUTE;
  const stepMs = stepMin * MS_PER_MINUTE;

  const working = subtractIntervals({ start: workStart, end: workEnd }, breaks).map(toSpan);
  if (working.length === 0) return [];

  const occupied = booked.map(toSpan).filter(isNonEmpty);

  // ห้ามเชื่อเวลาจาก client — now ถูกส่งมาจาก server เสมอ
  const earliestStart = now.getTime() + leadTimeMin * MS_PER_MINUTE;

  // ขอบบนของลูป: working interval ทุกช่วงถูก clip อยู่ใน [workStart, workEnd) แล้ว
  // candidate ที่เริ่มหลังจุดนี้จึงเป็นไปไม่ได้ที่จะบรรจุ block ได้ครบ
  const gridStart = workStart.getTime();
  const lastPossibleStart = workEnd.getTime() - blockMs;

  const slots: Date[] = [];

  for (let start = gridStart; start <= lastPossibleStart; start += stepMs) {
    const block: Span = { start, end: start + blockMs };

    if (start < earliestStart) continue;
    // ต้องอยู่ครบใน working interval "ช่วงใดช่วงหนึ่ง" — คร่อมสองช่วงจึงตกไปเอง
    if (!working.some((interval) => contains(interval, block))) continue;
    if (occupied.some((taken) => overlaps(block, taken))) continue;

    slots.push(new Date(start));
  }

  return slots;
}
