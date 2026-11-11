import { getDb } from '../../../../server/db/client';
import { errorResponse, viewerFor } from '../../../../server/session';
import { disconnectToast } from '../../../../server/toast-conn';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    await disconnectToast(db, v);
    return Response.json({ connection: null });
  } catch (err) {
    return errorResponse(err);
  }
}
