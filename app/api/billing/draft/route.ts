import { getDb } from '../../../../server/db/client';
import { draftInvoice, listInvoices } from '../../../../server/billing';
import { AuthError, errorResponse, viewerFor } from '../../../../server/session';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    if (v.role === 'gm') throw new AuthError(403, 'Only an owner or admin can recalculate an invoice.');
    const { period } = ((await req.json().catch(() => ({}))) ?? {}) as { period?: string };
    const invoice = await draftInvoice(db, v.orgId, String(period));
    return Response.json({ invoice, invoices: await listInvoices(db, v.orgId) });
  } catch (err) {
    return errorResponse(err);
  }
}
