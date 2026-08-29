import { Inject, Injectable } from '@nestjs/common';
import { formatInTimeZone } from 'date-fns-tz';
import { nextMonday } from 'date-fns';
import { sql } from 'drizzle-orm';

import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';

const HOSPITAL_TIMEZONE = 'Asia/Bangkok';

export interface HealthStatus {
  status: 'ok';
  database: 'connected';
  nextMonday: string;
}

@Injectable()
export class HealthService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async check(): Promise<HealthStatus> {
    await this.db.execute(sql`SELECT 1`);

    // ยึดวันที่ปัจจุบันตามเวลาโรงพยาบาล (Asia/Bangkok) ไม่ใช่เวลาเครื่อง server
    const todayInBangkok = formatInTimeZone(new Date(), HOSPITAL_TIMEZONE, 'yyyy-MM-dd');
    const next = nextMonday(new Date(`${todayInBangkok}T00:00:00Z`));

    return {
      status: 'ok',
      database: 'connected',
      nextMonday: formatInTimeZone(next, 'UTC', 'yyyy-MM-dd'),
    };
  }
}
