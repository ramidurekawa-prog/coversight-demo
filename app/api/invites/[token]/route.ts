// What an invite link is for, shown before signing in. No auth: the token is the secret.
import { getDb } from '../../../../server/db/client';
import { errorResponse } from '../../../../server/session';
import { peekInvite } from '../../../../server/team';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const invite = await peekInvite(getDb(), token);
    return invite ? Response.json({ invite }) : Response.json({ error: 'This invite link has expired or was already used.' }, { status: 404 });
  } catch (err) {
    return errorResponse(err);
  }
}
