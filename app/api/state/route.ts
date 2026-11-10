// Everything a signed-in viewer's screens need: their org's dataset (seed-shaped,
// so lib/data/model.js computes every figure from it), their hand-entered
// inputs, their saved decisions, and the activity log.
import { loadActions } from '../../../server/actions';
import { getDb } from '../../../server/db/client';
import { loadBase, loadInputs } from '../../../server/org';
import { errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const loaded = await loadBase(db, v.orgId, v.rooms);
    if (!loaded) return Response.json({ error: 'Organization not found.' }, { status: 404 });
    const [{ inputs, log }, actions] = await Promise.all([loadInputs(db, v.orgId), loadActions(db, v.orgId, v.rooms)]);
    return Response.json({ ...loaded, inputs, log, actions, viewer: { role: v.role, anonymous: v.anonymous, rooms: v.rooms } });
  } catch (err) {
    return errorResponse(err);
  }
}
