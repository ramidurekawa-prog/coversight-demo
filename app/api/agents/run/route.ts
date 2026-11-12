// Run the crew now for this group (owner or admin).
import { agentStatus, runAgents } from '../../../../server/agents/service';
import { getDb } from '../../../../server/db/client';
import { AuthError, errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    if (v.role === 'gm') throw new AuthError(403, 'An owner or admin runs the crew; it covers every room.');
    const result = await runAgents(db, v.orgId, { trigger: 'manual' });
    return Response.json({ result, status: await agentStatus(db, v.orgId, v.rooms) }, { status: result.ok ? 200 : 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
