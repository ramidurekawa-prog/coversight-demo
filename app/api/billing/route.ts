// Billing: pricing, invoices, and this month so far (owner/admin).
import { getDb } from '../../../server/db/client';
import { draftInvoice, listInvoices, pricingFor } from '../../../server/billing';
import { periodOf } from '../../../lib/data/billing.js';
import { AuthError, errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    if (v.role === 'gm') throw new AuthError(403, 'Only an owner or admin can see billing.');
    const current = periodOf(new Date());
    await draftInvoice(db, v.orgId, current); // this month so far, recalculated on every look
    return Response.json({ pricing: await pricingFor(db, v.orgId), invoices: await listInvoices(db, v.orgId), current, stripe: !!process.env.STRIPE_SECRET_KEY });
  } catch (err) {
    return errorResponse(err);
  }
}
