import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { resetAuth } from '../../server/auth';
import { setDb, type Db } from '../../server/db/client';
import { schema } from '../../server/db/schema';

/** A fresh in-memory Postgres with every migration applied, installed as the app's database. */
export async function freshDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: new URL('../../server/db/migrations', import.meta.url).pathname });
  setDb(db as unknown as Db);
  resetAuth();
  return db as unknown as Db;
}
