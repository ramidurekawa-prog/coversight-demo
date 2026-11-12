// The weekly meeting's record for one room: finished meetings, newest first.
// Saving a meeting, its follow-ups and its slot goes through /api/actions.
import { getDb } from '../../../../server/db/client';
import { meetingHistory } from '../../../../server/page/meeting';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const room = new URL(req.url).searchParams.get('room');
    return Response.json({ meetings: await meetingHistory(db, v, room) });
  } catch (err) {
    return errorResponse(err);
  }
}
