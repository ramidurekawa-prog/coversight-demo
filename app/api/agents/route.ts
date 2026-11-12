// The crew on System: who they are, what the last cycle did, what waits on a person.
import { agentStatus } from '../../../server/agents/service';
import { getDb } from '../../../server/db/client';
import { errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await agentStatus(db, v.orgId, v.rooms));
  } catch (err) {
    return errorResponse(err);
  }
}
