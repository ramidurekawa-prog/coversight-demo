// Save one operator decision (a cleared card, an approval, fences, the plan's hours…).
import { saveAction } from '../../../server/actions';
import { getDb } from '../../../server/db/client';
import { errorResponse, viewerFor } from '../../../server/session';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const body = (await req.json().catch(() => null)) as { roomId?: unknown; key?: unknown; value?: unknown; summary?: unknown } | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });
    return Response.json(await saveAction(db, v, body));
  } catch (err) {
    return errorResponse(err);
  }
}
