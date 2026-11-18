// The week's improvement plan for one room.
// POST { op: 'commit', roomId, week, items: [{ id, owner, due }] } commits (or re-commits) it;
// POST { op: 'status', roomId, week, id, status } moves one action along.
// Both answer with { plan } as GET /api/page/week returns it.
import { getDb } from '../../../../../server/db/client';
import { commitWeekPlan, updateWeekPlanItem } from '../../../../../server/page/week';
import { errorResponse, viewerFor } from '../../../../../server/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const body = (await req.json().catch(() => null)) as { op?: unknown; roomId?: unknown; week?: unknown; items?: unknown; id?: unknown; status?: unknown } | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });
    if (body.op === 'commit') return Response.json(await commitWeekPlan(db, v, body));
    if (body.op === 'status') return Response.json(await updateWeekPlanItem(db, v, body));
    return Response.json({ error: "op must be 'commit' or 'status'" }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}
