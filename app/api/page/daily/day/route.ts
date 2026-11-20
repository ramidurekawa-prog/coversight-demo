// One day of one room in full: its dishes and its checks, for drill-down.
import { getDb } from '../../../../../server/db/client';
import { loadDay } from '../../../../../server/page/daily';
import { errorResponse, viewerFor } from '../../../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const q = new URL(req.url).searchParams;
    return Response.json(await loadDay(db, v, q.get('room'), q.get('day')));
  } catch (err) {
    return errorResponse(err);
  }
}
