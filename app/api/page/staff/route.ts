// Staff for one room: GET /api/page/staff?room=<id> → { view, names }.
// Names and rankings go to owners, admins and GMs only.
import { getDb } from '../../../../server/db/client';
import { staffSummary } from '../../../../server/page/staff';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await staffSummary(db, v, new URL(req.url).searchParams.get('room')));
  } catch (err) {
    return errorResponse(err);
  }
}
