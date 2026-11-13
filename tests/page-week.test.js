import { describe, expect, it } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { deriveGroup, deriveRoom, choosePlan } from '../lib/data/model.js';
import { densify } from '../lib/data/dense.js';
import {
  awaitingData, bankedFromWindows, blockedReason, buildCommit, comparators, decompose, planState, setItemStatus,
  trimReviews, weekDigest, weekOf, weekView, REVIEW_KEEP,
} from '../lib/data/page/week.js';

const NOW = new Date('2026-10-27T12:00:00Z');
const MW = SEED.matchedWeeks;
const view = (id, opts = {}) => weekView(deriveRoom(SEED, id), { matchedWeeks: MW, now: NOW, ...opts });

describe('This week, on the sample', () => {
  const d = deriveRoom(SEED, 'oakland');
  const v = view('oakland');

  it('names the week from the data, and says whether it is complete', () => {
    expect(weekOf(d.hist.rows)).toEqual({ start: '2026-10-19', end: '2026-10-25', label: 'Oct 19 – 25' });
    expect(v.status).toBe('complete');
    expect(v.dataThrough).toBe('2026-10-25');
  });

  it('weekly totals reconcile with Daily, in every room', () => {
    for (const id of Object.keys(SEED.rooms)) {
      const dd = deriveRoom(SEED, id);
      const days = densify(dd.room).days.slice(-7);
      const sum = (k) => days.reduce((t, x) => t + x[k], 0);
      expect(days[0].iso).toBe('2026-10-19');
      expect(Math.round(sum('net'))).toBe(Math.round(dd.week.net));
      expect(Math.round(sum('earned'))).toBe(Math.round(dd.week.earned));
      expect(sum('covers')).toBe(dd.week.covers);
      expect(view(id).contribution.value).toBe(dd.week.earned);
    }
  });

  it('a partial week is labelled partial, never passed off as complete', () => {
    const partial = weekView({ ...d, room: { ...d.room, fromToast: { end: '2026-10-22', weeks: 1, files: [] } } }, { matchedWeeks: MW, now: NOW });
    expect(partial.status).toBe('partial');
    expect(partial.contribution.limitations.join(' ')).toMatch(/isn’t complete/);
  });

  it('comparators read the right weeks', () => {
    const rows = d.hist.rows;
    const list = comparators(rows, { matchedWeeks: MW });
    const by = Object.fromEntries(list.map((c) => [c.id, c]));
    expect(by.last.row.earned).toBe(rows[rows.length - 2].earned);
    expect(by.avg4.row.earned).toBeCloseTo(rows.slice(-5, -1).reduce((t, r) => t + r.earned, 0) / 4, 9);
    expect(by.matched.row.earned).toBeCloseTo(d.hist.matchedMean, 9); // the same baseline as the pinned margin move
    expect(by.prior.available).toBe(false); // 52 weeks of history: no same week last year
    expect(by.budget.available).toBe(false);
    expect(v.comparator.id).toBe('matched');
    expect(v.decomposition.contribution.change).toBeCloseTo(d.hist.marginMove, 6);
    expect(view('oakland', { comparator: 'last' }).decomposition.contribution.change).toBe(rows[rows.length - 1].earned - rows[rows.length - 2].earned);
    expect(view('oakland', { comparator: 'prior' }).comparator.id).toBe('matched'); // unavailable falls back
  });

  it('the decomposition adds up exactly', () => {
    for (const c of ['last', 'avg4', 'matched']) {
      const dec = view('walnut', { comparator: c }).decomposition;
      const parts = dec.lines.filter((l) => l.effect != null).reduce((t, l) => t + l.effect, 0);
      expect(parts).toBeCloseTo(dec.contribution.change, 6);
    }
    expect(decompose({ net: 100, covers: 4, food: 30, labour: 20, earned: 50 }, { net: 80, covers: 4, food: 25, labour: 25, earned: 30 }).lines.find((l) => l.key === 'check').change).toBe(5);
  });

  it('verified amounts agree with Proof and Portfolio, and accrual is kept apart from run-rate', () => {
    const group = deriveGroup(SEED);
    for (const id of Object.keys(SEED.rooms)) {
      const w = view(id);
      expect(w.banked.week).toBe(deriveRoom(SEED, id).banked.week);
      expect(w.banked.week).toBe(group.rows.find((r) => r.id === id).banked);
      expect(w.banked.accrued).toBeLessThanOrEqual(w.banked.week + 1e-9);
    }
  });

  it('a menu move that needs stale recipe costs is blocked and can’t be committed (scenario 2)', () => {
    const salmon = v.plan.proposal.find((p) => p.id === 'salmon');
    expect(salmon.blocked).toMatch(/recipe costs/);
    expect(v.plan.next.id).not.toBe('salmon');
    expect(() => buildCommit(v, { week: v.period.start, items: [{ id: 'salmon', owner: 'Marcus', due: '2026-11-01' }] })).toThrow(/can’t be committed/);
    // With fresh recipe costs entered, it isn't blocked any more.
    const fresh = { ...d, feeds: d.feeds.map((f) => (f.name === 'Recipe costs' ? { ...f, state: 'healthy' } : f)) };
    expect(blockedReason(d.candidates.find((c) => c.id === 'salmon'), fresh)).toBeNull();
  });

  it('chooses the plan the way The plan page does, with the saved hours and set-aside findings', () => {
    const at2 = view('oakland', { hours: 2 });
    const ref = choosePlan(d.candidates, 2);
    expect(at2.plan.chosen.map((c) => c.id)).toEqual(ref.sorted.filter((c) => ref.chosen.has(c.id)).map((c) => c.id));
    const top = at2.plan.chosen[0].id;
    expect(view('oakland', { hours: 2, dismissed: { [top]: '2026-12-01T00:00:00.000Z' } }).plan.chosen.map((c) => c.id)).not.toContain(top);
    expect(view('oakland', { hours: 2, dismissed: { [top]: '2026-10-01T00:00:00.000Z' } }).plan.chosen.map((c) => c.id)).toContain(top);
  });

  it('collects what needs attention, each linked to where it’s handled', () => {
    const ids = v.attention.map((a) => a.id);
    expect(ids.some((i) => i.startsWith('paused:'))).toBe(true);
    expect(ids.some((i) => i.startsWith('data:'))).toBe(true);
    expect(ids.filter((i) => i.startsWith('feed:'))).toHaveLength(d.feeds.filter((f) => f.state === 'stale').length);
    expect(v.attention.every((a) => a.go && a.cta)).toBe(true);
    const late = view('oakland', { tasks: [{ id: 't', roomId: 'oakland', status: 'open', title: 'Publish the ribeye price', createdAt: '2026-10-20T00:00:00Z' }] });
    expect(late.attention.map((a) => a.id)).toContain('tasks:late');
    expect(v.inFlight.map((t) => t.id)).toEqual(d.proofs.filter((p) => p.outcome === 'testing').map((p) => p.id));
  });
});

