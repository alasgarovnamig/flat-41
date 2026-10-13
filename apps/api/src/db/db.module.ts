import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
export type Database = NodePgDatabase<typeof schema>;
/** Transaction handle — same API as Database. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Inject the Drizzle database: `constructor(@InjectDb() private db: Database) {}` */
export const InjectDb = () => Inject(DB);

export const createPool = () => new Pool({ connectionString: config.databaseUrl, max: 20 });

@Global()
@Module({
  providers: [
    { provide: PG_POOL, useFactory: createPool },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool) => drizzle(pool, { schema }) },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}
