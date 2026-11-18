// Sous, the AI teammate: GET /api/sous?room=<id> → the brief, what it noticed
// and what to ask; POST { roomId, question, history? } → one grounded answer.
import { askSous, loadSous } from '../../../server/ai/sous';
import { getDb } from '../../../server/db/client';
import { errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await loadSous(db, v, new URL(req.url).searchParams.get('room')));
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
