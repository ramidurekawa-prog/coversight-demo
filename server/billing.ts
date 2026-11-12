// Invoices: drafted monthly from verified tests, finalized by the owner once
// the accountant has approved that month's package, then delivered to Stripe
// when STRIPE_SECRET_KEY is set.
//
// Finalizing and delivering are separate. Finalizing is ours: one transaction
// freezes the invoice, records the audit and queues delivery. Delivery is
// Stripe's: it resumes from saved progress, sends an Idempotency-Key on every
// call, and retries with backoff from every scheduled job run, so a timeout
// or a refusal never leaves a half-made Stripe invoice or a duplicate one.
import { and, desc, eq, inArray, isNull, lte, ne, or } from 'drizzle-orm';

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

type Progress = { customer?: string; invoice?: string; items?: Record<string, string>; finalized?: boolean; url?: string | null };
type StripeBody = { id?: string; hosted_invoice_url?: string; error?: { message?: string; type?: string } };

class StripeError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

async function stripe(path: string, body: Record<string, string | number | undefined>, idempotencyKey: string, fetchImpl: typeof fetch): Promise<StripeBody> {
  let res: Response;
  try {
    res = await fetchImpl(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': idempotencyKey }, body: form(body) });
  } catch (err) {
    throw new StripeError(`Couldn’t reach Stripe: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  const json = (await res.json().catch(() => ({}))) as StripeBody;
  // 409 (idempotency in flight), 429 and 5xx clear up on their own; 4xx needs a person.
  if (!res.ok) throw new StripeError(json.error?.message || `Stripe ${res.status}`, res.status === 409 || res.status === 429 || res.status >= 500);
  return json;
}

/** Hours to wait after the nth failed attempt; after the last, delivery is marked failed. */
export const DELIVERY_BACKOFF_HOURS = [1, 4, 12, 24, 24];
const LEASE_MS = 10 * 60_000;

/**
 * Deliver one final invoice to Stripe: customer → draft invoice → its items →
 * finalize. Each step is skipped if saved progress shows it done, and carries
 * an Idempotency-Key, so a crash between Stripe answering and us saving
 * replays the same object instead of making a second one.
 */
export async function deliverInvoice(db: Db, invoiceId: string, { fetchImpl = fetch, now = new Date() }: { fetchImpl?: typeof fetch; now?: Date } = {}) {
  if (!process.env.STRIPE_SECRET_KEY) return { skipped: 'stripe not configured' };
  // Claim it: pending, due, and not leased by another run.
  const [inv] = await db.update(invoices).set({ nextDeliveryAt: new Date(now.getTime() + LEASE_MS) })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, 'final'), eq(invoices.delivery, 'pending'), or(isNull(invoices.nextDeliveryAt), lte(invoices.nextDeliveryAt, now))))
    .returning();
  if (!inv) return { skipped: 'not due' };
  const progress: Progress = { items: {}, ...(inv.deliveryProgress as Progress) };
  const save = () => db.update(invoices).set({ deliveryProgress: progress, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
  try {
    if (!progress.customer) {
      const [org] = await db.select().from(orgs).where(eq(orgs.id, inv.orgId));
      const meta = (org!.meta ?? {}) as Record<string, unknown>;
      let customer = meta.stripeCustomerId as string | undefined;
      if (!customer) {
        const [o] = await db.select({ email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, inv.orgId), eq(memberships.role, 'owner'))).limit(1);
        customer = (await stripe('customers', { name: org!.name, email: o?.email, 'metadata[orgId]': inv.orgId }, `cv-customer-${inv.orgId}`, fetchImpl)).id!;
        await db.update(orgs).set({ meta: { ...meta, stripeCustomerId: customer } }).where(eq(orgs.id, inv.orgId));
      }
      progress.customer = customer;
      await save();
    }
    if (!progress.invoice) {
      // Items attach to this invoice explicitly; nothing else pending on the customer is swept in.
      progress.invoice = (await stripe('invoices', { customer: progress.customer, collection_method: 'send_invoice', days_until_due: 15, auto_advance: 'false', pending_invoice_items_behavior: 'exclude', 'metadata[period]': inv.period, 'metadata[orgId]': inv.orgId, 'metadata[invoiceId]': inv.id }, `cv-invoice-${inv.id}`, fetchImpl)).id!;
      await save();
    }
    for (const [i, l] of (inv.lines as { label: string; cents: number }[]).entries()) {
      if (l.cents === 0 || progress.items![i]) continue;
      progress.items![i] = (await stripe('invoiceitems', { customer: progress.customer, invoice: progress.invoice, amount: l.cents, currency: 'usd', description: `${inv.period}: ${l.label}` }, `cv-item-${inv.id}-${i}`, fetchImpl)).id!;
      await save();
    }
    if (!progress.finalized) {
      const fin = await stripe(`invoices/${progress.invoice}/finalize`, {}, `cv-finalize-${inv.id}`, fetchImpl);
      progress.finalized = true;
      progress.url = fin.hosted_invoice_url ?? null;
    }
    const [row] = await db.update(invoices).set({ delivery: 'sent', deliveryError: null, nextDeliveryAt: null, deliveryProgress: progress, stripeInvoiceId: progress.invoice, stripeUrl: progress.url ?? null, updatedAt: new Date() }).where(eq(invoices.id, inv.id)).returning();
    return { sent: row!.stripeInvoiceId };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    const attempts = inv.deliveryAttempts + 1;
    const retryable = !(err instanceof StripeError) || err.retryable;
    const wait = DELIVERY_BACKOFF_HOURS[attempts - 1];
    const giveUp = !retryable || wait === undefined;
    await db.update(invoices).set({ deliveryAttempts: attempts, deliveryError: message, deliveryProgress: progress, delivery: giveUp ? 'failed' : 'pending', nextDeliveryAt: giveUp ? null : new Date(now.getTime() + wait! * 3_600_000), updatedAt: new Date() }).where(eq(invoices.id, inv.id));
    await notify(db, {
      orgId: inv.orgId, kind: 'invoice.stripe', severity: 'warn', link: '/billing/',
      title: giveUp ? `${inv.period} invoice is final, but Stripe delivery stopped` : `${inv.period} invoice is final; Stripe delivery will retry`,
      body: giveUp ? `${message} Fix it, then press Retry on Billing.` : `${message} Next try in about ${wait} hour${wait === 1 ? '' : 's'}.`,
      dedupe: `invoice.stripe:${inv.id}:${giveUp ? 'failed' : 'retrying'}`,
    });
    return { error: message, attempts, failed: giveUp };
  }
}

/** Every due delivery; called after each scheduled job run. */
export async function deliverInvoices(db: Db, { fetchImpl = fetch, now = new Date(), orgId }: { fetchImpl?: typeof fetch; now?: Date; orgId?: string } = {}) {
  if (!process.env.STRIPE_SECRET_KEY) return [];
  const due = await db.select({ id: invoices.id }).from(invoices)
    .where(and(eq(invoices.delivery, 'pending'), or(isNull(invoices.nextDeliveryAt), lte(invoices.nextDeliveryAt, now)), orgId ? eq(invoices.orgId, orgId) : undefined));
  const out = [];
  for (const { id } of due) out.push(await deliverInvoice(db, id, { fetchImpl, now }));
  return out;
}

/** An owner's Retry after a delivery stopped: queue it again now. */
export async function retryDelivery(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'role'>, period: unknown, { fetchImpl = fetch, now = new Date() }: { fetchImpl?: typeof fetch; now?: Date } = {}) {
  if (v.role !== 'owner') throw new AuthError(403, 'Only an owner can retry an invoice.');
  if (!isPeriod(period)) throw new InputError('period must be YYYY-MM');
  if (!process.env.STRIPE_SECRET_KEY) throw new InputError('Stripe isn’t connected.');
  const [inv] = await db.update(invoices).set({ delivery: 'pending', deliveryAttempts: 0, nextDeliveryAt: null })
    .where(and(eq(invoices.orgId, v.orgId), eq(invoices.period, period as string), eq(invoices.status, 'final'), inArray(invoices.delivery, ['failed', 'pending']))).returning();
  if (!inv) throw new InputError(`No ${period} invoice is waiting on Stripe.`);
  await deliverInvoice(db, inv.id, { fetchImpl, now });
  const [row] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
  return row!;
}

/**
 * Freeze a month's invoice. Needs the accountant's approval of that month's
 * package (Accountant screen); a dispute blocks it. Finalizing never waits on
 * Stripe: the invoice, its audit entry and the queued delivery commit
 * together, then one delivery attempt runs.
 */
export async function finalizeInvoice(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'role'>, period: unknown, { fetchImpl = fetch, now = new Date() }: { fetchImpl?: typeof fetch; now?: Date } = {}) {
  if (v.role !== 'owner') throw new AuthError(403, 'Only an owner can finalize an invoice.');
  if (!isPeriod(period)) throw new InputError('period must be YYYY-MM');
  const pkg = await latestGroupAction<{ status: string; period?: string }>(db, v.orgId, 'billing');
  if (pkg?.status === 'disputed') throw new InputError('The accountant has a dispute open on the package. Resolve it first.');
  if (pkg?.status !== 'approved' || (pkg.period && pkg.period !== period)) throw new InputError(`The accountant hasn’t approved the ${period} package yet (Accountant screen).`);
  const draft = await draftInvoice(db, v.orgId, period as string);
  if (draft.status === 'final') return draft;
  // A sample copy is never sent anywhere: it finalizes here and stays here.
  const [org] = await db.select({ sample: orgs.sample }).from(orgs).where(eq(orgs.id, v.orgId));
  const deliver = !!process.env.STRIPE_SECRET_KEY && !org?.sample;
  const row = await db.transaction(async (tx) => {
    // Only a draft finalizes, so two owners clicking at once finalize it once.
    const [r] = await tx.update(invoices).set({ status: 'final', finalizedAt: now, finalizedBy: v.userId, delivery: deliver ? 'pending' : 'none', nextDeliveryAt: null, updatedAt: now })
      .where(and(eq(invoices.id, draft.id), eq(invoices.status, 'draft'))).returning();
    if (r) await tx.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'invoice.finalized', detail: { period, totalCents: r.totalCents } });
    return r;
  });
  if (row?.delivery === 'pending') await deliverInvoice(db, row.id, { fetchImpl, now });
  const [fresh] = await db.select().from(invoices).where(eq(invoices.id, draft.id));
  return fresh!;
}

/** Monthly job: draft last month's invoice for every real group. */
export async function runBilling(db: Db, orgId: string, period: string) {
  const [org] = await db.select({ sample: orgs.sample }).from(orgs).where(eq(orgs.id, orgId));
  if (!org || org.sample) return { skipped: 'sample group' };
  const inv = await draftInvoice(db, orgId, period);
  await notify(db, { orgId, kind: 'invoice.draft', title: `${period} invoice drafted: $${(inv.totalCents / 100).toFixed(2)}`, body: 'It finalizes once the accountant approves the month’s package.', link: '/billing/', dedupe: `invoice.draft:${period}` });
  return { period, totalCents: inv.totalCents, reconciledCents: inv.reconciledCents };
}
