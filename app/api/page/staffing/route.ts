// The pre-shift staffing call for one room: ?roomId=&date=&meal= (both services when meal is left out).
// Approving a change is POST /api/tasks with its shift: approval id; the server re-checks it there.
import { getDb } from '../../../../server/db/client';
import { loadStaffing } from '../../../../server/page/staffing';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const q = new URL(req.url).searchParams;
    return Response.json(await loadStaffing(db, v, { roomId: q.get('roomId'), date: q.get('date') ?? undefined, meal: q.get('meal') ?? undefined }));
  } catch (err) {
    return errorResponse(err);
  }
}
