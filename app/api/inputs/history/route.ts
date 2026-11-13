// The Data inputs history: every commit in the viewer's rooms, with who made it.
import { getDb } from '../../../../server/db/client';
import { inputHistory } from '../../../../server/page/inputs';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const q = Object.fromEntries(new URL(req.url).searchParams.entries());
    return Response.json(await inputHistory(db, v, q));
  } catch (err) {
    return errorResponse(err);
  }
}
