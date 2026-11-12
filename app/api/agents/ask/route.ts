// Ask the operator or accountant copilot.
import { ask } from '../../../../server/agents/service';
import { getDb } from '../../../../server/db/client';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await ask(db, v, await req.json().catch(() => null)));
  } catch (err) {
    return errorResponse(err);
  }
}
