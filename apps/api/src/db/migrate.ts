/** Applies SQL migrations from ./drizzle. Usage: pnpm db:migrate */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { createPool } from './db.module';

async function main() {
  const pool = createPool();
  await migrate(drizzle(pool), { migrationsFolder: path.join(__dirname, '../../drizzle') });
  await pool.end();
  console.log('✔ migrations applied');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
