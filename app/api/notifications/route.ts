// The bell: list notifications, or mark some (or 'all') read.
import { getDb } from '../../../server/db/client';
import { listNotifications, markRead } from '../../../server/notify';
import { errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await listNotifications(db, v));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const { ids } = ((await req.json().catch(() => ({}))) ?? {}) as { ids?: unknown };
    await markRead(db, v, ids);
    return Response.json(await listNotifications(db, v));
  } catch (err) {
    return errorResponse(err);
  }
}
