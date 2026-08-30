import { checkTimingRules, checkWorkingHoursRules, type TimingRulesInput, type WorkingHoursRulesInput } from './booking-rules';
import type { Interval } from './slots';

// วันจันทร์ที่ 7 ก.ย. 2026 — ระบุ offset +07:00 ไว้ชัดเจน เพื่อไม่ให้ผลเทสต์ขึ้นกับ timezone ของเครื่อง
const at = (hhmm: string): Date => new Date(`2026-09-07T${hhmm}:00+07:00`);
const span = (from: string, to: string): Interval => ({ start: at(from), end: at(to) });

describe('checkTimingRules', () => {
  /** ค่าเริ่มต้น: FOLLOW_UP lead time 30 นาที, จองล่วงหน้าได้ไม่เกิน 90 วัน */
  const baseInput: TimingRulesInput = {
    startsAt: at('14:00'),
    now: at('08:00'),
    minLeadTimeMin: 30,
    maxAdvanceDays: 90,
  };

  it('ผ่านทุกกฎ → คืน null', () => {
    expect(checkTimingRules(baseInput)).toBeNull();
  });

  it('IN_THE_PAST: startsAt ก่อนเวลาปัจจุบัน', () => {
    expect(checkTimingRules({ ...baseInput, startsAt: at('07:00'), now: at('08:00') })).toBe('IN_THE_PAST');
  });

  it('LEAD_TIME_VIOLATION: startsAt อยู่ในอนาคตแต่ไม่ถึง lead time ที่กำหนด', () => {
    expect(
      checkTimingRules({ ...baseInput, startsAt: at('09:10'), now: at('09:00'), minLeadTimeMin: 30 }),
    ).toBe('LEAD_TIME_VIOLATION');
  });

  it('IN_THE_PAST มาก่อน LEAD_TIME_VIOLATION เสมอเมื่อทั้งคู่เป็นจริง', () => {
    expect(
      checkTimingRules({ ...baseInput, startsAt: at('07:00'), now: at('08:00'), minLeadTimeMin: 30 }),
    ).toBe('IN_THE_PAST');
  });

  it('TOO_FAR_IN_ADVANCE: startsAt ไกลเกิน maxAdvanceDays', () => {
    expect(
      checkTimingRules({
        ...baseInput,
        startsAt: new Date('2027-12-01T10:00:00+07:00'),
        now: at('08:00'),
        maxAdvanceDays: 90,
      }),
    ).toBe('TOO_FAR_IN_ADVANCE');
  });

  it('ไม่ต้องพึ่งตารางเวรใดๆ — ตรวจได้แม้ startsAt เป็นวันที่ไม่มีตารางเวรอยู่เลย (เช่นในอดีตไกลๆ)', () => {
    // 2020-01-06 อยู่ก่อน valid_from ของตารางเวรใน seed ทุกตัว แต่ checkTimingRules ไม่ต้องรู้เรื่องนั้นเลย
    expect(
      checkTimingRules({ ...baseInput, startsAt: new Date('2020-01-06T10:00:00+07:00'), now: at('08:00') }),
    ).toBe('IN_THE_PAST');
  });
});

describe('checkWorkingHoursRules', () => {
  /** ค่าเริ่มต้น: ตาราง นพ.อนันต์ จ–ศ 09:00–16:00 พักเที่ยง 12:00–13:00 */
  const baseInput: WorkingHoursRulesInput = {
    startsAt: at('14:00'),
    durationMin: 15,
    bufferMin: 0,
    workStart: at('09:00'),
    workEnd: at('16:00'),
    breaks: [span('12:00', '13:00')],
  };

  it('ผ่าน → คืน null', () => {
    expect(checkWorkingHoursRules(baseInput)).toBeNull();
  });

  it('OUTSIDE_WORKING_HOURS: เริ่มก่อนเวลาทำการ', () => {
    expect(checkWorkingHoursRules({ ...baseInput, startsAt: at('07:00') })).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('OUTSIDE_WORKING_HOURS: block ล้นเข้าไปหลังเวลาเลิกงาน (ไม่ทับพัก)', () => {
    expect(checkWorkingHoursRules({ ...baseInput, startsAt: at('15:50'), durationMin: 30 })).toBe(
      'OUTSIDE_WORKING_HOURS',
    );
  });

  it('DURING_BREAK: เริ่มระหว่างพักเที่ยงพอดี', () => {
    expect(checkWorkingHoursRules({ ...baseInput, startsAt: at('12:15') })).toBe('DURING_BREAK');
  });

  it('DURING_BREAK: จุดเริ่มอยู่ในเวลาทำการ แต่ block (รวม buffer) ล้ำเข้าไปในพัก', () => {
    // หัตถการ 60 นาที เริ่ม 11:30 → block [11:30, 12:30) ทับพักเที่ยง 12:00–13:00
    expect(
      checkWorkingHoursRules({ ...baseInput, startsAt: at('11:30'), durationMin: 60, bufferMin: 0 }),
    ).toBe('DURING_BREAK');
  });

  it('DURING_BREAK: buffer เป็นตัวทำให้ล้นเข้าไปในพัก แม้ duration เดิมจะจบพอดีขอบพัก', () => {
    // 11:00 + 60 = 12:00 พอดีขอบพัก แต่ +buffer 15 → 12:15 ล้ำเข้าไปในพัก
    expect(
      checkWorkingHoursRules({ ...baseInput, startsAt: at('11:00'), durationMin: 60, bufferMin: 15 }),
    ).toBe('DURING_BREAK');
  });

  it('ผ่าน: block ที่จบพอดีขอบเวลาทำการ (ไม่ล้น)', () => {
    expect(checkWorkingHoursRules({ ...baseInput, startsAt: at('15:45'), durationMin: 15 })).toBeNull();
  });

  it('ผ่าน: block ที่จบพอดีขอบพักเที่ยง', () => {
    expect(checkWorkingHoursRules({ ...baseInput, startsAt: at('11:45'), durationMin: 15 })).toBeNull();
  });
});
