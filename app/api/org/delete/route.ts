// Delete the group (owner only, type its name to confirm). Logins stay.
import { getDb } from '../../../../server/db/client';
import { errorResponse, setOrgCookie, viewerFor } from '../../../../server/session';
import { deleteOrg } from '../../../../server/team';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const { confirm } = ((await req.json().catch(() => ({}))) ?? {}) as { confirm?: unknown };
    const res = await deleteOrg(db, v, confirm);
    return Response.json(res, { headers: { 'set-cookie': setOrgCookie(null) } });
  } catch (err) {
    return errorResponse(err);
  }
}
