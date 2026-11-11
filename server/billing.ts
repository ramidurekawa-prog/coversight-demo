// Invoices: drafted monthly from verified tests, finalized by the owner once
// the accountant has approved that month's package, optionally pushed to
// Stripe when STRIPE_SECRET_KEY is set.
import { and, desc, eq, inArray, ne } from 'drizzle-orm';

import { buildInvoice, DEFAULT_PRICING, isPeriod } from '../lib/data/billing.js';
import type { Db } from './db/client';
import { actions, auditLog, invoices, memberships, orgs, rooms, testWindows, users } from './db/schema';
import { notify } from './notify';
import { InputError } from './org';
import { AuthError, type Viewer } from './session';

type Pricing = { perRoomMonthlyCents: number; feePct: number };
type Accrual = { windowId: string; period: string; days: number; from: number; to: number; cents: number };

async function latestGroupAction<T>(db: Db, orgId: string, key: string): Promise<T | null> {
  const [row] = await db.select({ value: actions.value }).from(actions).where(and(eq(actions.orgId, orgId), eq(actions.roomId, ''), eq(actions.key, key))).orderBy(desc(actions.at)).limit(1);
  return (row?.value as T) ?? null;
}

export async function pricingFor(db: Db, orgId: string): Promise<Pricing> {
  return { ...DEFAULT_PRICING, ...((await latestGroupAction<Pricing>(db, orgId, 'pricing')) ?? {}) };
}

/** Recalculate a month's draft (a final invoice never changes). */
export async function draftInvoice(db: Db, orgId: string, period: string) {
  if (!isPeriod(period)) throw new InputError('period must be YYYY-MM');
  const [existing] = await db.select().from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.period, period)));
  if (existing?.status === 'final') return existing;
  const roomCount = (await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.orgId, orgId))).filter((r) => r.id !== 'all').length;
  const ws = await db.select().from(testWindows).where(and(eq(testWindows.orgId, orgId), inArray(testWindows.status, ['verified', 'reversed'])));
  const finals = await db.select({ accruals: invoices.accruals }).from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.status, 'final'), ne(invoices.period, period)));
  const pricing = await pricingFor(db, orgId);
  const inv = buildInvoice({
    period, rooms: roomCount, pricing,
    windows: ws.map((w) => ({ id: w.id, title: w.title, roomId: w.roomId, status: w.status, bookedCents: w.bookedCents, bookedCentsBeforeReversal: Math.max(0, w.lowCents ?? 0), closedAt: w.closedAt ?? undefined, reversedAt: w.reversedAt })),
    billed: finals.flatMap((f) => f.accruals as Accrual[]),
  });
  const values = { lines: inv.lines, accruals: inv.accruals, pricing, reconciledCents: inv.reconciledCents, totalCents: inv.totalCents, updatedAt: new Date() };
  const [row] = existing
    ? await db.update(invoices).set(values).where(eq(invoices.id, existing.id)).returning()
    : await db.insert(invoices).values({ orgId, period, ...values }).returning();
  return row!;
}

export async function listInvoices(db: Db, orgId: string) {
  return db.select().from(invoices).where(eq(invoices.orgId, orgId)).orderBy(desc(invoices.period)).limit(36);
}

const form = (o: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

async function stripe(path: string, body: Record<string, string | number | undefined>, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form(body) });
  const json = (await res.json().catch(() => ({}))) as { id?: string; hosted_invoice_url?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message || `Stripe ${res.status}`);
  return json;
}

/** Push a final invoice to Stripe (customer → items → invoice → finalize). */
async function pushToStripe(db: Db, orgId: string, inv: typeof invoices.$inferSelect, fetchImpl: typeof fetch) {
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  const meta = (org!.meta ?? {}) as Record<string, unknown>;
  let customer = meta.stripeCustomerId as string | undefined;
  if (!customer) {
    const [o] = await db.select({ email: users.email, name: users.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner'))).limit(1);
    customer = (await stripe('customers', { name: org!.name, email: o?.email, 'metadata[orgId]': orgId }, fetchImpl)).id!;
    await db.update(orgs).set({ meta: { ...meta, stripeCustomerId: customer } }).where(eq(orgs.id, orgId));
  }
  for (const l of inv.lines as { label: string; cents: number }[]) {
    if (l.cents === 0) continue;
    await stripe('invoiceitems', { customer, amount: l.cents, currency: 'usd', description: `${inv.period}: ${l.label}` }, fetchImpl);
  }
  const created = await stripe('invoices', { customer, collection_method: 'send_invoice', days_until_due: 15, pending_invoice_items_behavior: 'include', 'metadata[period]': inv.period, 'metadata[orgId]': orgId }, fetchImpl);
  const fin = await stripe(`invoices/${created.id}/finalize`, {}, fetchImpl);
  return { id: created.id!, url: fin.hosted_invoice_url ?? null };
}

/**
 * Freeze a month's invoice. Needs the accountant's approval of that month's
 * package (Accountant screen); a dispute blocks it.
 */
export async function finalizeInvoice(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'role'>, period: unknown, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}) {
  if (v.role !== 'owner') throw new AuthError(403, 'Only an owner can finalize an invoice.');
  if (!isPeriod(period)) throw new InputError('period must be YYYY-MM');
  const pkg = await latestGroupAction<{ status: string; period?: string }>(db, v.orgId, 'billing');
  if (pkg?.status === 'disputed') throw new InputError('The accountant has a dispute open on the package. Resolve it first.');
  if (pkg?.status !== 'approved' || (pkg.period && pkg.period !== period)) throw new InputError(`The accountant hasn’t approved the ${period} package yet (Accountant screen).`);
  const draft = await draftInvoice(db, v.orgId, period as string);
  if (draft.status === 'final') return draft;
  let [row] = await db.update(invoices).set({ status: 'final', finalizedAt: new Date(), finalizedBy: v.userId, updatedAt: new Date() }).where(eq(invoices.id, draft.id)).returning();
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'invoice.finalized', detail: { period, totalCents: row!.totalCents } });
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const s = await pushToStripe(db, v.orgId, row!, fetchImpl);
      [row] = await db.update(invoices).set({ stripeInvoiceId: s.id, stripeUrl: s.url }).where(eq(invoices.id, row!.id)).returning();
    } catch (err) {
      await notify(db, { orgId: v.orgId, kind: 'invoice.stripe', severity: 'warn', title: `${period} invoice is final, but Stripe refused it`, body: (err instanceof Error ? err.message : String(err)).slice(0, 300), link: '/billing/', dedupe: `invoice.stripe:${row!.id}` });
    }
  }
  return row!;
}

/** Monthly job: draft last month's invoice for every real group. */
export async function runBilling(db: Db, orgId: string, period: string) {
  const [org] = await db.select({ sample: orgs.sample }).from(orgs).where(eq(orgs.id, orgId));
  if (!org || org.sample) return { skipped: 'sample group' };
  const inv = await draftInvoice(db, orgId, period);
  await notify(db, { orgId, kind: 'invoice.draft', title: `${period} invoice drafted: $${(inv.totalCents / 100).toFixed(2)}`, body: 'It finalizes once the accountant approves the month’s package.', link: '/billing/', dedupe: `invoice.draft:${period}` });
  return { period, totalCents: inv.totalCents, reconciledCents: inv.reconciledCents };
}
