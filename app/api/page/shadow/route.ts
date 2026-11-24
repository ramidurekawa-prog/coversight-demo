// Shadow mode's record for one room: ?roomId=. What Coversight would have called for each
// service, graded against what happened. Read-only: the nightly `shadow` job writes it.
import { getDb } from '../../../../server/db/client';
import { loadShadow } from '../../../../server/shadow';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await loadShadow(db, v, { roomId: new URL(req.url).searchParams.get('roomId') }));
  } catch (err) {
    return errorResponse(err);
  }
}
