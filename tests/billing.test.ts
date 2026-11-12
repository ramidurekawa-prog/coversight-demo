import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { accrual, buildInvoice, previousPeriod } from '../lib/data/billing.js';
import { DELIVERY_BACKOFF_HOURS, deliverInvoices, draftInvoice, finalizeInvoice, listInvoices, retryDelivery, runBilling } from '../server/billing';
import { saveAction } from '../server/actions';
import type { Db } from '../server/db/client';
import { auditLog, invoices, notifications, orgs, testWindows, users } from '../server/db/schema';
import { createOwnOrg } from '../server/team';
import { createSampleOrg } from '../server/org';
import { freshDb } from './helpers/db';

const w = (o: Partial<{ id: string; status: string; bookedCents: number; bookedCentsBeforeReversal: number; closedAt: string; reversedAt: string | null }>) =>
  ({ id: 'w1', title: 'Overtime: kitchen', roomId: 'a', status: 'verified', bookedCents: 700, closedAt: '2026-09-10T12:00:00Z', reversedAt: null, ...o });

describe('the invoice math', () => {
  it('accrues a verified result from the day after it closed, per day of the month', () => {
    expect(accrual(w({}), '2026-09')).toMatchObject({ days: 20, cents: 2000 }); // Sep 11–30 at $7/wk = $1/day
    expect(accrual(w({}), '2026-10')).toMatchObject({ days: 31, cents: 3100 });
    expect(accrual(w({}), '2026-08').days).toBe(0);
    expect(accrual(w({ status: 'reversed', bookedCents: 0, bookedCentsBeforeReversal: 700, reversedAt: '2026-10-21T08:00:00Z' }), '2026-10')).toMatchObject({ days: 20, cents: 2000 });
  });

  it('subscription per room, fee on reconciled savings only, and what you kept', () => {
    const inv = buildInvoice({ period: '2026-10', rooms: 3, pricing: { perRoomMonthlyCents: 34900, feePct: 15 }, windows: [w({}), w({ id: 'w2', bookedCents: 1400, closedAt: '2026-10-15T00:00:00Z' })] });
    expect(inv.lines.map((l) => l.cents)).toEqual([104700, Math.round((3100 + 3200) * 0.15)]);
    expect(inv.reconciledCents).toBe(3100 + 3200);
    expect(inv.totalCents).toBe(104700 + 945);
    expect(inv.keptCents).toBe(6300 - inv.totalCents);
  });

  it('credits the fee on days already billed after a later reversal', () => {
    const billed = [{ windowId: 'w1', period: '2026-10', days: 31, from: Date.UTC(2026, 9, 1) / 864e5, to: Date.UTC(2026, 10, 1) / 864e5, cents: 3100 }];
    // Reversed Oct 21, found after October was finalized: 11 days of fee come back.
    const inv = buildInvoice({ period: '2026-11', rooms: 1, windows: [w({ status: 'reversed', bookedCents: 0, bookedCentsBeforeReversal: 700, reversedAt: '2026-10-21T00:00:00Z' })], billed });
    const credit = inv.lines.find((l) => l.kind === 'credit')!;
    expect(credit.cents).toBe(-Math.round(100 * 11 * 0.15));
    expect(credit.label).toMatch(/fee on 11 days of 2026-10 returned/);
  });

  it('previous period', () => {
    expect(previousPeriod(new Date('2026-11-02T14:00:00Z'))).toBe('2026-10');
    expect(previousPeriod(new Date('2026-01-02T14:00:00Z'))).toBe('2025-12');
  });
});

