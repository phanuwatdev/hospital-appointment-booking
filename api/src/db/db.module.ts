import { Global, Module } from '@nestjs/common';

import { dbProvider, DRIZZLE } from './db.provider';

@Global()
@Module({
  providers: [dbProvider],
  exports: [DRIZZLE],
})
export class DbModule {}
