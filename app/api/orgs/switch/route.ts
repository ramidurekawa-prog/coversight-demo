// Switch which group this browser is looking at.
import { getDb } from '../../../../server/db/client';
import { errorResponse, setOrgCookie, viewerFor } from '../../../../server/session';
import { listOrgs } from '../../../../server/team';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const { orgId } = ((await req.json().catch(() => ({}))) ?? {}) as { orgId?: unknown };
    const mine = await listOrgs(db, v.userId);
    if (typeof orgId !== 'string' || !mine.some((o) => o.id === orgId)) return Response.json({ error: 'Not one of your groups.' }, { status: 403 });
    return Response.json({ ok: true }, { headers: { 'set-cookie': setOrgCookie(orgId) } });
  } catch (err) {
    return errorResponse(err);
  }
}
