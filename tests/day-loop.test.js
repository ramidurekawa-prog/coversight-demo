import { describe, expect, it } from 'vitest';

import { dataChecks, dayLoop, LOOP, openingChecks, serviceChecks } from '../lib/ai/loop.js';
import { LOOP_BREAK, sousMoves } from '../lib/ai/moves.js';
import { lineCheck } from '../lib/ai/playbook.js';
import { sousFacts, sousToday } from '../lib/ai/sous.js';
import { forecast } from '../lib/data/forecast/engine.js';
import { seriesFromSample } from '../lib/data/forecast/series.js';
import { deriveRoom } from '../lib/data/model.js';
import { servicePlan } from '../lib/data/page/service.js';
import { SEED } from '../lib/data/seed.js';

const rooms = Object.keys(SEED.rooms);
const room = (id) => deriveRoom(SEED, id);
const NOW = Date.parse('2026-10-26T16:00:00Z');
const task = (over = {}) => ({ id: 't1', roomId: 'berkeley', title: 'Raise the burger to $19', system: 'Toast', status: 'open', approvalId: 'price:burger:19', createdAt: '2026-10-24T12:00:00Z', ...over });

describe('the day loop reads last night, today and every open decision', () => {
  it('every room gets an opening, service and data checkup with nothing unfilled', () => {
    for (const id of rooms) {
      for (const page of ['today', 'service', 'sources']) {
        const book = lineCheck(page, room(id), { now: NOW });
        expect(book, `${id} ${page}`).toBeTruthy();
        for (const c of book.checks) {
          expect(`${c.text} ${c.say || ''} ${c.how}`, c.id).not.toMatch(/\{[a-zA-Z]+\}|undefined|NaN|null/);
          expect(c.stage, c.id).toMatch(/^(spot|plan|decide|check|data)$/);
          if (c.status === 'found') expect(c.how, c.id).toBeTruthy();
          if (c.status === 'needs') expect(c.needs, c.id).toBeTruthy();
        }
      }
    }
    // Three rooms read cold: Covercast plus its last seven day-ahead calls each, about a second a room.
  }, 30_000);

  it('last night is the latest day on file, scored against the call Covercast made the day before', () => {
    const d = room('oakland');
    const s = seriesFromSample(d.room);
    const L = dayLoop(d, { now: NOW });
    const last = s.days.at(-1);
    expect(L.night.iso).toBe(last.iso);
    expect(L.night.covers).toBe(last.covers);
    // The call uses only the days before it: the same forecast run with that day as "today".
    const call = forecast(s, 'covers', { today: last.iso, days: 1 }).days[0];
    expect(L.night.call.value).toBe(call.value);
    expect(L.night.vs).toBe(last.covers > call.high ? 'above' : last.covers < call.low ? 'below' : 'inside');
    // The sample's today is the day after its data.
    expect(L.today).toBe('2026-10-26');
    expect(L.night.label).toBe('Yesterday');
    expect(L.record.n).toBe(LOOP.recordDays);
  });

  it('a night outside the forecast range is found, with the reason to look for', () => {
    const d = room('oakland');
    const s = seriesFromSample(d.room);
    // Saturday Oct 24 in the sample landed above Covercast's range: read the loop as of that night.
    const upTo = { ...s, days: s.days.filter((x) => x.iso <= '2026-10-24'), hours: s.hours.filter((h) => h.iso <= '2026-10-24') };
    const c = openingChecks(d, { series: upTo, now: NOW }).find((x) => x.id === 'last-night');
    expect(c.status).toBe('found');
    expect(c.say).toMatch(/busier than I expected/);
    expect(c.text).toContain(String(upTo.days.at(-1).covers));
  });

  it('an approval nobody made is a broken loop and leads every move', () => {
    const d = room('berkeley');
    const t = sousToday(d, { now: NOW });
    const day = { now: NOW, open: t.open, tasks: [task()] };
    const stuck = openingChecks(d, day).find((c) => c.id === 'stuck:t1');
    expect(stuck.status).toBe('found');
    expect(stuck.weight).toBeGreaterThanOrEqual(LOOP_BREAK);
    expect(stuck.say).toMatch(/2 days ago/);
    const moves = sousMoves(d, { card: t.card, day });
    expect(moves[0].title).toMatch(/^Make it in Toast or hand it off: Raise the burger/);
    expect(moves[0].act).toEqual({ kind: 'check', page: 'today', id: 'today:stuck:t1' });
    // Made the same morning it was approved is not stuck yet.
    expect(openingChecks(d, { now: NOW, tasks: [task({ createdAt: '2026-10-26T14:00:00Z' })] }).some((c) => c.id === 'stuck:t1')).toBe(false);
    // The facts carry it too, so the AI and every agent know.
    expect(sousFacts(d, { day }).find((f) => f.id === 'check:today:stuck:t1')).toBeTruthy();
  });

  it('marked made but not in the data, a hand-off nobody opened, and a meeting action due today are all found', () => {
    const d = room('berkeley');
    const checks = openingChecks(d, {
      now: NOW,
      tasks: [task({ id: 't2', status: 'mismatch', note: 'Toast data still shows the old price.' })],
      assigned: { recipes: { to: 'user:abc', name: 'Dana', at: '2026-10-25T12:00:00Z' }, seen: { to: 'user:def', name: 'Lee', at: '2026-10-25T12:00:00Z', ack: { at: '2026-10-25T13:00:00Z' } } },
      meeting: [{ id: 'm1', title: 'Spot-count romaine', owner: 'Marcus', due: '2026-10-26', status: 'open' }, { id: 'm2', title: 'Later thing', due: '2026-10-30', status: 'open' }],
    });
    const ids = checks.filter((c) => c.status === 'found').map((c) => c.id);
    expect(ids).toContain('mismatch:t2');
    expect(ids).toContain('unseen:recipes');
    expect(ids).not.toContain('unseen:seen');
    expect(ids).toContain('meeting:m1');
    expect(ids).not.toContain('meeting:m2');
    expect(checks.find((c) => c.id === 'meeting:m1').say).toMatch(/due today\. It’s Marcus’s/);
  });

  it('with nothing open, follow-through is clear', () => {
    const c = openingChecks(room('berkeley'), { now: NOW, tasks: [task({ status: 'verified' })] }).find((x) => x.id === 'follow');
    expect(c.status).toBe('clear');
    expect(c.text).toMatch(/1 change is confirmed by the data/);
  });
});