describe('invoices in the database', () => {
  let db: Db;
  let orgId: string;
  const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
  beforeEach(async () => {
    db = await freshDb();
    await db.insert(users).values({ id: 'u1', name: 'Owner', email: 'owner@example.com' });
    orgId = (await createOwnOrg(db, 'u1', { name: 'Harbor Hospitality', rooms: [{ name: 'Harbor Grill', seats: 90 }, { name: 'Pier Nine', seats: 40 }] })).id;
    await db.insert(testWindows).values({
      orgId, roomId: 'harbor-grill', lever: 'overtime', metric: 'otMinutes', title: 'Overtime: Kitchen overtime', direction: 'down', baseline: 240, centsPerUnitWeek: 15,
      startedAt: '2026-08-08', guard: { avgCheckBase: 30, turnBase: 70 }, status: 'verified', bookedCents: 2800, lowCents: 2800, closedAt: new Date('2026-09-05T12:00:00Z'),
    });
  });
  afterEach(() => { delete process.env.STRIPE_SECRET_KEY; });

  it('drafts from verified tests with the group’s pricing; a draft recalculates, a final one is frozen', async () => {
    let inv = await draftInvoice(db, orgId, '2026-10');
    expect(inv.status).toBe('draft');
    expect(inv.reconciledCents).toBe(12400); // 31 days × $4/day
    expect(inv.totalCents).toBe(2 * 34900 + 1860);
    await saveAction(db, owner(), { roomId: '', key: 'pricing', value: { perRoomMonthlyCents: 29900, feePct: 10 } });
    inv = await draftInvoice(db, orgId, '2026-10');
    expect(inv.totalCents).toBe(2 * 29900 + 1240);
    await expect(finalizeInvoice(db, owner(), '2026-10')).rejects.toThrow(/hasn’t approved the 2026-10 package/);
    await saveAction(db, owner(), { roomId: '', key: 'billing', value: { status: 'disputed', note: 'line 6020' } });
    await expect(finalizeInvoice(db, owner(), '2026-10')).rejects.toThrow(/dispute open/);
    await saveAction(db, owner(), { roomId: '', key: 'billing', value: { status: 'approved', period: '2026-10' } });
    await expect(finalizeInvoice(db, { ...owner(), role: 'admin' }, '2026-10')).rejects.toThrow(/Only an owner/);
    const fin = await finalizeInvoice(db, owner(), '2026-10');
    expect(fin.status).toBe('final');
    await saveAction(db, owner(), { roomId: '', key: 'pricing', value: { perRoomMonthlyCents: 1, feePct: 1 } });
    expect((await draftInvoice(db, orgId, '2026-10')).totalCents).toBe(fin.totalCents);
    expect((await listInvoices(db, orgId)).map((i) => i.period)).toEqual(['2026-10']);
  });

  it('a reversal after a month was finalized credits it on the next one', async () => {
    await saveAction(db, owner(), { roomId: '', key: 'billing', value: { status: 'approved' } });
    await finalizeInvoice(db, owner(), '2026-10');
    await db.update(testWindows).set({ status: 'reversed', bookedCents: 0, reversedAt: new Date('2026-10-22T00:00:00Z') }).where(eq(testWindows.orgId, orgId));
    const nov = await draftInvoice(db, orgId, '2026-11');
    expect(nov.reconciledCents).toBe(0);
    const credit = (nov.lines as { kind: string; cents: number }[]).find((l) => l.kind === 'credit')!;
    expect(credit.cents).toBe(-Math.round(400 * 10 * 0.15)); // Oct 22–31 billed at $4/day
  });

  /** A fake Stripe that remembers idempotency keys, like the real one. */
  function fakeStripe(fail: (path: string, n: number) => number | 'network' | null = () => null) {
    const calls: { path: string; key: string; body: string }[] = [];
    const seen = new Map<string, unknown>();
    let n = 0;
    const ids: Record<string, number> = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const path = url.replace('https://api.stripe.com/v1/', '');
      const key = (init.headers as Record<string, string>)['idempotency-key']!;
      const f = fail(path, n++);
      if (f === 'network') throw new Error('socket hang up');
      if (f) return new Response(JSON.stringify({ error: { message: `Stripe says ${f}` } }), { status: f });
      calls.push({ path, key, body: String(init.body) });
      if (!seen.has(key)) {
        const kind = path === 'customers' ? 'cus' : path === 'invoices' ? 'in' : path.endsWith('/finalize') ? 'fin' : 'ii';
        ids[kind] = (ids[kind] ?? 0) + 1;
        seen.set(key, kind === 'fin' ? { id: 'in_1', hosted_invoice_url: 'https://pay.stripe.com/i/1' } : { id: `${kind}_${ids[kind]}` });
      }
      return new Response(JSON.stringify(seen.get(key)), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl, created: () => ids };
  }
  const approve = () => saveAction(db, owner(), { roomId: '', key: 'billing', value: { status: 'approved' } });
  const oct = async () => (await db.select().from(invoices).where(eq(invoices.period, '2026-10')))[0]!;
  const T = new Date('2026-11-03T15:00:00Z');
  const hours = (h: number) => new Date(T.getTime() + h * 3_600_000);

  it('delivers a final invoice to Stripe with an idempotency key on every call', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    await approve();
    const s = fakeStripe();
    const fin = await finalizeInvoice(db, owner(), '2026-10', { fetchImpl: s.fetchImpl, now: T });
    // Draft invoice first, then its items attached to it, then finalize.
    expect(s.calls.map((c) => c.path)).toEqual(['customers', 'invoices', 'invoiceitems', 'invoiceitems', 'invoices/in_1/finalize']);
    expect(s.calls.every((c) => c.key.startsWith('cv-'))).toBe(true);
    expect(s.calls.find((c) => c.path === 'invoices')!.body).toContain('pending_invoice_items_behavior=exclude');
    expect(s.calls.filter((c) => c.path === 'invoiceitems').every((c) => c.body.includes('invoice=in_1'))).toBe(true);
    expect(fin).toMatchObject({ status: 'final', delivery: 'sent', stripeInvoiceId: 'in_1', stripeUrl: 'https://pay.stripe.com/i/1' });
    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
    expect((org!.meta as { stripeCustomerId: string }).stripeCustomerId).toBe('cus_1');
  });

  it('Stripe down: the invoice is still final, and delivery retries with backoff', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    await approve();
    let down = true;
    const s = fakeStripe(() => (down ? 503 : null));
    const fin = await finalizeInvoice(db, owner(), '2026-10', { fetchImpl: s.fetchImpl, now: T });
    expect(fin).toMatchObject({ status: 'final', delivery: 'pending', deliveryAttempts: 1, deliveryError: 'Stripe says 503' });
    expect(fin.nextDeliveryAt!.getTime()).toBe(hours(DELIVERY_BACKOFF_HOURS[0]!).getTime());
    expect((await db.select().from(auditLog).where(eq(auditLog.action, 'invoice.finalized'))).length).toBe(1);
    const notes = await db.select().from(notifications).where(eq(notifications.orgId, orgId));
    expect(notes.some((n) => /will retry/.test(n.title))).toBe(true);

    // Not due yet: nothing is tried.
    expect(await deliverInvoices(db, { fetchImpl: s.fetchImpl, now: hours(0.5) })).toEqual([]);
    down = false;
    await deliverInvoices(db, { fetchImpl: s.fetchImpl, now: hours(1) });
    expect(await oct()).toMatchObject({ status: 'final', delivery: 'sent', stripeInvoiceId: 'in_1' });
    expect(s.created()).toEqual({ cus: 1, in: 1, ii: 2, fin: 1 });
  });

  it('a crash halfway resumes where it stopped: no second Stripe invoice, no duplicate line', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    await approve();
    // Customer, invoice and the first item go through; the second item times out.
    const s = fakeStripe((path) => (path === 'invoiceitems' && s.calls.filter((c) => c.path === 'invoiceitems').length === 1 ? 'network' : null));
    await finalizeInvoice(db, owner(), '2026-10', { fetchImpl: s.fetchImpl, now: T });
    expect((await oct()).deliveryProgress).toMatchObject({ customer: 'cus_1', invoice: 'in_1', items: { 0: 'ii_1' } });
    const ok = fakeStripe();
    await deliverInvoices(db, { fetchImpl: ok.fetchImpl, now: hours(1) });
    // The retry only adds the missing line and finalizes.
    expect(ok.calls.map((c) => c.path)).toEqual(['invoiceitems', 'invoices/in_1/finalize']);
    expect(ok.calls[0]!.key).toMatch(/-1$/);
    expect(await oct()).toMatchObject({ delivery: 'sent', stripeInvoiceId: 'in_1' });
  });

  it('a refusal a person must fix stops delivery at once; Retry sends it again', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    await approve();
    const s = fakeStripe((path) => (path === 'customers' ? 400 : null));
    await finalizeInvoice(db, owner(), '2026-10', { fetchImpl: s.fetchImpl, now: T });
    expect(await oct()).toMatchObject({ status: 'final', delivery: 'failed', deliveryError: 'Stripe says 400', nextDeliveryAt: null });
    expect(await deliverInvoices(db, { fetchImpl: s.fetchImpl, now: hours(48) })).toEqual([]);
    await expect(retryDelivery(db, { ...owner(), role: 'admin' }, '2026-10')).rejects.toThrow(/Only an owner/);
    const ok = fakeStripe();
    const row = await retryDelivery(db, owner(), '2026-10', { fetchImpl: ok.fetchImpl, now: hours(48) });
    expect(row).toMatchObject({ delivery: 'sent', stripeInvoiceId: 'in_1' });
  });

  it('gives up after the last backoff step and says so', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    await approve();
    const s = fakeStripe(() => 500);
    await finalizeInvoice(db, owner(), '2026-10', { fetchImpl: s.fetchImpl, now: T });
    let at = T;
    for (let i = 0; i < DELIVERY_BACKOFF_HOURS.length; i++) {
      at = (await oct()).nextDeliveryAt!;
      await deliverInvoices(db, { fetchImpl: s.fetchImpl, now: at });
    }
    expect(await oct()).toMatchObject({ delivery: 'failed', deliveryAttempts: DELIVERY_BACKOFF_HOURS.length + 1 });
    const notes = await db.select().from(notifications).where(eq(notifications.orgId, orgId));
    expect(notes.some((n) => /delivery stopped/.test(n.title))).toBe(true);
  });

  it('two deliveries racing make one Stripe invoice', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    await approve();
    const down = fakeStripe(() => 503);
    await finalizeInvoice(db, owner(), '2026-10', { fetchImpl: down.fetchImpl, now: T });
    const s = fakeStripe();
    await Promise.all([deliverInvoices(db, { fetchImpl: s.fetchImpl, now: hours(2) }), deliverInvoices(db, { fetchImpl: s.fetchImpl, now: hours(2) })]);
    expect(s.created()).toEqual({ cus: 1, in: 1, ii: 2, fin: 1 });
    expect(await oct()).toMatchObject({ delivery: 'sent' });
  });

  it('without Stripe, a final invoice is simply final', async () => {
    await approve();
    expect(await finalizeInvoice(db, owner(), '2026-10')).toMatchObject({ status: 'final', delivery: 'none' });
  });

  it('the monthly job drafts real groups, never the sample', async () => {
    expect(await runBilling(db, orgId, '2026-10')).toMatchObject({ period: '2026-10' });
    await db.insert(users).values({ id: 'u9', name: 'S', email: 's@example.com' });
    const sample = await createSampleOrg(db, { ownerId: 'u9' });
    expect(await runBilling(db, sample.id, '2026-10')).toEqual({ skipped: 'sample group' });
    expect((await db.select().from(invoices)).length).toBe(1);
  });
});

describe('the ledger spans', () => {
  it('day, week and month are the same accrual over different spans', async () => {
    const { bookedBetween, utcDay } = await import('../lib/data/billing.js');
    const win = w({ bookedCents: 700, closedAt: '2026-10-01T12:00:00Z' });
    const d = (s: string) => utcDay(s);
    expect(bookedBetween(win, d('2026-10-01'), d('2026-10-03'))).toEqual({ days: 1, cents: 100 }); // accrues from Oct 2
    expect(bookedBetween(win, d('2026-10-01'), d('2026-11-01')).cents).toBe(3000);
    expect(bookedBetween(w({ status: 'reversed', bookedCents: 0, bookedCentsBeforeReversal: 700, closedAt: '2026-10-01T12:00:00Z', reversedAt: '2026-10-11T00:00:00Z' }), d('2026-10-01'), d('2026-11-01')).cents).toBe(900);
  });
});
