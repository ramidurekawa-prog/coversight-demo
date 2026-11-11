import { activity } from '../../../server/activity';
import { getDb } from '../../../server/db/client';
import { errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json({ activity: await activity(db, v) });
  } catch (err) {
    return errorResponse(err);
  }
}
