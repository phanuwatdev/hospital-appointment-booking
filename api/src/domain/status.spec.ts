import { canTransition, type AppointmentStatus } from './status';

const ALL_STATUSES: readonly AppointmentStatus[] = [
  'booked',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
];

// คู่ (from, to) ที่อนุญาต — คัดลอกจากโจทย์ตรงๆ ไม่อ้างอิง ALLOWED_TRANSITIONS ใน status.ts
// เพื่อให้เทสต์นี้ตรวจ behavior จริง ไม่ใช่ตรวจว่า implementation คงเส้นคงวากับตัวเอง
const ALLOWED_PAIRS = new Set<string>([
  'booked->checked_in',
  'booked->cancelled',
  'booked->no_show',
  'checked_in->in_progress',
  'checked_in->cancelled',
  'checked_in->no_show',
  'in_progress->completed',
]);

describe('canTransition — ครอบทุกคู่ (from, to)', () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const expected = ALLOWED_PAIRS.has(`${from}->${to}`);
      it(`${from} → ${to} ต้อง${expected ? 'อนุญาต' : 'ไม่อนุญาต'}`, () => {
        expect(canTransition(from, to)).toBe(expected);
      });
    }
  }

  it('สถานะจบ (completed, cancelled, no_show) ห้ามเปลี่ยนไปสถานะอื่นเลย', () => {
    for (const terminal of ['completed', 'cancelled', 'no_show'] as const) {
      for (const to of ALL_STATUSES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });
});
