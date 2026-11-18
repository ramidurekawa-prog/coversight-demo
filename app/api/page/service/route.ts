// Service: one service today (?meal=lunch|dinner, or all for both) live from Toast for one room, paced against recent weeks.
import { getDb } from '../../../../server/db/client';
import { liveDay, liveService } from '../../../../server/page/service';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const q = new URL(req.url).searchParams;
    const meal = q.get('meal') ?? 'dinner';
    if (meal === 'all') return Response.json(await liveDay(db, v, q.get('roomId')));
    return Response.json(await liveService(db, v, q.get('roomId'), { meal }));
  } catch (err) {
    return errorResponse(err);
  }
}
