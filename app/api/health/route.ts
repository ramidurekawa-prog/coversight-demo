// Uptime check: is the database reachable? Secret-free.
import { sql } from 'drizzle-orm';

import { getDb, hasDatabase } from '../../../server/db/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!hasDatabase()) return Response.json({ ok: false, database: 'not configured' }, { status: 503 });
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, database: 'ok' });
  } catch {
    return Response.json({ ok: false, database: 'unreachable' }, { status: 503 });
  }
}
