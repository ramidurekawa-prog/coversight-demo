// Toast connection status (never the secret).
import { getDb } from '../../../server/db/client';
import { errorResponse, viewerFor } from '../../../server/session';
import { toastStatus } from '../../../server/toast-conn';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json({ connection: await toastStatus(db, v.orgId), canStore: (process.env.CREDENTIALS_KEY ?? '').length >= 32 });
  } catch (err) {
    return errorResponse(err);
  }
}
