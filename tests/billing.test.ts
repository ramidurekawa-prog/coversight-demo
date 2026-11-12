import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { accrual, buildInvoice, previousPeriod } from '../lib/data/billing.js';
import { draftInvoice, finalizeInvoice, listInvoices, runBilling } from '../server/billing';
import { saveAction } from '../server/actions';
import type { Db } from '../server/db/client';
import { invoices, orgs, testWindows, users } from '../server/db/schema';
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

  it('pushes a final invoice to Stripe when configured, once per customer', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    await saveAction(db, owner(), { roomId: '', key: 'billing', value: { status: 'approved' } });
    const calls: string[] = [];
    const fake = (async (url: string) => {
      const path = url.replace('https://api.stripe.com/v1/', '');
      calls.push(path);
      const body = path === 'customers' ? { id: 'cus_1' } : path === 'invoices' ? { id: 'in_1' } : path.endsWith('/finalize') ? { id: 'in_1', hosted_invoice_url: 'https://pay.stripe.com/i/1' } : { id: 'ii' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const fin = await finalizeInvoice(db, owner(), '2026-10', { fetchImpl: fake });
    expect(calls).toEqual(['customers', 'invoiceitems', 'invoiceitems', 'invoices', 'invoices/in_1/finalize']);
    expect(fin.stripeInvoiceId).toBe('in_1');
    expect(fin.stripeUrl).toBe('https://pay.stripe.com/i/1');
    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
    expect((org!.meta as { stripeCustomerId: string }).stripeCustomerId).toBe('cus_1');
  });

  it('the monthly job drafts real groups, never the sample', async () => {
    expect(await runBilling(db, orgId, '2026-10')).toMatchObject({ period: '2026-10' });
    await db.insert(users).values({ id: 'u9', name: 'S', email: 's@example.com' });
    const sample = await createSampleOrg(db, { ownerId: 'u9' });
    expect(await runBilling(db, sample.id, '2026-10')).toEqual({ skipped: 'sample group' });
    expect((await db.select().from(invoices)).length).toBe(1);
  });
});
