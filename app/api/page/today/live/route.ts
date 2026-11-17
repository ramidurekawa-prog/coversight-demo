// Tonight, live: GET ?room= refreshes from Toast/7shifts if due and answers
// from what's stored; POST { roomId, covers?, servers?, clear? } saves a
// manager's own count for while a feed is missing or down.
import { getDb } from '../../../../../server/db/client';
import { loadLive, saveManual } from '../../../../../server/live';
import { errorResponse, viewerFor } from '../../../../../server/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await loadLive(db, v, new URL(req.url).searchParams.get('room')));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await saveManual(db, v, await req.json().catch(() => null)));
  } catch (err) {
    return errorResponse(err);
  }
}
