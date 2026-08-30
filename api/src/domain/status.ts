// -----------------------------------------------------------------------------
// state machine ของสถานะนัดหมาย — pure function ล้วน (เหมือน slots.ts / booking-rules.ts)
// ห้ามพึ่งพา NestJS, drizzle หรือฐานข้อมูลใดๆ
// -----------------------------------------------------------------------------

export type AppointmentStatus = 'booked' | 'checked_in' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

// completed / cancelled / no_show เป็นสถานะจบ — ห้ามเปลี่ยนต่อไปไหนอีก
const ALLOWED_TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  booked: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
