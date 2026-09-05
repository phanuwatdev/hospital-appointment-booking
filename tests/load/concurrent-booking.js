// =============================================================================
// k6 load test — พิสูจน์ว่า exclusion constraint (appt_no_doctor_overlap) กัน
// การจองซ้อนได้จริงเมื่อมีหลาย request ยิงเข้ามาพร้อมกันที่ slot เดียวกัน
//
// วิธีรัน:
//   1. npm run db:reset          ← ต้องรันทุกครั้งก่อนเทสต์ ไม่งั้น slot เป้าหมายอาจไม่ว่าง
//   2. npm run api:dev
//   3. k6 run --env BASE_URL=http://localhost:3001 tests/load/concurrent-booking.js or
//      .\tools\k6.exe run --env BASE_URL=http://localhost:3001 tests\load\concurrent-booking.js

//   ***ถ้ายิงแล้ว Status 500 ให้เช็ค psql ว่ามีเทอมินัลไหนค้างอยู่มั้ย

//  1 เปิด psql ผ่าน Terminal
//  - npm run db:psql

//  2 หา Process ที่ค้าง
//  SELECT pid, state, query, now() - xact_start AS duration
//  FROM pg_stat_activity
//  WHERE datname = 'booking' AND state != 'idle'
//  ORDER BY xact_start;

//  3 Kill Process
//  - SELECT pg_terminate_backend(pid ที่เจอ);

//  4 ออกจาก psql
//  - \q

// k6 เป็น binary แยก ไม่ได้อยู่ใน package.json ของโปรเจกต์นี้ ต้องติดตั้งเองจาก
// https://k6.io/docs/get-started/installation/
//
// การอ่านผล:
//   ตัวเลขที่ถูกต้องแท้จริงของ created/rejected/unexpected คือ booking_created /
//   booking_rejected_conflict / booking_unexpected ในตาราง summary ที่ k6 พิมพ์ท้ายรัน
//   (ใต้หัว "█ TOTAL RESULTS" หรือ "counters") ไม่ใช่ตัวเลขใน log ระหว่างรันหรือใน teardown —
//   k6 รันแต่ละ VU แยก context กัน ไม่มีทางอ่านค่า Counter สะสมกลับมาระหว่างสคริปต์ได้
//   (ดูคอมเมนต์ที่ teardown() ด้านล่าง) ถ้า response ไหนไม่ใช่ 201 หรือ 409+SLOT_TAKEN ตามที่คาด
//   จะถูกนับเป็น booking_unexpected และพิมพ์ status/body/duration ออกมาให้เห็นตอนรันด้วย
// =============================================================================

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

// UUID จาก db/seed.sql (ดู docs/api.http)
const STAFF_ID = '44444444-4444-4444-4444-444444444401';
const DR_THANAWAT = '22222222-2222-2222-2222-222222222203'; // อังคาร/พฤหัส 08:00–12:00 เท่านั้น ไม่มีพัก

// คนไข้ 5 คนใน seed — วนใช้เพื่อไม่ให้ชน PATIENT_DOUBLE_BOOKED ซึ่งเป็นคนละเรื่องกับที่ทดสอบ
const PATIENT_IDS = [
  '33333333-3333-3333-3333-333333333301',
  '33333333-3333-3333-3333-333333333302',
  '33333333-3333-3333-3333-333333333303',
  '33333333-3333-3333-3333-333333333304',
  '33333333-3333-3333-3333-333333333305',
];

const VU_COUNT = 50;

const bookingCreated = new Counter('booking_created');
const bookingRejectedConflict = new Counter('booking_rejected_conflict');
// response ที่ไม่ใช่ 201 และไม่ใช่ 409+SLOT_TAKEN ตามที่คาด เช่น 500, 409 ที่ error.code อื่น,
// หรือ status=0 (k6 ต่อ connection ไม่สำเร็จ/timeout ฝั่ง client) — ต้องเป็น 0 เสมอถ้าระบบถูกต้อง
const bookingUnexpected = new Counter('booking_unexpected');

export const options = {
  scenarios: {
    concurrent_booking: {
      executor: 'per-vu-iterations',
      vus: VU_COUNT,
      iterations: 1,
      maxDuration: '1m',
    },
  },
  thresholds: {
    // ต้องมีนัดสำเร็จเพียง 1 รายการเท่านั้น ที่เหลือต้องถูกปฏิเสธด้วย SLOT_TAKEN เท่านั้น
    booking_created: ['count==1'],
    booking_rejected_conflict: [`count==${VU_COUNT - 1}`],
    booking_unexpected: ['count==0'],
    // ถ้ามี response ไหนไม่ใช่ 201/409 (เช่น 500 หรือ timeout) ให้ทั้งรันถือว่าล้มเหลวด้วย
    checks: ['rate==1'],
  },
};

/**
 * ยิง GET /api/health เอา nextMonday มาคำนวณวันอังคารถัดไป
 * นพ.ธนวัฒน์ออกตรวจอังคาร/พฤหัส 08:00-12:00 และไม่มีนัดใน seed ในวันนั้นเลย
 * จึง 08:00 ของวันอังคารนี้เป็น slot ที่รู้แน่ว่าว่าง เหมาะกับการยิงชนกันตรงๆ
 */
