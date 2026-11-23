// Everything a signed-in viewer's screens need: their org's dataset (seed-shaped,
// so lib/data/model.js computes every figure from it), their hand-entered
// inputs, their saved decisions, and the activity log. Inputs and log are
// scoped like the rest: a GM gets only their own rooms.
import { loadActions } from '../../../server/actions';
import { getDb } from '../../../server/db/client';
import { loadBase } from '../../../server/org';
import { scopedInputs } from '../../../server/page/inputs';
import { redactStaff } from '../../../server/page/staff';
import { errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const loaded = await loadBase(db, v.orgId, v.rooms);
    if (!loaded) return Response.json({ error: 'Organization not found.' }, { status: 404 });
    const [{ inputs, log }, actions] = await Promise.all([scopedInputs(db, v), loadActions(db, v.orgId, v.rooms, v.userId, v.role)]);
    // Per-person POS rows (the Staff page) only reach owners, admins and GMs.
    const safe = redactStaff(loaded.base as { rooms?: Record<string, Record<string, unknown>> }, inputs as Record<string, Record<string, unknown>>, v.role);
    return Response.json({ ...loaded, base: safe.base, inputs: safe.inputs, log, actions, viewer: { userId: v.userId, role: v.role, anonymous: v.anonymous, rooms: v.rooms } });
  } catch (err) {
    return errorResponse(err);
  }
}
