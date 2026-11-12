import { getDb } from '../../../../server/db/client';
import { resetInputs } from '../../../../server/org';
import { scopedInputs } from '../../../../server/page/inputs';
import { AuthError, errorResponse, viewerFor } from '../../../../server/session';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    if (v.role === 'gm') throw new AuthError(403, 'Only the owner can reset the whole group.');
    await resetInputs(db, { orgId: v.orgId, userId: v.userId });
    return Response.json(await scopedInputs(db, v));
  } catch (err) {
    return errorResponse(err);
  }
}
