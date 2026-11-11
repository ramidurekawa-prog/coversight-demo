// Create an invite link (owner/admin). The link is returned once.
import { getDb } from '../../../../server/db/client';
import { deliverOutbox } from '../../../../server/notify';
import { errorResponse, viewerFor } from '../../../../server/session';
import { createInvite, listMembers } from '../../../../server/team';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const res = await createInvite(db, v, await req.json().catch(() => null));
    await deliverOutbox(db).catch(() => null);
    return Response.json({ link: res.link, ...(await listMembers(db, v)) });
  } catch (err) {
    return errorResponse(err);
  }
}
