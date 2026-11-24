import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { validate } from '../lib/data/ingest.js';
import { saveAction } from '../server/actions';
import type { Db } from '../server/db/client';
import { auditLog, inputs, tasks, users } from '../server/db/schema';
import { commitInput, createSampleOrg, loadInputs } from '../server/org';
import { commitChecked } from '../server/page/inputs';
import { clearServiceCache } from '../server/page/service';
import { loadStaffing, refuseShift } from '../server/page/staffing';
import { actOnToday, loadToday } from '../server/page/today';
import { createTask } from '../server/tasks';
import { freshDb } from './helpers/db';

/* The customer-feedback checks that need the server: who can approve, a
 * retry that saves once, a failed save that leaves the data in use, a
 * picked time and a guest change re-checked here. Rosewood Oakland, Tuesday
 * Nov 24, noon Pacific, run by hand. */
let db: Db;
let orgId: string;
type V = { orgId: string; userId: string; role: 'owner' | 'admin' | 'gm' | 'floor'; rooms: string[] | null };
const owner = (): V => ({ orgId, userId: 'u1', role: 'owner', rooms: null });
const gm = (): V => ({ orgId, userId: 'u2', role: 'gm', rooms: ['oakland'] });
const floor = (): V => ({ orgId, userId: 'u3', role: 'floor', rooms: ['oakland'] });
const NOW = new Date('2026-11-24T20:00:00Z');
const TUE = '2026-11-24';
const CARD = `staff:${TUE}:dinner`;
const ID = 'shift:2026-11-24:dinner:start:server-diana-1630:1700';

const add = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const HOURS = [[16, 6, 3], [17, 20, 4], [18, 36, 4], [19, 40, 4], [20, 24, 4], [21, 12, 4]];
const SERVICES = Array.from({ length: 21 }, (_, i) => add(TUE, -(i + 1))).flatMap((d) => HOURS.map(([h, covers, servers]) => ({ date: d, hour: `${h}:00`, covers, servers })));
const sh = (name: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ date: TUE, role: 'Server', name, start, end, rate: 24, ...extra });
const SHIFTS = [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Carlos', '16:00', '22:00'), sh('Diana', '16:30', '22:00')];
const rowsOf = (kind: string, r: unknown[]) => validate(kind, r).rows;
const commit = (kind: string, r: unknown[]) => commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind, rows: rowsOf(kind, r) });
const approve = (v: V = owner(), approvalId = ID) =>
  createTask(db, v, { roomId: 'oakland', approvalId, title: 'Whatever the browser says', system: 'Somewhere', diff: [] }, { now: NOW });

beforeEach(async () => {
  db = await freshDb();
  clearServiceCache();
  await db.insert(users).values([{ id: 'u1', name: 'Maria', email: 'o@example.com' }, { id: 'u2', name: 'Marcus', email: 'g@example.com' }, { id: 'u3', name: 'Fay', email: 'f@example.com' }]);
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
  await commit('services', SERVICES);
  await commit('shifts', SHIFTS);
});

describe('Check 3: an action waiting on another manager shows who has it; the server decides who can approve', () => {
  it('a floor manager asks the GM, the card says it is with the GM and not seen yet, and only an approver can approve', async () => {
    const t = await actOnToday(db, floor(), { roomId: 'oakland', op: 'assign', cardId: CARD, to: 'gm' }, NOW) as Record<string, any>;
    expect(t.state.assigned[CARD]).toMatchObject({ to: 'gm', from: 'user:u3' });
    expect(t.state.assigned[CARD].ack).toBeUndefined();
    expect(t.cards.find((c: { id: string }) => c.id === CARD).state).toBe('assigned');
    await expect(approve(floor())).rejects.toThrow(/floor manager/i);
    const task = await approve(gm());
    expect(task).toMatchObject({ approvalId: ID, status: 'open' });
    const t2 = await loadToday(db, gm(), 'oakland', NOW) as Record<string, any>;
    expect(t2.cards.find((c: { id: string }) => c.id === CARD).state).toBe('approved');
  });
});

