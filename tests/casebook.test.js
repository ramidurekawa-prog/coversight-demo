import { describe, expect, it } from 'vitest';

import { agentFor } from '../lib/ai/agents.js';
import {
  AIM_BAND, BREACH_DAYS, CALLS_MAX, CONSULTANTS, LEVELS, MIN_RATE_N, adjustEstimate, aimSentence, callStates, casebook, casebookFacts, casesFrom, consultantSay, earnedLevel, leverOf, recordCalls, recordOf,
} from '../lib/ai/casebook.js';
import { roomMoves } from '../lib/ai/room-moves.js';
import { numbersOk, sousFacts, sousSheet } from '../lib/ai/sous.js';
import { authorize } from '../lib/agents/policy.js';
import { deriveGroup, deriveRoom } from '../lib/data/model.js';
import { NOW, SEED } from '../lib/data/seed.js';

const rooms = { oakland: 'Oakland', berkeley: 'Berkeley', walnut: 'Walnut Creek' };
const oak = deriveRoom(SEED, 'oakland');
const book = (id = 'oakland', ctx = {}) => casebook(deriveRoom(SEED, id), { rooms, ...ctx });
const k = (b, lever) => b.consultants.find((c) => c.lever === lever);
const kase = (o) => ({ id: o.id || o.outcome, room: 'r1', roomName: 'Room 1', lever: 'Labour', title: 'A change', est: 100, point: null, bookable: 0, paused: false, heldWeeks: 0, ended: null, ...o });

describe('the casebook: every call, as an outcome record', () => {
  it('reads every proof in the group as a case, with its estimate, how it ended and what it taught', () => {
    const cases = casesFrom(oak, { rooms });
    expect(cases).toHaveLength(SEED.proof.length);
    for (const c of cases) {
      expect(CONSULTANTS.map((x) => x.lever)).toContain(c.lever);
      expect(c.est, c.id).toBeGreaterThan(0);
      expect(c.lesson, c.id).toMatch(/[.]$/);
      expect(c.lesson, c.id).not.toMatch(/undefined|NaN|null/);
    }
    // A test that never gave a clear read has no measured figure to learn from.
    expect(cases.find((c) => c.id === 'oak-brunch')).toMatchObject({ outcome: 'inconclusive', point: 35 });
    expect(cases.find((c) => c.id === 'bk-friday')).toMatchObject({ outcome: 'reversed', ended: '2026-08-24' });
    expect(cases.find((c) => c.id === 'thu-prep')).toMatchObject({ heldWeeks: 18, since: '2026-06-22' });
  });

  it('a real group’s record is its own test windows, even when it has none yet', () => {
    expect(casesFrom(oak, { windows: [] })).toEqual([]);
    const wins = [
      { id: 'w1', roomId: 'oakland', lever: 'Labour', title: 'Stop Saturday close overtime', status: 'verified', bookedCents: 2400, pointCents: 3100, lowCents: 2400, startedAt: '2026-09-01', closedAt: '2026-09-29T00:00:00Z' },
      { id: 'w2', roomId: 'oakland', lever: 'void_comp', title: 'Sign-off on comps', status: 'stopped' },
      { id: 'w3', roomId: 'oakland', lever: 'menu_margin', title: 'Raise the pizza', status: 'running', pointCents: 50 },
    ];
    const cases = casesFrom(oak, { windows: wins, today: '2026-11-25' });
    expect(cases.map((c) => [c.id, c.lever, c.outcome])).toEqual([['w1', 'Labour', 'verified'], ['w3', 'Menu', 'testing']]);
    expect(cases[0]).toMatchObject({ bookable: 24, point: 31, heldWeeks: 8 });
    expect(cases[1].point).toBeNull(); // a running test has measured nothing yet
  });

  it('spells levers the way windows and older records do', () => {
    expect(['labor', 'Labour', 'overtime'].map(leverOf)).toEqual(['Labour', 'Labour', 'Labour']);
    expect(leverOf('void_comp')).toBe('Controls');
    expect(leverOf('nonsense')).toBeNull();
  });
});

