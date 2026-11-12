// Groups this person belongs to; start their own.
import { getDb } from '../../../server/db/client';
import { errorResponse, setOrgCookie, viewerFor } from '../../../server/session';
import { createOwnOrg, listOrgs } from '../../../server/team';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json({ current: v.orgId, orgs: await listOrgs(db, v.userId) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    if (v.anonymous) return Response.json({ error: 'Create an account to start your own group. Sample guests can’t.' }, { status: 403 });
    const org = await createOwnOrg(db, v.userId, await req.json().catch(() => null));
    return Response.json({ org }, { headers: { 'set-cookie': setOrgCookie(org.id) } });
  } catch (err) {
    return errorResponse(err);
  }
}
