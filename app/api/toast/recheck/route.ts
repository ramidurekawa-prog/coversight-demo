import { getDb } from '../../../../server/db/client';
import { errorResponse, viewerFor } from '../../../../server/session';
import { recheckToast } from '../../../../server/toast-conn';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json({ connection: await recheckToast(db, v) });
  } catch (err) {
    return errorResponse(err);
  }
}