describe('Check 4 and 6: a retry saves once; a failed save leaves the saved data in use', () => {
  const body = (rows: unknown[], attempt?: string) => ({ roomId: 'oakland', kind: 'shifts', rows, opts: {}, provenance: { source: 'paste' }, ...(attempt ? { attempt } : {}) });
  const entries = async () => db.select({ id: inputs.id }).from(inputs).where(and(eq(inputs.orgId, orgId), eq(inputs.roomId, 'oakland'), eq(inputs.kind, 'shifts'), eq(inputs.undone, false)));

  it('the same attempt sent twice, one after the other or both at once, is stored once', async () => {
    const next = rowsOf('shifts', [...SHIFTS, sh('Eve', '17:00', '22:00')]);
    const before = (await entries()).length;
    const [a, b] = await Promise.all([commitChecked(db, owner(), body(next, 'att-retry-0001')), commitChecked(db, owner(), body(next, 'att-retry-0001'))]);
    expect(a.id).toBe(b.id);
    const again = await commitChecked(db, owner(), body(next, 'att-retry-0001'));
    expect(again).toMatchObject({ id: a.id, replayed: true });
    expect((await entries()).length).toBe(before + 1);
  });

  it('a refused save is on the record with its reason, and the schedule saved before is still the one in use', async () => {
    const good = (await loadInputs(db, orgId)).inputs.oakland!.shifts as { rows: unknown[] };
    const bad = [{ date: TUE, role: 'Server', name: 'Eve', start: '25:00', end: '22:00' }];
    await expect(commitChecked(db, owner(), body(bad, 'att-bad-00001'))).rejects.toThrow(/Not saved/);
    const failed = await db.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, 'inputs.failed')));
    expect(failed).toHaveLength(1);
    expect(failed[0]!.detail).toMatchObject({ roomId: 'oakland', kind: 'shifts', attempt: 'att-bad-00001', rows: 1 });
    const after = (await loadInputs(db, orgId)).inputs.oakland!.shifts as { rows: unknown[] };
    expect(after.rows).toEqual(good.rows);
  });
});

describe('The server works the call out the same way: a picked time and a guest change', () => {
  it('a nearer time from the call’s own options is approved; any other time is refused', async () => {
    await commit('shifts', [...SHIFTS.filter((s) => s.name !== 'Diana'), sh('Diana', '16:00', '22:00'), sh('Eve', '16:00', '22:00')]);
    const s = await loadStaffing(db, owner(), { roomId: 'oakland', date: TUE, meal: 'dinner' }, { now: NOW, covercast: false }) as Record<string, any>;
    expect(s.dinner.title).toBe('Start Ana at 8 pm, not 4 pm');
    const seven = s.dinner.options.find((o: { label: string }) => o.label === '7 pm');
    await expect(refuseShift(db, owner(), { roomId: 'oakland', approvalId: 'shift:2026-11-24:dinner:start:server-ana-1600:2130' }, { now: NOW, covercast: false })).rejects.toThrow(/numbers moved/);
    const ok = await refuseShift(db, owner(), { roomId: 'oakland', approvalId: seven.approvalId }, { now: NOW, covercast: false });
    expect(ok.title).toBe('Start Ana at 7 pm, not 4 pm');
    expect(ok.evidence).toMatchObject({ edited: { from: '8 pm', to: '7 pm' }, estimate: { cents: 7200 } });
    const t = await createTask(db, owner(), { roomId: 'oakland', approvalId: seven.approvalId, title: 'x', system: 'y', diff: [] }, { now: NOW });
    const [row] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(row!.title).toBe('Start Ana at 7 pm, not 4 pm');
  });

  it('check 7: a GM’s guest change is saved with its reason, the call moves with it, and the forecast it changed is kept', async () => {
    await expect(saveAction(db, floor(), { roomId: 'oakland', key: 'staffing.adjust', value: { list: [{ id: 'a1', date: TUE, meal: 'dinner', hour: 19, guests: 0, reason: 'party', at: NOW.toISOString() }] } })).rejects.toThrow(/0 guests/);
    await saveAction(db, gm(), { roomId: 'oakland', key: 'staffing.adjust', value: { list: [{ id: 'a1', date: TUE, meal: 'dinner', hour: 19, guests: 20, reason: 'party', note: 'Birthday', at: NOW.toISOString(), by: 'Marcus' }] }, summary: '+20 at 7 pm' });
    const s = await loadStaffing(db, owner(), { roomId: 'oakland', date: TUE, meal: 'dinner' }, { now: NOW, covercast: false }) as Record<string, any>;
    expect(s.dinner.forecast).toMatchObject({ covers: 158, original: { covers: 138 } });
    expect(s.dinner.title).toBe('Add 1 server from 7 pm to 8 pm');
    expect(s.dinner.changes[0]).toMatchObject({ kind: 'adjust', what: '+20 guests at 7 pm: Large party (Birthday)', by: 'Marcus' });
    // The old call is now refused: the facts moved.
    await expect(approve(owner(), ID)).rejects.toThrow();
  });
});
