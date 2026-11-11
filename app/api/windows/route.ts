// Test windows: list with live state, or start one on a lever.
import { getDb } from '../../../server/db/client';
import { listWindows, startWindow } from '../../../server/proof';
import { errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json({ windows: await listWindows(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const body = (await req.json().catch(() => null)) as { roomId?: unknown; lever?: unknown; dish?: unknown } | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });
    const w = await startWindow(db, v, { roomId: body.roomId, lever: body.lever, dish: body.dish });
    return Response.json({ window: w, windows: await listWindows(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}
