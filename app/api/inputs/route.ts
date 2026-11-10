// Save hand-entered rows (recipes, counts, invoices…) for one room and kind.
import { getDb } from '../../../server/db/client';
import { commitInput, loadInputs } from '../../../server/org';
import { AuthError, errorResponse, viewerFor } from '../../../server/session';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const body = (await req.json().catch(() => null)) as { roomId?: string; kind?: string; rows?: unknown; opts?: unknown; summary?: string } | null;
    if (!body || typeof body.roomId !== 'string' || typeof body.kind !== 'string') return Response.json({ error: 'roomId and kind are required.' }, { status: 400 });
    if (v.rooms && !v.rooms.includes(body.roomId)) throw new AuthError(403, 'That room is not one of yours.');
    const id = await commitInput(db, { orgId: v.orgId, userId: v.userId, roomId: body.roomId, kind: body.kind, rows: body.rows, opts: body.opts, summary: body.summary });
    return Response.json({ id, ...(await loadInputs(db, v.orgId)) });
  } catch (err) {
    return errorResponse(err);
  }
}
