/* eslint-disable @typescript-eslint/no-explicit-any */
// The food cost loop on invoices: price creep, smaller packs and unit
// mix-ups found on invoice lines; the ask approved and tracked; the next
// invoice confirming it. Nothing here is booked as verified savings.
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { validate } from '../lib/data/ingest.js';
import { foodCostChecks, vendorAsk, vendorCheck, vendorExpect } from '../lib/data/page/purchasing.js';
import { SEED } from '../lib/data/seed.js';
import { expectFor } from '../lib/data/writebacks.js';
import type { Db } from '../server/db/client';
import { tasks, users } from '../server/db/schema';
import { commitInput, createSampleOrg } from '../server/org';
import { createTask, verifyTasks } from '../server/tasks';
import { freshDb } from './helpers/db';

const room = (id: string, rows?: unknown[]): any => (rows ? applyInputs(SEED, { [id]: { invoices: { rows: validate('invoices', rows, (SEED as any).rooms[id]).rows } } }) : SEED).rooms[id];

describe('the checks', () => {
  it('finds price creep against the earlier price, biggest first, with the dollars over 28 days', () => {
    const c = foodCostChecks(room('oakland'));
    expect(c[0]).toMatchObject({ kind: 'price', item: 'Salmon fillet', before: 11.4, now: 13.65, approvalId: 'vendor:salmon-fillet:price:11.40' });
    expect(c[0].cents).toBe(Math.round((13.65 - 11.4) * 388 * 100));
    expect(c.every((x: any, i: number) => i === 0 || (c[i - 1].cents ?? -1) >= (x.cents ?? -1))).toBe(true);
    // A line that didn't move, or fell, is never a leak.
    expect(c.some((x: any) => x.item === 'Arborio rice' || x.item === 'Heirloom tomatoes')).toBe(false);
  });

  it('finds a case that shrank even though its price fell', () => {
    const eggs: any = foodCostChecks(room('berkeley')).find((x: any) => x.item === 'Eggs, large');
    expect(eggs).toMatchObject({ kind: 'pack', pack0: 15, pack1: 12, approvalId: 'vendor:eggs-large:pack:15' });
    expect(eggs.now).toBeGreaterThan(eggs.before);
    expect(eggs.cents).toBeGreaterThan(0);
    expect(vendorAsk(eggs, { room: 'Rosewood Berkeley' })!.body).toMatch(/12 dozen per case/);
  });

  it('reads a 3× jump as a unit mix-up and claims no dollars on it', () => {
    const r = room('oakland', [{ item: 'Butter, unsalted', unit: 'lb', unit_price: 72, price_before: 4.35, qty: 12 }]);
    const c = foodCostChecks(r).find((x: any) => x.item === 'Butter, unsalted')!;
    expect(c).toMatchObject({ kind: 'unit', cents: null, approvalId: null });
  });

  it('never takes a room’s earlier price from the sample: no price before entered, no creep claimed', () => {
    const r = room('oakland', [{ item: 'Salmon fillet', unit: 'lb', unit_price: 13.65, qty: 388 }]);
    expect(foodCostChecks(r).some((x: any) => x.item === 'Salmon fillet')).toBe(false);
    const withBefore = room('oakland', [{ item: 'Salmon fillet', unit: 'lb', unit_price: 13.65, price_before: 12, qty: 388 }]);
    expect(foodCostChecks(withBefore).find((x: any) => x.item === 'Salmon fillet')!.before).toBe(12);
    // The order guide's price wins over the earlier one.
    const agreed = room('oakland', [{ item: 'Salmon fillet', unit: 'lb', unit_price: 13.65, price_before: 13.65, agreed_price: 12.5, qty: 388 }]);
    expect(foodCostChecks(agreed).find((x: any) => x.item === 'Salmon fillet')).toMatchObject({ before: 12.5, vs: 'the price on your order guide' });
  });

  it('confirms an ask only from the room’s own later invoice', () => {
    const e = vendorExpect('vendor:salmon-fillet:price:11.40');
    expect(expectFor('vendor:salmon-fillet:price:11.40')).toEqual(e);
    expect(vendorCheck(e, room('oakland'))).toBeNull(); // the sample's line is not the room's invoice
    expect(vendorCheck(e, room('oakland', [{ item: 'Salmon fillet', unit: 'lb', unit_price: 13.65, qty: 388 }]))!.ok).toBe(false);
    expect(vendorCheck(e, room('oakland', [{ item: 'Salmon fillet', unit: 'lb', unit_price: 11.45, qty: 390 }]))!.ok).toBe(true);
    const p = vendorExpect('vendor:eggs-large:pack:15');
    expect(vendorCheck(p, room('berkeley', [{ item: 'Eggs, large', unit: 'case', unit_price: 50, qty: 9, pack: 15 }]))!.ok).toBe(true);
  });
});

describe('the loop on the server', () => {
  let db: Db;
  let orgId: string;
  const v = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
  beforeEach(async () => {
    db = await freshDb();
    await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
    orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
  });

  it('approves only an ask the invoices show, with the server’s own title and email, then confirms it on the next invoice', async () => {
    await expect(createTask(db, v(), { roomId: 'oakland', approvalId: 'vendor:salmon-fillet:price:9.00', title: 'x', system: 'y', diff: [] })).rejects.toThrow(/changed since it was shown/);
    // The room enters its own invoice: salmon up from $11.40.
    await commitInput(db, { ...v(), roomId: 'oakland', kind: 'invoices', rows: [{ item: 'Salmon fillet', vendor: 'Bay Fish Co.', unit: 'lb', unit_price: 13.65, price_before: 11.4, qty: 388 }] });
    const t = await createTask(db, v(), { roomId: 'oakland', approvalId: 'vendor:salmon-fillet:price:11.40', title: 'ignored', system: 'ignored', diff: [] });
    expect(t.title).toBe('Salmon fillet: 20% more from Bay Fish Co.');
    expect(t.system).toBe('Your vendor');
    expect((t.evidence as any).email.subject).toMatch(/Salmon fillet/);
    expect((t.expect as any)).toMatchObject({ type: 'vendor', kind: 'price', price: 11.4 });
    // Same invoice again: nothing confirmed.
    await verifyTasks(db, orgId);
    expect((await db.select().from(tasks).where(eq(tasks.id, t.id)))[0]!.status).toBe('open');
    // The next invoice is back at $11.40: confirmed from the invoice, with the money back Observed.
    await commitInput(db, { ...v(), roomId: 'oakland', kind: 'invoices', rows: [{ item: 'Salmon fillet', vendor: 'Bay Fish Co.', unit: 'lb', unit_price: 11.4, price_before: 13.65, qty: 400 }] });
    await verifyTasks(db, orgId);
    const [row] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(row!.status).toBe('verified');
    expect(row!.outcome).toMatchObject({ result: 'fixed', claim: 'obs', backCents: Math.round((13.65 - 11.4) * 400 * 100) });
  });
});