describe('the committed plan', () => {
  const v = view('oakland');
  const items = [{ id: 'ribeye', owner: 'Marcus Rivera', due: '2026-10-30' }, { id: 'vendor', owner: 'Maria', due: '2026-11-03' }];

  it('is built from the server’s week, not the client’s numbers, and refuses junk', () => {
    const plan = buildCommit(v, { week: v.period.start, items: items.map((i) => ({ ...i, title: 'Free money', value: 1e9 })) });
    expect(plan[0]).toMatchObject({ id: 'ribeye', title: 'Raise the ribeye steak from $42 to $44', owner: 'Marcus Rivera', status: 'planned' });
    expect(plan[0].value).toBe(Math.round(v.plan.ranked.find((c) => c.id === 'ribeye').value));
    expect(() => buildCommit(v, { week: '2026-10-12', items })).toThrow(/another week/);
    expect(() => buildCommit(v, { week: v.period.start, items: [items[0], items[0]] })).toThrow(/twice/); // one action, one claim
    expect(() => buildCommit(v, { week: v.period.start, items: [{ id: 'nope', owner: 'x', due: '2026-10-30' }] })).toThrow(/isn’t one of/);
    expect(() => buildCommit(v, { week: v.period.start, items: [{ ...items[0], owner: ' ' }] })).toThrow(/Name who owns/);
    expect(() => buildCommit(v, { week: v.period.start, items: [{ ...items[0], due: '2027-03-01' }] })).toThrow(/due date/);
    expect(() => buildCommit(v, { week: v.period.start, items: [] })).toThrow(/1 to 5/);
  });

  it('a completed task moves its action along', () => {
    const committed = { week: v.period.start, committedAt: 'x', revision: 1, items: buildCommit(v, { week: v.period.start, items }) };
    const open = planState(v, committed, [{ roomId: 'oakland', approvalId: 'price:ribeye:44', status: 'open', createdAt: '2026-10-26T00:00:00Z' }]);
    expect(open.items.find((i) => i.id === 'ribeye')).toMatchObject({ status: 'doing', progress: 'In Today’s tasks' });
    const done = planState(v, committed, [{ roomId: 'oakland', approvalId: 'price:ribeye:44', status: 'verified', createdAt: '2026-10-26T00:00:00Z' }]);
    expect(done.items.find((i) => i.id === 'ribeye')).toMatchObject({ status: 'done', progress: 'Confirmed in the data' });
    expect(setItemStatus(committed, 'vendor', 'dropped').items.find((i) => i.id === 'vendor').status).toBe('dropped');
    expect(() => setItemStatus(committed, 'vendor', 'finished')).toThrow(/Unknown status/);
  });

  it('fresh data never overwrites an approved plan; it shows up as revisions to review', () => {
    const committed = { week: v.period.start, committedAt: 'x', revision: 1, items: buildCommit(v, { week: v.period.start, items }) };
    // New data: ribeye is no longer proposed (set aside), vendor stays.
    const later = view('oakland', { dismissed: { ribeye: '2027-01-01T00:00:00.000Z' } });
    const st = planState(later, committed);
    expect(st.items.map((i) => i.id)).toEqual(['ribeye', 'vendor']); // still the committed plan
    expect(st.revisions.dropped.map((i) => i.id)).toEqual(['ribeye']);
    // Last week's plan doesn't carry into a new week.
    expect(planState(v, { ...committed, week: '2026-10-12' }).committed).toBeNull();
  });
});

