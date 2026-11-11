import { getDb } from '../../../../../../server/db/client';
import { errorResponse, setOrgCookie, viewerFor } from '../../../../../../server/session';
import { listMembers, removeMember } from '../../../../../../server/team';

export async function POST(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await ctx.params;
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    await removeMember(db, v, userId);
    if (userId === v.userId) return Response.json({ left: true }, { headers: { 'set-cookie': setOrgCookie(null) } });
    return Response.json(await listMembers(db, v));
  } catch (err) {
    return errorResponse(err);
  }
}
