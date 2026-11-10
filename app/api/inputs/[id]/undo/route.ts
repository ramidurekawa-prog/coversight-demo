import { getDb } from '../../../../../server/db/client';
import { loadInputs, undoInput } from '../../../../../server/org';
import { errorResponse, viewerFor } from '../../../../../server/session';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const { id } = await ctx.params;
    await undoInput(db, { orgId: v.orgId, userId: v.userId, id });
    return Response.json(await loadInputs(db, v.orgId));
  } catch (err) {
    return errorResponse(err);
  }
}
