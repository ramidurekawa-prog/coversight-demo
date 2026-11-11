import { getDb } from '../../../../../../server/db/client';
import { errorResponse, viewerFor } from '../../../../../../server/session';
import { listMembers, revokeInvite } from '../../../../../../server/team';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    await revokeInvite(db, v, id);
    return Response.json(await listMembers(db, v));
  } catch (err) {
    return errorResponse(err);
  }
}
