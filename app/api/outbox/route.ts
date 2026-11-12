// Emails: the owner's outbox (sent, held, drafts, skipped), and drafting one.
import { getDb } from '../../../server/db/client';
import { deliverOutbox, draftEmail, listOutbox } from '../../../server/notify';
import { errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json({ outbox: await listOutbox(db, v), provider: !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const row = await draftEmail(db, v, await req.json().catch(() => null));
    if (row.status === 'queued') await deliverOutbox(db).catch(() => null);
    const [fresh] = (await listOutbox(db, { ...v, role: 'owner' })).filter((m) => m.id === row.id);
    return Response.json({ email: fresh ?? row, provider: !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM) });
  } catch (err) {
    return errorResponse(err);
  }
}
