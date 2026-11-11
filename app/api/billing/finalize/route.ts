import { getDb } from '../../../../server/db/client';
import { finalizeInvoice, listInvoices } from '../../../../server/billing';
import { errorResponse, viewerFor } from '../../../../server/session';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const { period } = ((await req.json().catch(() => ({}))) ?? {}) as { period?: unknown };
    const invoice = await finalizeInvoice(db, v, period);
    return Response.json({ invoice, invoices: await listInvoices(db, v.orgId) });
  } catch (err) {
    return errorResponse(err);
  }
}
