// A person accepts or rejects something the crew proposed.
import { agentStatus, decide } from '../../../../../server/agents/service';
import { getDb } from '../../../../../server/db/client';
import { errorResponse, viewerFor } from '../../../../../server/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const { id } = await ctx.params;
    const r = await decide(db, v, id, await req.json().catch(() => null));
    return Response.json({ ...r, status: await agentStatus(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}
