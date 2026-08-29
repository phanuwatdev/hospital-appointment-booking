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

    const client = postgres(databaseUrl);
    return drizzle(client, { schema });
  },
};