describe('the record: counts first, rates only with enough results', () => {
  it('counts the group’s calls by how they ended', () => {
    const r = book().record;
    expect(r).toMatchObject({ calls: 16, held: 3, reversed: 2, noRead: 2, open: 6, blocked: 2, results: 10, reads: 8 });
    expect(r.week).toBe(479); // Thursday prep (97) and Walnut Creek's Tuesday close (382); the paused comp policy accrues nothing
  });

  it('shows no rate below the minimum, only the counts behind it', () => {
    const labour = k(book(), 'Labour').record;
    expect(labour.reads).toBeLessThan(MIN_RATE_N);
    expect(labour.heldRate).toBeNull();
    const many = recordOf(Array.from({ length: MIN_RATE_N }, (_, i) => kase({ id: `c${i}`, outcome: i < 3 ? 'verified' : 'directional', point: 100 })));
    expect(many.heldRate).toBeCloseTo(3 / MIN_RATE_N);
  });

  it('scores estimates only on clear reads', () => {
    const r = recordOf([
      kase({ id: 'a', outcome: 'verified', est: 100, point: 80 }),
      kase({ id: 'b', outcome: 'inconclusive', est: 100, point: 5 }),
      kase({ id: 'c', outcome: 'testing', est: 100, point: 300 }),
    ]);
    expect(r.aim).toEqual({ n: 1, ratio: 0.8, onTarget: 1 });
    expect(aimSentence(r.aim)).toBe('I estimate high: across 1 measured change, what was measured came to 80% of what I estimated.');
    expect(aimSentence({ n: 3, ratio: 1.02 })).toMatch(/^My estimates have been close/);
    expect(aimSentence({ n: 0, ratio: null })).toBeNull();
  });

  it('corrects its own estimate only with enough history, and labels it an estimate', () => {
    expect(adjustEstimate(200, { n: MIN_RATE_N - 1, ratio: 0.8 })).toBeNull();
    expect(adjustEstimate(200, { n: MIN_RATE_N, ratio: 0.8 })).toEqual({ value: 160, ratio: 0.8, n: MIN_RATE_N, claim: 'est' });
    expect(adjustEstimate(0, { n: 9, ratio: 0.8 })).toBeNull();
  });

  it('talks plainly about each consultant', () => {
    const b = book();
    expect(consultantSay(k(b, 'Labour'))).toBe('2 of 3 clear results held up, 1 broke a guardrail. $479 a week verified across your rooms.');
    expect(consultantSay(k(b, 'Throughput'))).toBe('2 tests closed, all too small to tell. No clear result yet.');
    expect(consultantSay(k(b, 'Inventory'))).toBe('2 calls being tested. No results yet.');
    expect(consultantSay(k(b, 'Channels'))).toBe('No calls tested yet.');
  });
});

describe('authority is earned from evidence, and a breach takes it back', () => {
  it('matches what each room has shown', () => {
    const levels = (id) => Object.fromEntries(book(id).consultants.map((c) => [c.lever, c.earned.level]));
    expect(levels('oakland')).toMatchObject({ Labour: 3, Menu: 1, Purchasing: 1, Controls: 2, Throughput: 0, Inventory: 0 });
    expect(levels('walnut')).toMatchObject({ Labour: 3, Purchasing: 1, Controls: 2 });
    expect(levels('berkeley')).toMatchObject({ Labour: 1 });
  });

  it('drops back to Recommends for 90 days after a guardrail breaks in that room, and says until when', () => {
    const e = k(book('berkeley'), 'Labour').earned;
    expect(e.capped).toEqual({ why: '“Cut one Friday dinner server” broke a guardrail here on Aug 24', until: '2026-11-22' });
    expect(e.next.needs[0]).toBe('No guardrail broken here until Nov 22');
    // After the 90 days the evidence counts again.
    const later = earnedLevel(casesFrom(oak, { rooms }).filter((c) => c.lever === 'Labour'), 'berkeley', '2026-11-23');
    expect(later.capped).toBeNull();
    expect(later.level).toBe(2);
    expect(BREACH_DAYS).toBe(90);
  });

  it('needs every condition of a rung, in order', () => {
    const cases = [kase({ id: 'v1', outcome: 'verified', point: 100, heldWeeks: 20 }), kase({ id: 'v2', room: 'r2', outcome: 'verified', point: 95 }), kase({ id: 'v3', room: 'r2', outcome: 'verified', point: 110 })];
    expect(earnedLevel(cases, 'r1', '2026-10-27').level).toBe(4);
    // Estimates far off what was measured stop it at Drafts, however many changes held up.
    const off = cases.map((c) => ({ ...c, est: 300 }));
    const e = earnedLevel(off, 'r1', '2026-10-27');
    expect(e.level).toBe(2);
    expect(e.next.needs).toEqual([`Estimates within ${Math.round(AIM_BAND * 100)}% of what was measured`]);
    // Nothing held up in this room: it can draft here, not act.
    expect(earnedLevel(cases, 'r3', '2026-10-27').level).toBe(2);
    expect(earnedLevel([], 'r1', '2026-10-27')).toMatchObject({ level: 0, next: { level: 1 } });
  });

  it('works at the level a person granted, never above what it earned', () => {
    const b = book('berkeley', { levels: { Labour: 3 } });
    expect(k(b, 'Labour')).toMatchObject({ granted: 3, working: 1, over: true });
    expect(k(book('oakland'), 'Labour')).toMatchObject({ granted: 2, working: 2 }); // the seed's level, under the 3 it earned
  });

  it('no agent can raise a level: only a person, through the saved autonomy key', () => {
    expect(authorize({ id: 'guardrail', permission: 'act-within-fence' }, { type: 'autonomy.raise', from: 1, to: 2 }, {}).ok).toBe(false);
    expect(LEVELS.map((l) => l.n)).toEqual([0, 1, 2, 3, 4]);
    expect(LEVELS[4].may).toMatch(/always wait for you/);
  });
});

