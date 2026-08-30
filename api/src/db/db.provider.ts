import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE_CLIENT');

// รวม $client ไว้ในชนิดด้วย เพื่อให้ปิด connection pool ตอน onModuleDestroy ได้ (ดู db.module.ts)
export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export const dbProvider: Provider = {
  provide: DRIZZLE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): DrizzleDb => {
    const databaseUrl = config.get<string>('DATABASE_URL');
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set');
    }

    // statement_timeout กันไม่ให้ request ค้างรอ lock ที่ exclusion constraint นานเกินไป
    // เช่นตอนมีหลาย transaction แย่งกัน insert ทับเวลาเดียวกันพร้อมกันจำนวนมาก
    // ผู้ใช้ระบบจองนัดไม่ควรต้องรอเกิน 5 วินาที ถ้าเกินให้ปล่อยเป็น error แทนที่จะค้าง
    const client = postgres(databaseUrl, { connection: { statement_timeout: 5000 } });
    return drizzle(client, { schema });
  },
};
