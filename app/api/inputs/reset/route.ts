import { getDb } from '../../../../server/db/client';
import { loadInputs, resetInputs } from '../../../../server/org';
import { AuthError, errorResponse, viewerFor } from '../../../../server/session';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    if (v.role === 'gm') throw new AuthError(403, 'Only the owner can reset the whole group.');
    await resetInputs(db, { orgId: v.orgId, userId: v.userId });
    return Response.json(await loadInputs(db, v.orgId));
  } catch (err) {
    return errorResponse(err);
  }
}
