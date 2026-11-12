// Check, then store the credentials sealed (owner).
import { getDb } from '../../../../server/db/client';
import { errorResponse, viewerFor } from '../../../../server/session';
import { connectToast } from '../../../../server/toast-conn';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const res = await connectToast(db, v, await req.json().catch(() => null));
    if (!res.connected && 'check' in res && res.check) { const { data: _omit, ...safe } = res.check; return Response.json({ connected: false, check: safe }); }
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