describe('This week, for a real group', () => {
  const ds = { ...SEED, proof: [] };
  const d = deriveRoom(ds, 'oakland');
  const win = (o) => ({ id: o.id, roomId: 'oakland', title: o.title || o.id, status: 'running', day: 0, bookedCents: 0, lowCents: null, pointCents: null, closedAt: null, reversedAt: null, startedAt: '2026-10-05', ...o });
  const real = (windows, opts = {}) => weekView(d, { windows, matchedWeeks: MW, now: NOW, ...opts });

  it('never uses template weeks as a baseline or a contribution', () => {
    const v = real([]);
    expect(v.comparators.every((c) => !c.available)).toBe(true);
    expect(v.decomposition).toBeNull();
    expect(v.contribution.value).toBeNull();
    expect(v.headline).toMatch(/no earlier week/);
    // Own rows count.
    const own = { ...d, hist: { ...d.hist, rows: d.hist.rows.map((r, i) => (i >= d.hist.rows.length - 2 ? { ...r, own: true } : r)) } };
    const w = weekView(own, { windows: [], matchedWeeks: MW, now: NOW });
    expect(w.comparators.filter((c) => c.available).map((c) => c.id)).toEqual(['last']);
  });

  it('banks only verified windows, at their lower bound, and keeps this week’s accrual apart', () => {
    const windows = [
      win({ id: 'a', status: 'verified', bookedCents: 7000, lowCents: 7000, pointCents: 9000, closedAt: '2026-10-21T12:00:00Z' }),
      win({ id: 'b', status: 'running', day: 14 }),
      win({ id: 'c', roomId: 'berkeley', status: 'verified', bookedCents: 5000, closedAt: '2026-10-01T00:00:00Z' }),
    ];
    const v = real(windows);
    expect(v.banked.week).toBe(70);
    expect(v.banked.accrued).toBe(40); // Oct 22 – 25 of the week of Oct 19 – 25
    expect(v.banked.toDate).toBe(60); // Oct 22 through today, Oct 27
    expect(v.banked.newly.map((x) => x.id)).toEqual(['a']);
    expect(v.inFlight).toEqual([expect.objectContaining({ id: 'b', day: 14, progress: 50, next: 'Checkpoint at day 21', review: '2026-11-02' })]);
    expect(v.attention.some((a) => a.id.startsWith('paused:') || a.id.startsWith('alarm:'))).toBe(false);
  });

  it('a reversal stops accruing, shows as suspended and needs attention (scenario 5)', () => {
    const windows = [win({ id: 'r', status: 'reversed', lowCents: 7000, closedAt: '2026-10-13T12:00:00Z', reversedAt: '2026-10-22T08:00:00Z' })];
    const b = bankedFromWindows(windows, 'oakland', NOW, { start: '2026-10-19', end: '2026-10-25' });
    expect(b.week).toBe(0);
    expect(b.accrued).toBe(30); // Oct 19 – 21, then nothing
    const v = real(windows);
    expect(v.banked.suspended.map((x) => x.id)).toEqual(['r']);
    expect(v.attention.map((a) => a.id)).toContain('reversed:r');
  });

  it('a new room shows no numbers until its own sales are in', () => {
    const room = { ...SEED.rooms.oakland, profile: { ...SEED.rooms.oakland.profile, awaitingData: true } };
    expect(awaitingData(room)).toBe(true);
    expect(awaitingData({ ...room, fromToast: { end: '2026-10-24', weeks: 13, files: [] } })).toBe(false);
  });
});

describe('the digest and the review record', () => {
  it('writes the week as a few plain lines, every dollar from the view', () => {
    const v = view('walnut');
    const g = weekDigest(v);
    expect(g.title).toBe(`${v.short}: the week of ${v.period.label}`);
    expect(g.body.split('\n')[0]).toBe(v.headline);
    expect(g.body).toMatch(/Contribution after food and labour/);
    expect(['info', 'warn']).toContain(g.severity);
  });

  it('keeps the newest weeks only', () => {
    const rec = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`2026-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`, { at: 'x' }]));
    const kept = trimReviews(rec);
    expect(Object.keys(kept)).toHaveLength(REVIEW_KEEP);
    expect(Object.keys(kept)).toContain('2026-10-22');
    expect(Object.keys(kept)).not.toContain('2026-01-01');
  });
});
