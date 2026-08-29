import { generateSlots, subtractIntervals, type Interval } from './slots';

// วันจันทร์ที่ 7 ก.ย. 2026 — ระบุ offset +07:00 ไว้ชัดเจน
// เพื่อให้ผลเทสต์ไม่ขึ้นกับ timezone ของเครื่องที่รัน
const at = (hhmm: string): Date => new Date(`2026-09-07T${hhmm}:00+07:00`);

const span = (from: string, to: string): Interval => ({ start: at(from), end: at(to) });

/** แปลงผลลัพธ์เป็น 'HH:MM' เวลาไทย เพื่อให้อ่าน assertion ได้ง่าย */
const asBangkokTimes = (slots: Date[]): string[] =>
  slots.map((slot) =>
    slot.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
    }),
  );

/** ค่าเริ่มต้น: ตาราง นพ.อนันต์ จ–ศ 09:00–16:00 พักเที่ยง 12:00–13:00 */
const baseInput = {
  workStart: at('09:00'),
  workEnd: at('16:00'),
  breaks: [span('12:00', '13:00')],
  booked: [] as Interval[],
  durationMin: 15,
  bufferMin: 0,
  stepMin: 15,
  now: at('00:00'),
  leadTimeMin: 0,
};

describe('subtractIntervals', () => {
  it('คืน base ทั้งก้อนเมื่อไม่มีอะไรให้หัก', () => {
    expect(asBangkokTimes(subtractIntervals(span('09:00', '16:00'), []).map((i) => i.start))).toEqual([
      '09:00',
    ]);
  });

  it('หักพักเที่ยงออกได้สองช่วง', () => {
    const result = subtractIntervals(span('09:00', '16:00'), [span('12:00', '13:00')]);

    expect(asBangkokTimes(result.map((i) => i.start))).toEqual(['09:00', '13:00']);
    expect(asBangkokTimes(result.map((i) => i.end))).toEqual(['12:00', '16:00']);
  });

  it('รวม cut ที่ทับกันเองและเรียงมาสลับกัน', () => {
    const result = subtractIntervals(span('09:00', '16:00'), [
      span('13:00', '14:00'),
      span('12:00', '13:30'),
    ]);

    expect(asBangkokTimes(result.map((i) => i.start))).toEqual(['09:00', '14:00']);
    expect(asBangkokTimes(result.map((i) => i.end))).toEqual(['12:00', '16:00']);
  });

  it('ไม่แก้ไข array ที่รับเข้ามา', () => {
    const cuts = [span('13:00', '14:00'), span('10:00', '11:00')];
    subtractIntervals(span('09:00', '16:00'), cuts);

    expect(asBangkokTimes(cuts.map((c) => c.start))).toEqual(['13:00', '10:00']);
  });

  it('cut ที่กลืนทั้ง base ทำให้ไม่เหลืออะไรเลย', () => {
    expect(subtractIntervals(span('09:00', '16:00'), [span('08:00', '17:00')])).toEqual([]);
  });

  it('base ที่ไม่มีความยาวคืน [] ไม่ throw', () => {
    expect(subtractIntervals(span('16:00', '09:00'), [])).toEqual([]);
    expect(subtractIntervals(span('09:00', '09:00'), [])).toEqual([]);
  });
});

