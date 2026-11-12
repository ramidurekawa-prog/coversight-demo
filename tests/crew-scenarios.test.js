// The crew, graded on the situations it has to get right. Each scenario runs
// whole cycles in memory and checks what each agent did (or didn't do).
import { describe, expect, it } from 'vitest';

import { answer } from '../lib/agents/copilot.js';
import { CREW } from '../lib/agents/crew.js';
import { runCycle } from '../lib/agents/cycle.js';
import { memoryStore } from '../lib/agents/memory-store.js';
import { authorize, NEVER } from '../lib/agents/policy.js';
import { applyInputs } from '../lib/data/apply.js';
import { LEVER_METRIC, weeklySeries } from '../lib/data/readers.js';
import { SEED } from '../lib/data/seed.js';

const TODAY = '2026-10-28';
const fresh = () => applyInputs(SEED, {});
const run = async (store, trigger = 'manual') => runCycle({ store, trigger });
const open = (store, kind) => store.state.proposals.filter((p) => p.status === 'open' && (!kind || p.kind === kind));
const events = (r, type, roomId) => r.log.filter((e) => e.type === type && (!roomId || e.roomId === roomId));
const win = (o) => ({ id: o.id ?? `w-${Math.random()}`, roomId: 'oakland', lever: 'labour', dish: null, status: 'running', startedAt: '2026-09-27', day: 28, bookedCents: 0, method: 'before_after', title: 'A test', baseline: 0, direction: 'down', centsPerUnitWeek: 100, guard: { avgCheckBase: 38, turnBase: 60 }, closedAt: null, reversedAt: null, ...o });

describe('policy', () => {
  it('every one of the eleven never-rules refuses for every agent, whatever its level', () => {
    for (const a of CREW) for (const n of NEVER) for (const e of n.effects) expect(authorize(a, { type: e }, { orgId: 'o' }).ok, `${a.id} ${e}`).toBe(false);
  });
  it('jobs belong to one agent each; autonomy only ever goes down', () => {
    const g = CREW.find((a) => a.id === 'guardrail');
    expect(authorize(g, { type: 'autonomy.lower', from: 2, to: 1 }, {}).ok).toBe(true);
    expect(authorize(g, { type: 'autonomy.lower', from: 1, to: 3 }, {}).ok).toBe(false);
    expect(authorize(CREW.find((a) => a.id === 'detection'), { type: 'job.sync' }, {}).ok).toBe(false);
    expect(authorize(CREW.find((a) => a.id === 'dataQuality'), { type: 'propose' }, {}).ok).toBe(false);
    expect(authorize(CREW.find((a) => a.id === 'verification'), { type: 'notify' }, {}).ok).toBe(false);
  });
});

