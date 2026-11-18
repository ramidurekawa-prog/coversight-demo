// This week for one room: GET /api/page/week?room=<id> → { view, digest, reviews }.
// Marking a week reviewed is an operator decision (POST /api/actions, key week.review).
import { getDb } from '../../../../server/db/client';
import { weekSummary } from '../../../../server/page/week';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const room = new URL(req.url).searchParams.get('room');
    return Response.json(await weekSummary(db, v, room));
  } catch (err) {
    return errorResponse(err);
  }
}