describe('generateSlots — 6 เคสที่ต้องไม่พลาด', () => {
  it('เคส 1: นัด 60 นาทีเริ่ม 11:30 กินเข้าพักเที่ยง → ไม่เสนอ', () => {
    const slots = asBangkokTimes(generateSlots({ ...baseInput, durationMin: 60, stepMin: 30 }));

    // 11:30 คร่อมพักเที่ยง, 11:00 จบพอดี 12:00 จึงยังเสนอได้
    expect(slots).not.toContain('11:30');
    expect(slots).toContain('11:00');
  });

  it('เคส 2: นัดที่จบพอดี 16:00 ตรงเวลาเลิกงาน → ต้องเสนอ', () => {
    const slots = asBangkokTimes(generateSlots(baseInput));

    expect(slots).toContain('15:45'); // 15:45 + 15 นาที = 16:00 พอดี
    expect(slots.at(-1)).toBe('15:45');
  });

  it('เคส 3: นัดที่จบ 16:01 → ต้องไม่เสนอ', () => {
    const slots = asBangkokTimes(generateSlots({ ...baseInput, durationMin: 16 }));

    expect(slots).not.toContain('15:45'); // 15:45 + 16 นาที = 16:01 ล้นไป 1 นาที
    expect(slots.at(-1)).toBe('15:30');
  });

  it('เคส 4: นัดติดกันพอดีไม่ถือว่าชน (ขอบเขต [start, end))', () => {
    const slots = asBangkokTimes(
      generateSlots({
        ...baseInput,
        durationMin: 30,
        stepMin: 30,
        booked: [span('09:00', '09:30')],
      }),
    );

    expect(slots).not.toContain('09:00'); // ทับเต็มๆ
    expect(slots).toContain('09:30'); // ชนขอบพอดี ไม่ถือว่าทับ
  });

  it('เคส 5: buffer นับรวมตอนเช็คว่าล้นเวลาทำงาน', () => {
    const slots = asBangkokTimes(
      generateSlots({ ...baseInput, durationMin: 60, bufferMin: 15, stepMin: 15 }),
    );

    // 14:45 + 60 + 15 = 16:00 พอดี ยังเสนอได้
    expect(slots).toContain('14:45');
    // 15:00 + 60 = 16:00 ซึ่งพอดีเวลาเลิก แต่ +15 buffer = 16:15 จึงล้น
    expect(slots).not.toContain('15:00');
  });

  it('เคส 5b: buffer ล้นเข้าพักเที่ยงก็ต้องไม่เสนอ (ตรงกับ docs/api.http)', () => {
    const slots = asBangkokTimes(
      generateSlots({ ...baseInput, durationMin: 60, bufferMin: 15, stepMin: 15 }),
    );

    // 11:00 + 60 = 12:00 พอดีขอบพักเที่ยง แต่ buffer ดันไปถึง 12:15
    expect(slots).not.toContain('11:00');
    // 10:45 + 75 = 12:00 พอดี
    expect(slots).toContain('10:45');
  });

  it('เคส 6: ไม่มี working interval เลย → คืน [] ไม่ throw', () => {
    // พักกลืนทั้งวัน
    expect(generateSlots({ ...baseInput, breaks: [span('08:00', '18:00')] })).toEqual([]);
    // เวลาเลิกมาก่อนเวลาเริ่ม
    expect(generateSlots({ ...baseInput, workStart: at('16:00'), workEnd: at('09:00') })).toEqual([]);
    // เวลาทำงานสั้นกว่าความยาวนัด
    expect(generateSlots({ ...baseInput, workEnd: at('09:10') })).toEqual([]);
  });
});

describe('generateSlots — กฎอื่น', () => {
  it('ตัด candidate ที่เร็วกว่า now + leadTimeMin', () => {
    const slots = asBangkokTimes(
      generateSlots({ ...baseInput, now: at('10:00'), leadTimeMin: 30 }),
    );

    expect(slots).not.toContain('10:15');
    expect(slots).not.toContain('10:29');
    expect(slots[0]).toBe('10:30'); // 10:00 + 30 นาที พอดี
  });

  it('ไม่เสนอ slot ในช่วงพักเที่ยง', () => {
    const slots = asBangkokTimes(generateSlots(baseInput));

    expect(slots).not.toContain('12:00');
    expect(slots).not.toContain('12:45');
    expect(slots).toContain('11:45'); // 11:45 + 15 = 12:00 พอดี
    expect(slots).toContain('13:00');
  });

  it('candidate เดินบน grid ที่ยึดจาก workStart เสมอ', () => {
    const slots = asBangkokTimes(generateSlots({ ...baseInput, workStart: at('09:10') }));

    expect(slots.slice(0, 3)).toEqual(['09:10', '09:25', '09:40']);
  });

  it('guard ค่าที่เป็นไปไม่ได้ → [] ไม่ค้าง', () => {
    expect(generateSlots({ ...baseInput, stepMin: 0 })).toEqual([]);
    expect(generateSlots({ ...baseInput, stepMin: -15 })).toEqual([]);
    expect(generateSlots({ ...baseInput, durationMin: 0 })).toEqual([]);
    expect(generateSlots({ ...baseInput, bufferMin: -5 })).toEqual([]);
  });

  it('ตรงกับตาราง นพ.อนันต์ วันจันทร์ตาม db/seed.sql', () => {
    // seed: FOLLOW_UP 09:00–09:15, NEW_PATIENT 09:15–09:45,
    //       PROCEDURE 10:30–11:30 + buffer 15 → บล็อกถึง 11:45
    const slots = asBangkokTimes(
      generateSlots({
        ...baseInput,
        booked: [span('09:00', '09:15'), span('09:15', '09:45'), span('10:30', '11:45')],
      }),
    );

    // docs/api.http: ไม่มี 09:00–09:45, ไม่มี 10:30–11:45, ไม่มี 12:00–13:00
    expect(slots.filter((s) => s < '09:45')).toEqual([]);
    expect(slots.filter((s) => s >= '10:30' && s < '11:45')).toEqual([]);
    expect(slots.filter((s) => s >= '12:00' && s < '13:00')).toEqual([]);

    // ช่องว่างที่ seed จงใจเว้นไว้
    expect(slots).toContain('09:45');
    expect(slots).toContain('11:45');
    expect(slots).toContain('13:00');
  });
});
