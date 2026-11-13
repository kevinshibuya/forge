import { Global, Module } from '@nestjs/common';
import { createDb, DB } from './client';

@Global()
@Module({
  providers: [{
    provide: DB,
    useFactory: () => createDb(process.env.DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge'),
  }],
  exports: [DB],
})
export class DbModule {}