describe('scenarios', () => {
  it('S1 a normal morning: every agent does its job, nothing refused, three briefs', async () => {
    const s = memoryStore({ ds: fresh(), today: TODAY });
    const r = await run(s);
    expect(r).toMatchObject({ refused: 0, errors: 0 });
    const ran = new Set(s.state.runs.map((x) => x.agent));
    for (const a of CREW.filter((x) => !x.on.includes('question'))) expect(ran.has(a.id), a.id).toBe(true);
    expect(events(r, 'data.ok')).toHaveLength(3);
    expect(open(s, 'ranking')).toHaveLength(3);
    expect(s.state.notifications.filter((n) => /morning brief/.test(n.title))).toHaveLength(3);
  });

  it('S2 nothing new for weeks (real group): no findings on stale data, one to-do per room, the brief says so', async () => {
    const s = memoryStore({ ds: fresh(), today: '2026-12-01', sample: false });
    const r = await run(s);
    expect(events(r, 'data.ok')).toHaveLength(0);
    expect(events(r, 'findings.updated')).toHaveLength(0);
    expect(open(s, 'todo').filter((p) => /todo:data:.*:stale/.test(p.key))).toHaveLength(3);
    expect(s.state.notifications[0].body).toMatch(/No new week of data/);
  });

  it('S3 → S4 the Toast sync fails for one room, then recovers: that room waits, the others carry on, the to-do closes', async () => {
    const conn = { state: 'failing', lastError: 'Toast rejected the client ID or secret.', syncedAt: '2026-10-28T03:00:00Z', rooms: {}, restaurants: ['oakland'] };
    const s = memoryStore({ ds: fresh(), today: TODAY, conn });
    const r = await run(s);
    expect(events(r, 'data.ok').map((e) => e.roomId).sort()).toEqual(['berkeley', 'walnut']);
    const todo = open(s, 'todo').find((p) => p.key === 'todo:data:oakland:sync');
    expect(todo.payload).toMatchObject({ assignee: 'owner', link: '/connect' });
    Object.assign(conn, { state: 'live', lastError: null });
    const r2 = await run(s);
    expect(events(r2, 'data.ok').map((e) => e.roomId)).toContain('oakland');
    expect(s.state.proposals.find((p) => p.key === 'todo:data:oakland:sync').status).toBe('resolved');
  });

  it('S5 a week that doesn’t look real holds that room back instead of acting on it', async () => {
    const ds = fresh();
    const h = [...ds.rooms.oakland.history]; // a copy: the seed's arrays are shared
    h[h.length - 1] = { ...h[h.length - 1], net: h[h.length - 1].net * 0.3 };
    ds.rooms = { ...ds.rooms, oakland: { ...ds.rooms.oakland, history: h } };
    const s = memoryStore({ ds, today: TODAY });
    const r = await run(s);
    expect(events(r, 'data.issue', 'oakland').some((e) => e.payload.code === 'anomaly')).toBe(true);
    expect(events(r, 'findings.updated', 'oakland')).toHaveLength(0);
  });

  it('S6 a tighter price fence: the ribeye move is blocked before it costs manager time, with a to-do to the fence', async () => {
    const s = memoryStore({ ds: fresh(), today: TODAY, fences: { oakland: { maxPrice: 3 } } });
    await run(s);
    const rank = open(s, 'ranking').find((p) => p.roomId === 'oakland').payload;
    const rib = rank.items.find((x) => x.id === 'ribeye');
    expect(rib.chosen).toBe(false);
    expect(rib.blocked).toMatch(/3% price fence/);
    expect(open(s, 'plan').some((p) => p.key === 'plan:oakland:ribeye')).toBe(false);
    expect(open(s, 'todo').find((p) => p.key === 'todo:blocked:oakland:ribeye').payload.link).toBe('/fences');
    // The manager time it would have used goes to the next item.
    expect(rank.items.filter((x) => x.chosen).length).toBeGreaterThanOrEqual(2);
  });

  it('S7–S8 what’s being tested or was dismissed isn’t proposed again', async () => {
    const s = memoryStore({ ds: fresh(), today: TODAY, windows: [win({ lever: 'menu_margin', dish: 'ribeye', status: 'running' })], dismissed: { oakland: { vendor: '2026-12-31' } } });
    await run(s);
    const ids = open(s, 'ranking').find((p) => p.roomId === 'oakland').payload.items.map((x) => x.id);
    expect(ids).not.toContain('ribeye');
    expect(ids).not.toContain('vendor');
  });

  it('S9 a guardrail breach drops that dial to A1 and says why; a second cycle doesn’t repeat it', async () => {
    const windows = [];
    const s = memoryStore({ ds: fresh(), today: TODAY, windows });
    await run(s);
    windows.push(win({ status: 'reversed', reversedAt: new Date(Date.now() + 1000).toISOString(), title: 'Trim Tuesday dinner' }));
    const r = await run(s);
    expect(s.state.autonomy.oakland.Labour).toBe(1);
    expect(events(r, 'guardrail.breach')).toHaveLength(1);
    expect(s.state.notifications.some((n) => /Guardrail broke/.test(n.title) && /A2 to A1/.test(n.body))).toBe(true);
    windows[0].reversedAt = '2026-01-01T00:00:00Z';
    const r3 = await run(s);
    expect(events(r3, 'guardrail.breach')).toHaveLength(0);
  });

  it('S10 a verified change that’s wearing off is caught and handed to a person', async () => {
    const ds = fresh();
    const series = weeklySeries(ds.rooms.walnut, LEVER_METRIC.void_comp.metric);
    const start = series[series.length - 8].weekEnd;
    const recent = series.slice(-3).map((p) => p.value);
    const baseline = recent.reduce((a, b) => a + b, 0) / 3 + 10; // only ~$10/wk better than baseline now
    const s = memoryStore({ ds, today: TODAY, windows: [win({ id: 'w-comps', roomId: 'walnut', lever: 'void_comp', status: 'verified', startedAt: start, baseline, bookedCents: 9000, centsPerUnitWeek: 100, title: 'Comp policy' })] });
    const r = await run(s);
    expect(events(r, 'persistence.drift', 'walnut')).toHaveLength(1);
    expect(open(s, 'todo').some((p) => p.key === 'todo:drift:w-comps')).toBe(true);
  });

  it('S11 a verdict reaches the ledger (proposed, never confirmed) and the sister rooms', async () => {
    const windows = [];
    const s = memoryStore({ ds: fresh(), today: TODAY, windows });
    await run(s);
    windows.push(win({ roomId: 'walnut', lever: 'void_comp', status: 'verified', closedAt: new Date(Date.now() + 1000).toISOString(), bookedCents: 9100, title: 'Comp policy' }));
    const r = await run(s);
    expect(events(r, 'verdict', 'walnut')).toHaveLength(1);
    expect(open(s, 'mapping').map((p) => p.key)).toContain('mapping:walnut:Controls');
    expect(s.state.proposals.every((p) => p.kind !== 'mapping' || p.status === 'open')).toBe(true);
    expect(open(s, 'replicate').length).toBeGreaterThan(0);
  });

  it('S12 an approved change nobody made is chased; one the data contradicts is flagged', async () => {
    const tasks = [
      { id: 't1', roomId: 'oakland', approvalId: 'price:ribeye:44', title: 'Raise the ribeye', status: 'open', createdAt: '2026-10-10T12:00:00Z', updatedAt: '2026-10-10T12:00:00Z' },
      { id: 't2', roomId: 'berkeley', approvalId: 'agent:x', title: 'Trim lunch', status: 'mismatch', createdAt: '2026-10-20T12:00:00Z', updatedAt: '2026-10-27T12:00:00Z' },
    ];
    const s = memoryStore({ ds: fresh(), today: TODAY, tasks });
    await run(s);
    expect(open(s, 'todo').find((p) => p.key === 'todo:evidence:t1').body).toMatch(/18 days ago/);
    expect(open(s, 'todo').find((p) => p.key === 'todo:evidence:t2').title).toMatch(/doesn’t show/);
  });

  it('S13 a second cycle on the same data changes nothing and briefs nobody twice', async () => {
    const s = memoryStore({ ds: fresh(), today: TODAY });
    await run(s);
    const r2 = await run(s);
    expect(r2.proposals).toBe(0);
  });

  it('S14 the sample group isn’t asked to approve invoices it will never get', async () => {
    const s = memoryStore({ ds: fresh(), today: '2026-11-02', sample: true });
    await run(s);
    expect(open(s, 'todo').some((p) => p.key.startsWith('todo:package:'))).toBe(false);
    const real = memoryStore({ ds: fresh(), today: '2026-11-02', sample: false });
    await run(real, 'schedule');
    expect(open(real, 'todo').some((p) => p.key === 'todo:package:2026-10')).toBe(true);
  });

  it('S15 the copilot doesn’t recommend what’s already in a test, and explains a waiting test', async () => {
    const windows = [];
    const s = memoryStore({ ds: fresh(), today: TODAY, windows });
    await run(s);
    windows.push(win({ lever: 'menu_margin', dish: 'ribeye', status: 'waiting', day: 14, title: 'Menu margin: Ribeye' }));
    const f = await s.facts();
    expect(answer('operator', 'What should Oakland do first?', f).text).not.toMatch(/ribeye/i);
    expect(answer('operator', 'why is the ribeye test stuck?', f).text).toMatch(/waiting for the next week of data.*day 14/s);
  });
});

describe('the cycle itself', () => {
  it('a cycle that fails still closes, so the next run isn’t blocked', async () => {
    const s = memoryStore({ ds: applyInputs(SEED, {}), today: TODAY });
    s.facts = async () => { throw new Error('no data yet'); };
    await expect(runCycle({ store: s, trigger: 'manual' })).rejects.toThrow('no data yet');
    expect(s.state.cycles[0]).toMatchObject({ finishedAt: expect.any(String), summary: { error: 'no data yet' } });
  });
  it('one agent throwing doesn’t stop the others', async () => {
    const s = memoryStore({ ds: applyInputs(SEED, {}), today: TODAY });
    const broken = CREW.map((a) => (a.id === 'detection' ? { ...a, run: () => { throw new Error('boom'); } } : a));
    const r = await runCycle({ store: s, crew: broken, trigger: 'manual' });
    expect(r.errors).toBe(3);
    expect(s.state.notifications.filter((n) => /morning brief/.test(n.title))).toHaveLength(3);
  });
});