describe('the call log', () => {
  const moves = roomMoves(oak, {}, { now: Date.parse('2026-10-27T19:00:00Z') });

  it('logs the consultants’ moves once each, with what they estimated then', () => {
    const log = recordCalls([], moves, Date.parse('2026-10-27T19:00:00Z'));
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((c) => CONSULTANTS.some((x) => x.topic === c.topic))).toBe(true);
    expect(recordCalls(log, moves)).toBe(log); // nothing new: the same array, so no save
    const later = recordCalls(log, moves.map((m) => ({ ...m, value: '$1' })), Date.parse('2026-11-01T00:00:00Z'));
    expect(later).toBe(log); // a call is what was said then
    const many = recordCalls([], Array.from({ length: CALLS_MAX + 20 }, (_, i) => ({ id: `m${i}`, topic: 'labor', title: 't' })));
    expect(many).toHaveLength(CALLS_MAX);
  });

  it('knows which calls were taken, set aside, still open or passed', () => {
    const log = [
      { id: 'do:plan:a', topic: 'labor', title: 'a', at: 'x' }, { id: 'do:vendor:price', topic: 'purchasing', title: 'b', at: 'x' },
      { id: 'do:plan:c', topic: 'menu', title: 'c', at: 'x' }, { id: 'do:plan:d', topic: 'menu', title: 'd', at: 'x' },
    ];
    const st = callStates(log, { acts: [{ id: 'do:plan:a', topic: 'labor' }], mem: { 'vendor:price': { how: 'dismissed' } }, offered: [{ id: 'do:plan:c' }] });
    expect(st.map((c) => c.state)).toEqual(['taken', 'aside', 'open', 'passed']);
    const b = casebook(oak, { calls: log, acts: [{ id: 'do:plan:a', topic: 'labor' }], offered: [{ id: 'do:plan:c' }] });
    expect(k(b, 'Labour').calls).toMatchObject({ taken: 1, aside: 0 });
    expect(b.lift).toEqual({ results: 1, need: 30 });
  });
});

describe('what Sous can say about the consultants', () => {
  it('names each consultant as its page agent does', () => {
    for (const c of CONSULTANTS) expect(agentFor(c.page).name, c.page).toBe(c.name);
  });

  it('every record holds only figures from the casebook, and its short form passes the figure check', () => {
    const facts = casebookFacts(book(), 'Oakland');
    expect(facts.map((f) => f.id)).toEqual(['track', 'track:labour', 'track:menu', 'track:purchasing', 'track:controls', 'track:throughput']);
    const sheet = sousSheet(facts);
    for (const f of facts) {
      expect(numbersOk(`${f.say} ${f.todo || ''}`, sheet), `${f.id}: ${f.say} ${f.todo}`).toBe(true);
      expect(f.text).not.toMatch(/undefined|NaN|proven|guaranteed|certain/i);
    }
  });

  it('is part of what Sous reads, except for a floor lead', () => {
    const group = deriveGroup(SEED);
    const ids = sousFacts(oak, { role: 'owner', group }).map((f) => f.id);
    expect(ids).toContain('track:labour');
    expect(sousFacts(oak, { role: 'floor', group }).some((f) => f.id.startsWith('track'))).toBe(false);
  });

  it('is honest about what it cannot claim yet', () => {
    const b = book();
    expect(b.network).toMatchObject({ locations: 0, on: false, need: { locations: 20, groups: 5 } });
    expect(b.lift.need).toBe(30);
    expect(b.today).toBe(NOW.iso);
  });
});

describe('a saved level out of range (found by scripts/mise-stress.mjs)', () => {
  it('is held inside the ladder instead of breaking the casebook', async () => {
    const { casebook: cb, casebookFacts: facts } = await import('../lib/ai/casebook.js');
    const { deriveRoom: dr } = await import('../lib/data/model.js');
    const { SEED: seed } = await import('../lib/data/seed.js');
    const d = dr(seed, 'oakland');
    const book = cb(d, { levels: { Labour: -1, Menu: 9, Purchasing: 1.7 } });
    for (const k of book.consultants) expect(k.working >= 0 && k.working <= k.earned.level).toBe(true);
    expect(() => facts(book, 'Oakland')).not.toThrow();
  });
});
