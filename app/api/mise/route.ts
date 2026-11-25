// Mise, the restaurant's brain: GET /api/mise?room=<id> → Mise's read per level and per consultant
// (written by the brain model when it is on, else empty so the page keeps its built-in words).
import { loadMise } from '../../../server/ai/mise';
import { getDb } from '../../../server/db/client';
import { errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await loadMise(db, v, new URL(req.url).searchParams.get('room')));
  } catch (err) {
    return errorResponse(err);
  }
}
