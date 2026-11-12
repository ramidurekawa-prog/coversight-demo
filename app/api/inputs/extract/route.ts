// Read a photo or PDF into rows for review (never committed from here).
import { getDb } from '../../../../server/db/client';
import { extractConfigured, extractRows } from '../../../../server/extract';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    await viewerFor(req.headers, getDb());
    return Response.json({ configured: extractConfigured() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await extractRows(db, v, await req.json().catch(() => null)));
  } catch (err) {
    return errorResponse(err);
  }
}