export function setup() {
  const healthRes = http.get(`${BASE_URL}/api/health`);
  if (healthRes.status !== 200) {
    throw new Error(`GET /api/health ล้มเหลว: HTTP ${healthRes.status} — api server รันอยู่หรือยัง?`);
  }

  const health = healthRes.json();
  const nextMonday = new Date(`${health.nextMonday}T00:00:00Z`);
  const tuesday = new Date(nextMonday.getTime() + 24 * 60 * 60 * 1000);
  const tuesdayDate = tuesday.toISOString().slice(0, 10); // YYYY-MM-DD

  const targetSlot = `${tuesdayDate}T08:00:00+07:00`;

  console.log(`[setup] nextMonday=${health.nextMonday} targetSlot=${targetSlot}`);
  console.log(`[setup] ${VU_COUNT} VU จะยิง POST /api/appointments ไปที่ slot เดียวกันนี้พร้อมกัน`);

  return { targetSlot, tuesdayDate };
}

export default function (data) {
  // แต่ละ VU วนใช้คนไข้คนละคนจาก 5 คน กันไม่ให้ชน PATIENT_DOUBLE_BOOKED
  const patientId = PATIENT_IDS[(exec.vu.idInTest - 1) % PATIENT_IDS.length];

  const payload = JSON.stringify({
    patientId,
    doctorId: DR_THANAWAT,
    typeCode: 'FOLLOW_UP',
    startsAt: data.targetSlot,
    reason: 'k6 concurrent-booking load test',
  });

  const res = http.post(`${BASE_URL}/api/appointments`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-Staff-Id': STAFF_ID,
    },
  });

  check(res, {
    'response is 201 or 409 (never 500)': (r) => r.status === 201 || r.status === 409,
  });

  if (res.status === 201) {
    bookingCreated.add(1);
    return;
  }

  let body = null;
  try {
    body = res.json();
  } catch {
    body = null;
  }

  const isCleanConflict = res.status === 409 && body && body.error && body.error.code === 'SLOT_TAKEN';

  if (isCleanConflict) {
    bookingRejectedConflict.add(1);
    return;
  }

  // ไม่ใช่ 201 และไม่ใช่ 409+SLOT_TAKEN ตามที่คาด — พิมพ์ให้เห็นชัดว่าจริงๆ ได้อะไรกลับมา
  // status=0 หมายถึง k6 ต่อ connection ไม่สำเร็จหรือ timeout ฝั่ง client เอง ไม่ใช่ response จาก server
  bookingUnexpected.add(1);
  console.log(
    `[VU ${exec.vu.idInTest}] unexpected: status=${res.status} duration=${res.timings.duration.toFixed(0)}ms ` +
      `client_error=${res.error || 'none'} body=${res.body}`,
  );
}

/**
 * ห้ามเชื่อว่า teardown() คำนวณ "จำนวนที่ถูกปฏิเสธ" เองได้ถูกต้อง — k6 รันแต่ละ VU แยก
 * context กัน (คนละ JS runtime) ไม่มี state กลางให้ teardown() อ่านค่า Counter ที่สะสมมา
 * ระหว่างรันย้อนกลับมาได้เลย ตัวเลข created/rejected/unexpected ที่ถูกต้องแท้จริงคือค่าที่
 * k6 พิมพ์เองในตาราง summary ท้ายรัน (booking_created / booking_rejected_conflict /
 * booking_unexpected) เท่านั้น
 *
 * ก่อนหน้านี้ teardown() เคยคำนวณ "rejected = 50 - created" เอง ซึ่งเป็นคนละตัวเลขกับ
 * booking_rejected_conflict จริง (ที่นับเฉพาะ 409+SLOT_TAKEN) — ถ้ามี request ที่ตอบกลับมา
 * เป็นอย่างอื่น (500, timeout) ตัวเลขทั้งสองจะไม่ตรงกันและทำให้เข้าใจผิดว่าระบบถูกต้อง
 * ทั้งที่จริงมี response ผิดคาดปนอยู่ ที่นี่จึงเหลือแค่การ cross-check ตัวเลข "created" กับ
 * ฐานข้อมูลจริง (สิ่งเดียวที่ teardown() ตรวจสอบได้อย่างอิสระ) ไม่เดาตัวเลข rejected เอาเอง
 */
export function teardown(data) {
  const res = http.get(`${BASE_URL}/api/appointments?doctorId=${DR_THANAWAT}&date=${data.tuesdayDate}`, {
    headers: { 'X-Staff-Id': STAFF_ID },
  });

  let createdInDb = null;
  if (res.status === 200) {
    const body = res.json();
    createdInDb = body.data.filter(
      (appt) => appt.startsAt === data.targetSlot && appt.status !== 'cancelled',
    ).length;
  }

  console.log('');
  console.log('=== สรุปผลทดสอบ concurrent booking ===');
  console.log(`ยิงพร้อมกันทั้งหมด: ${VU_COUNT} requests`);
  console.log(
    createdInDb === null
      ? 'ตรวจสอบฐานข้อมูลไม่สำเร็จ (GET /api/appointments ล้มเหลว)'
      : `ยืนยันจากฐานข้อมูลจริง: มีนัดที่ slot เป้าหมายอยู่ ${createdInDb} รายการ`,
  );
  console.log('จำนวน created/rejected/unexpected ที่ถูกต้องแท้จริง ดูได้จาก booking_created /');
  console.log('booking_rejected_conflict / booking_unexpected ในตาราง summary ของ k6 ด้านล่างนี้');
  console.log(
    createdInDb === 1
      ? 'ผ่าน: exclusion constraint กันการจองซ้อนได้จริง มีนัดสำเร็จแค่ 1 รายการ'
      : `ไม่ผ่าน (หรือยังไม่ทราบแน่ชัด): คาดว่าจะมีนัดสำเร็จแค่ 1 รายการ แต่พบ ${createdInDb} รายการในฐานข้อมูล`,
  );
  console.log('========================================');
}