describe('trust first', () => {
  it('holds back staffing advice while the schedule feed is behind, and never makes it a move', () => {
    const oak = room('oakland');
    expect(oak.feeds.find((f) => f.name === '7shifts').state).toBe('stale');
    const found = serviceChecks(oak, { now: NOW }).filter((c) => c.status === 'found');
    expect(found.length).toBeGreaterThan(0);
    for (const c of found) {
      expect(c.held).toBe(true);
      expect(c.do).toMatch(/^Check who is on/);
    }
    const t = sousToday(oak, { now: NOW });
    expect(sousMoves(oak, { card: t.card, day: { now: NOW, open: t.open } }).some((m) => m.checkId?.startsWith('service:'))).toBe(false);
    // Today's own card that rests on the stale feed is held too.
    expect(openingChecks(oak, { now: NOW, open: t.open }).some((c) => c.id.startsWith('held:') && c.status === 'found')).toBe(true);
  });

  it('a send-home is Service’s own call, with Service’s own dollars', () => {
    for (const id of rooms) {
      const d = room(id);
      const L = dayLoop(d, { now: NOW });
      for (const [meal, m] of Object.entries(L.plan.meals)) {
        const c = serviceChecks(d, { now: NOW }).find((x) => x.id === `spare-${meal}`);
        if (m.cutFrom == null) { expect(c, `${id} ${meal}`).toBeUndefined(); continue; }
        expect(c, `${id} ${meal}`).toBeTruthy();
        expect(c.claim).toBe('mod');
        if (m.value) expect(c.value).toBe(`$${m.value}`);
        expect(c.unit || 'potential').toMatch(/potential/);
      }
    }
  });

  it('staffing reads the same plan Service shows', () => {
    const d = room('walnut');
    const L = dayLoop(d, { now: NOW });
    const dinner = L.plan.meals.dinner;
    const p = servicePlan(d.room, 'Mon', null, 'dinner', null);
    expect(dinner.covers).toBeGreaterThan(0);
    expect(dinner.rate).toBe(p.rate);
  });
});

describe('the data checkup', () => {
  it('finds missing days and a day that looks like a typo', () => {
    const d = room('berkeley');
    const s = seriesFromSample(d.room);
    const days = s.days.map((x) => ({ ...x }));
    const typo = days.at(-3);
    typo.net *= 10;
    const gapped = { ...s, days: days.filter((x) => x.iso !== days.at(-5).iso) };
    const checks = dataChecks(d, { series: gapped, now: NOW });
    const gaps = checks.find((c) => c.id === 'gaps');
    const odd = checks.find((c) => c.id === 'odd-days');
    expect(gaps.status).toBe('found');
    expect(gaps.say).toMatch(/^1 day in the last four weeks has no sales/);
    expect(odd.status).toBe('found');
    expect(odd.say).toMatch(/Is that a typo\?/);
    // The clean sample has neither.
    const clean = dataChecks(d, { now: NOW });
    expect(clean.find((c) => c.id === 'gaps').status).toBe('clear');
    expect(clean.find((c) => c.id === 'odd-days').status).toBe('clear');
  });

  it('a stale feed is found with the manual way when it has one', () => {
    const c = dataChecks(room('oakland'), { now: NOW }).find((x) => x.id === 'stale-recipe-costs');
    expect(c.status).toBe('found');
    expect(c.how).toMatch(/type it in or drop a file/);
  });
});
