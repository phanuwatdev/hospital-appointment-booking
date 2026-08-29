import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';

import { dbProvider, DRIZZLE, type DrizzleDb } from './db.provider';

@Global()
@Module({
  providers: [dbProvider],
  exports: [DRIZZLE],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // ปิด connection pool ตอน Nest ปิดแอป/testing module ไม่งั้น process ค้างรอ socket ปิดเอง
  async onModuleDestroy(): Promise<void> {
    await this.db.$client.end();
  }
}
