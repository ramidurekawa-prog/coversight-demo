import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { readToastExports } from '../lib/data/toast.js';
import { stepsFor } from '../lib/data/writebacks.js';
import type { Db } from '../server/db/client';
import { actions, auditLog, tasks, testWindows, users } from '../server/db/schema';
import { commitInput, createSampleOrg } from '../server/org';
import { createTask, listTasks, updateTask, verifyTasks } from '../server/tasks';
import { runJob } from '../server/jobs';
import { freshDb } from './helpers/db';
import { toastFixture } from './helpers/toast-fixture.js';

let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});
const load = (opts: Parameters<typeof toastFixture>[0]) => {
  const { unknown, ...s } = readToastExports(Object.entries(toastFixture(opts)).map(([name, text]) => ({ name, text })));
  return commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'toast', rows: [JSON.parse(JSON.stringify(s))] });
};
const priceTask = { roomId: 'oakland', approvalId: 'price:ribeye:44', title: 'Change the ribeye steak from $42.00 to $44.00', system: 'Toast menu', diff: [['Ribeye Steak', '$42.00', '$44.00'], ['Menu reprint', '—', 'Table cards only']] };

describe('guided write-back tasks', () => {
  it('builds the steps on the server from the system and the diff', () => {
    expect(stepsFor('Toast menu', priceTask.diff as [string, string, string][])).toEqual([
      'Open Toast Web → Menus → Menu manager → find the item → Price',
      'Ribeye Steak: change “$42.00” to “$44.00”',
      'Menu reprint: set to “Table cards only”',
      'Save, then Publish so the change reaches the POS',
      'Come back here and tap Done',
    ]);
  });

  it('creates one task per approval, with the check parsed from the id (never the client’s text)', async () => {
    const t = await createTask(db, owner(), { ...priceTask, title: 'anything' });
    expect(t.status).toBe('open');
    expect(t.expect).toEqual({ type: 'price', dish: 'ribeye', price: 44 });
    expect(t.steps).toHaveLength(5);
    const again = await createTask(db, owner(), priceTask);
    expect(again.id).toBe(t.id);
    const manual = await createTask(db, owner(), { roomId: 'oakland', approvalId: 'void-reason', title: 'Require a reason code', system: 'Toast', diff: [['Void after send', 'Server can void', 'Manager PIN + reason code']] });
    expect(manual.expect).toEqual({ type: 'manual' });
    expect((await listTasks(db, orgId)).length).toBe(2);
  });

  it('enforces price limits on the server, whichever screen asked', async () => {
    // The sample's salmon rests on stale recipe costs: refused until they're entered.
    await expect(createTask(db, owner(), { ...priceTask, approvalId: 'price:salmon:30' })).rejects.toThrow(/recipe costs/);
    // Past the default 8% fence.
    await expect(createTask(db, owner(), { ...priceTask, approvalId: 'price:ribeye:48' })).rejects.toThrow(/fence of 8%/);
    // A tighter saved fence applies.
    await db.insert(actions).values({ orgId, roomId: 'oakland', key: 'fences', value: { version: 4, f: { minDinner: 4, minAny: 3, cutBy: '8:30 pm', lockHours: 24, maxPrice: 3, priceGap: 6, maxPar: 15 }, al: {} }, summary: '', userId: 'u1' });
    await expect(createTask(db, owner(), priceTask)).rejects.toThrow(/fence of 3%/);
    await expect(createTask(db, owner(), { ...priceTask, approvalId: 'price:ribeye:43' })).resolves.toMatchObject({ status: 'open' });
    // One move per dish inside the gap.
    await expect(createTask(db, owner(), { ...priceTask, approvalId: 'price:ribeye:42.5' })).rejects.toThrow(/repriced 0 days ago/);
    await expect(createTask(db, owner(), { ...priceTask, approvalId: 'price:nope:5' })).rejects.toThrow(/no dish/);
  });

  it('refuses bad input and other people’s rooms', async () => {
    await expect(createTask(db, owner(), { ...priceTask, approvalId: 'drop table;' })).rejects.toThrow(/invalid task/);
    await expect(createTask(db, owner(), { ...priceTask, roomId: 'paris' })).rejects.toThrow(/no room/);
    await expect(createTask(db, { ...owner(), role: 'gm', rooms: ['berkeley'] }, priceTask)).rejects.toThrow(/not one of yours/);
  });

  it('a price change the Toast data shows is Verified and opens its test window', async () => {
    await load({});
    const t = await createTask(db, owner(), priceTask);
    // Ticked off before the new data: waits.
    let r = await updateTask(db, owner(), t.id, 'done');
    expect(r.status).toBe('done');
    // A week later, guests are paying $44.
    await load({ weeks: 14, end: Date.UTC(2026, 10, 1), priceChange: { dish: 'Ribeye Steak', price: 44, from: Date.UTC(2026, 9, 25) } });
    const res = await verifyTasks(db, orgId);
    expect(res.verified).toEqual([t.id]);
    [r] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(r!.status).toBe('verified');
    expect(r!.note).toMatch(/2026-10-31/);
    const [w] = await db.select().from(testWindows).where(eq(testWindows.orgId, orgId));
    expect(w!.lever).toBe('menu_margin');
    expect(w!.dish).toBe('ribeye');
  });

  it('a week of data after Done that still shows the old price is a Mismatch; nightly detection checks it', async () => {
    await load({});
    const t = await createTask(db, owner(), priceTask);
    await updateTask(db, owner(), t.id, 'done');
    await db.update(tasks).set({ doneAt: new Date('2026-10-25T00:00:00Z') }).where(eq(tasks.id, t.id));
    await load({ weeks: 15, end: Date.UTC(2026, 10, 8) });
    const [run] = await runJob(db, 'detection', { orgId });
    expect((run!.detail as { tasks: { mismatched: string[] } }).tasks.mismatched).toEqual([t.id]);
    const [r] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(r!.status).toBe('mismatch');
    // Fix it in Toast, tick it again.
    expect((await updateTask(db, owner(), t.id, 'done')).status).toBe('done');
  });

  it('manual tasks are done when ticked, reopen and cancel, and every step is audited', async () => {
    const t = await createTask(db, owner(), { roomId: 'walnut', approvalId: 'delivery-markup', title: 'Raise delivery prices 10%', system: 'Toast delivery menus', diff: [['DoorDash prices', 'Dine-in prices', '+10%']] });
    expect((await updateTask(db, owner(), t.id, 'done')).status).toBe('done');
    expect((await verifyTasks(db, orgId)).verified).toEqual([]); // nothing in the data to confirm it
    expect((await updateTask(db, owner(), t.id, 'reopen')).status).toBe('open');
    expect((await updateTask(db, owner(), t.id, 'cancel')).status).toBe('cancelled');
    await expect(updateTask(db, owner(), t.id, 'explode')).rejects.toThrow(/action must be/);
    const audit = (await db.select().from(auditLog).where(eq(auditLog.orgId, orgId))).map((a) => a.action).filter((a) => a.startsWith('task.'));
    expect(audit).toEqual(['task.created', 'task.done', 'task.reopen', 'task.cancel']);
  });
});
