/**
 * Seeds demo data: admin user, settings/catalog defaults, CMS pages, banners, demo users, agencies and listings.
 * Idempotent: safe to run multiple times. Usage: pnpm db:seed
 * TODO (marketplace workstream): demo users / agencies / listings / banners / pages.
 */
import bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config';
import { createPool } from './db.module';
import * as schema from './schema';

async function main() {
  const pool = createPool();
  const db = drizzle(pool, { schema });
  await db
    .insert(schema.users)
    .values({ name: 'Admin', email: config.admin.email, passwordHash: await bcrypt.hash(config.admin.password, 10), role: 'ADMIN', isEmailVerified: true })
    .onConflictDoNothing();
  console.log(`✔ admin: ${config.admin.email} / ${config.admin.password}`);
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
