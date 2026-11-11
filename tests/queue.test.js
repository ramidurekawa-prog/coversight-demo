import { describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { deriveRoom } from '../lib/data/model.js';
import { buildOwnQueue } from '../lib/data/queue.js';
import { dataEnd } from '../lib/data/readers.js';
import { SEED } from '../lib/data/seed.js';
import { readToastExports } from '../lib/data/toast.js';
import { toastFixture } from './helpers/toast-fixture.js';

const { unknown, ...summary } = readToastExports(Object.entries(toastFixture()).map(([name, text]) => ({ name, text })));
const ds = applyInputs(SEED, { oakland: { toast: { rows: [summary] } } });
const d = deriveRoom(ds, 'oakland');

describe('today’s queue on a room’s own data', () => {
  it('fresh data: costs to enter, the best findings, and a lever to test', () => {
    const q = buildOwnQueue(d, { today: '2026-10-27', dataEnd: dataEnd(d.room) });
    const est = d.room.menu.filter((m) => m.costEstimated).length;
    expect(est).toBeGreaterThan(0);
    expect(q[0].id).toBe(`costs:${est}`); // dishes with no sample match carry an estimated cost
    expect(q[0].go).toBe('inputs');
    expect(q.filter((c) => c.id.startsWith('find:')).length).toBeLessThanOrEqual(3);
    const test = q.find((c) => c.start);
    expect(test).toBeTruthy();
    expect(q.every((c) => c.title && c.primary && c.mins > 0)).toBe(true);
  });

  it('stale data comes first; a lever under test and dismissed findings drop out', () => {
    const q = buildOwnQueue(d, { today: '2026-11-10', dataEnd: '2026-10-24' });
    expect(q[0].id).toBe('stale:2026-10-24');
    expect(q[0].body).toMatch(/17 days ago/);
    const lever = q.find((c) => c.start).start;
    const find = q.find((c) => c.id.startsWith('find:'));
    const q2 = buildOwnQueue(d, { today: '2026-11-10', dataEnd: '2026-10-24', testing: [lever], dismissed: find ? { [find.id.slice(5)]: '2027-01-01T00:00:00Z' } : {} });
    expect(q2.find((c) => c.start)?.start).not.toBe(lever);
    if (find) expect(q2.some((c) => c.id === find.id)).toBe(false);
  });
});

describe('tonight’s staffing plan from own data', () => {
  it('Mondays run 3 servers for light covers: cut one from the first hour that stays spare to close', async () => {
    const { tonightPlan } = await import('../components/screens/week.jsx');
    const mon = tonightPlan(d.room, 'Mon');
    expect(mon.hours.length).toBeGreaterThan(3);
    expect(mon.hours.every((h) => h.weeks === 4)).toBe(true);
    expect(mon.cutFrom).not.toBeNull();
    const fri = tonightPlan(d.room, 'Fri');
    expect(fri.hours.find((h) => h.hour === 19).servers).toBe(4);
    expect(tonightPlan({ levers: {} }, 'Mon')).toBeNull();
  });
});
