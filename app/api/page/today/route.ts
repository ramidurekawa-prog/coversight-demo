// The Today page: the room's queue state and who did what today (GET ?room=),
// or one decision on one card (POST { roomId, op, cardId }).
import { getDb } from '../../../../server/db/client';
import { actOnToday, loadToday } from '../../../../server/page/today';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await loadToday(db, v, new URL(req.url).searchParams.get('room')));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await actOnToday(db, v, await req.json().catch(() => null)));
  } catch (err) {
    return errorResponse(err);
  }
}
