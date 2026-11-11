// Change someone's role and rooms.
import { getDb } from '../../../../../server/db/client';
import { errorResponse, viewerFor } from '../../../../../server/session';
import { listMembers, updateMember } from '../../../../../server/team';

export async function POST(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await ctx.params;
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    await updateMember(db, v, userId, await req.json().catch(() => null));
    return Response.json(await listMembers(db, v));
  } catch (err) {
    return errorResponse(err);
  }
}
