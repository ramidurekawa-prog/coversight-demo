// Sous, the AI teammate: GET /api/sous?room=<id>&page=<pageId> → the brief, what it noticed
// and what to ask; POST { roomId, page?, question, history? } → one grounded answer.
import { askSous, loadSous } from '../../../server/ai/sous';
import { getDb } from '../../../server/db/client';
import { errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const q = new URL(req.url).searchParams;
    return Response.json(await loadSous(db, v, q.get('room'), { page: q.get('page') }));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await askSous(db, v, await req.json().catch(() => null)));
  } catch (err) {
    return errorResponse(err);
  }
}
