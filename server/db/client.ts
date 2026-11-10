// The database handle. Production: Postgres at DATABASE_URL (Neon on Vercel),
// through postgres.js. Tests: an in-memory PGlite with the same migrations.
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { schema } from './schema';

export type Db = ReturnType<typeof drizzlePg<typeof schema>>;

let cached: Db | null = null;
let override: Db | null = null;

/** Tests inject a PGlite-backed handle. */
export function setDb(db: Db | null) {
  override = db;
}

export function getDb(): Db {
  if (override) return override;
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // Serverless: a small pool per instance; Neon's pooled URL does the rest.
  const sql = postgres(url, { max: 3, prepare: false });
  cached = drizzlePg(sql, { schema });
  return cached;
}

export const hasDatabase = () => !!override || !!process.env.DATABASE_URL;
