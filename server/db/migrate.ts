// `pnpm db:migrate`: apply server/db/migrations to DATABASE_URL. Vercel runs it
// in the build (package.json "vercel-build") so a deploy never serves code
// ahead of its schema.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.log('DATABASE_URL not set: skipping migrations.');
  process.exit(0);
}
const sql = postgres(url, { max: 1 });
await migrate(drizzle(sql), { migrationsFolder: new URL('./migrations', import.meta.url).pathname });
await sql.end();
console.log('Migrations applied.');
