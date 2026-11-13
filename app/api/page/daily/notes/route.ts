// A manager's note on one day of one room (empty text removes it).
import { getDb } from '../../../../../server/db/client';
import { saveNote } from '../../../../../server/page/daily';
import { errorResponse, viewerFor } from '../../../../../server/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await saveNote(db, v, await req.json().catch(() => null)));
  } catch (err) {
    return errorResponse(err);
  }
}
