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

/** No database is configured: the browser runs the demo on its own (engine.js "local" mode). */
export class NoDatabaseError extends Error {
  name = 'NoDatabaseError';
  constructor() {
    super('DATABASE_URL is not set');
  }
}

export function getDb(): Db {
  if (override) return override;
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new NoDatabaseError();
  // Serverless: a small pool per instance; Neon's pooled URL does the rest.
  const sql = postgres(url, { max: 3, prepare: false });
  cached = drizzlePg(sql, { schema });
  return cached;
}

export const hasDatabase = () => !!override || !!process.env.DATABASE_URL;
