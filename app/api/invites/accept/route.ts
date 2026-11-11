// Join the group an invite is for, then switch to it.
import { getDb } from '../../../../server/db/client';
import { getAuth } from '../../../../server/auth';
import { AuthError, errorResponse, setOrgCookie } from '../../../../server/session';
import { acceptInvite } from '../../../../server/team';

export async function POST(req: Request) {
  try {
    const session = await getAuth().api.getSession({ headers: req.headers });
    if (!session) throw new AuthError(401, 'Sign in or create an account first.');
    const { token } = ((await req.json().catch(() => ({}))) ?? {}) as { token?: unknown };
    const { orgId } = await acceptInvite(getDb(), session.user.id, !!(session.user as { isAnonymous?: boolean }).isAnonymous, token);
    return Response.json({ orgId }, { headers: { 'set-cookie': setOrgCookie(orgId) } });
  } catch (err) {
    return errorResponse(err);
  }
}
