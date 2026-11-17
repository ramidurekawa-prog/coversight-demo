// 7shifts (staff schedule): GET status (never the token); POST
// { action: 'check' | 'connect' | 'disconnect', token?, companyId?, locations?, serverRoles? }.
import { getDb } from '../../../server/db/client';
import { AuthError, errorResponse, viewerFor } from '../../../server/session';
import { checkSevenShifts, connectSevenShifts, disconnectSevenShifts, staffStatus } from '../../../server/sevenshifts';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json({ connection: await staffStatus(db, v.orgId), canStore: !!process.env.CREDENTIALS_KEY && process.env.CREDENTIALS_KEY.length >= 32 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const body = (await req.json().catch(() => null)) as { action?: string } | null;
    if (body?.action === 'check') {
      if (v.role !== 'owner') throw new AuthError(403, 'Only an owner can connect 7shifts.');
      return Response.json(await checkSevenShifts(body));
    }
    if (body?.action === 'connect') return Response.json(await connectSevenShifts(db, v, body));
    if (body?.action === 'disconnect') { await disconnectSevenShifts(db, v); return Response.json({ ok: true }); }
    return Response.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}
