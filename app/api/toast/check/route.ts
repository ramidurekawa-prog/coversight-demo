// Check Toast credentials against Toast without storing anything (owner).
import { getDb } from '../../../../server/db/client';
import { AuthError, errorResponse, viewerFor } from '../../../../server/session';
import { checkToast } from '../../../../server/toast-conn';

export async function POST(req: Request) {
  try {
    const v = await viewerFor(req.headers, getDb());
    if (v.role !== 'owner') throw new AuthError(403, 'Only an owner can connect Toast.');
    const res = await checkToast(await req.json().catch(() => null));
    const { data: _omit, ...safe } = res; // never echo the secret back
    return Response.json(safe);
  } catch (err) {
    return errorResponse(err);
  }
}
