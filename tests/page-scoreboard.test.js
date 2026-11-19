import { describe, expect, test } from 'vitest';

import { dayBoard, dayHeadline, dayMark, locationReport, roomBadges, roomMark, roomsHeadline, sortRows, tally } from '../lib/data/page/scoreboard.js';
import { addDays, dowOf } from '../lib/data/page/daily.js';
import { CV_NAV, CV_PAGES } from '../lib/pages.js';

const day = (iso, net, extra = {}) => ({ iso, dow: dowOf(iso), net, covers: Math.round(net / 30), labour: net * 0.3, earned: null, complete: true, channels: {}, hours: [], ...extra });

describe('Scoreboard marks', () => {
  test('a day is good at +2% or more, bad under −5%, mid between, and unmarked with nothing to compare', () => {
    expect(dayMark(0.02)).toBe('good');
    expect(dayMark(0.019)).toBe('mid');
    expect(dayMark(-0.05)).toBe('mid');
    expect(dayMark(-0.051)).toBe('bad');
    expect(dayMark(null)).toBe('none');
  });

  test('rooms take their mark from the priority tier', () => {
    expect(roomMark({ priority: { tier: 'urgent' } })).toBe('bad');
    expect(roomMark({ priority: { tier: 'watch' } })).toBe('mid');
    expect(roomMark({ priority: { tier: 'steady' } })).toBe('good');
    expect(roomMark({})).toBe('none');
  });

  test('dayBoard marks each day against its last 4 same weekdays and ranks by net', () => {
    const end = '2026-10-25';
    const days = [];
    for (let i = 41; i >= 0; i--) days.push(day(addDays(end, -i), 5000));
    days[days.length - 1] = day(end, 5500); // +10%
    days[days.length - 2] = day(addDays(end, -1), 4500); // −10%
    days.splice(days.length - 4, 1); // a day not held is left out, never zero
    const b = dayBoard(days, { n: 14, end });
    expect(b).toHaveLength(13);
    expect(b.at(-1)).toMatchObject({ iso: end, mark: 'good', rank: 1 });
    expect(b.at(-1).vs).toBeCloseTo(0.1);
    expect(b.at(-2)).toMatchObject({ mark: 'bad', rank: 13 });
    expect(tally(b)).toEqual({ good: 1, mid: 11, bad: 1, none: 0 });
  });

  test('the first days with no history get no mark', () => {
    const days = [day('2026-10-24', 100), day('2026-10-25', 120)];
    expect(dayBoard(days).map((d) => d.mark)).toEqual(['none', 'none']);
  });

  test('sortRows puts unknown values last both ways', () => {
    const rows = [{ v: 2 }, { v: null }, { v: 5 }, { v: 1 }];
    expect(sortRows(rows, 'v', 'desc').map((r) => r.v)).toEqual([5, 2, 1, null]);
    expect(sortRows(rows, 'v', 'asc').map((r) => r.v)).toEqual([1, 2, 5, null]);
  });

  test('badges go to the best margin and a real gain only', () => {
    const r = (id, c, rev, pts) => ({ id, money: { contribution: { value: c }, revenue: { value: rev }, change: { marginPts: pts } } });
    const b = roomBadges([r('a', 40, 100, 0.5), r('b', 45, 100, -2), r('c', null, 100, 3)]);
    expect(b.b.map((x) => x.k)).toEqual(['margin']);
    expect(b.c.map((x) => x.k)).toEqual(['up']);
    expect(b.a).toBeUndefined();
    expect(roomBadges([r('a', 40, 100, 0.2), r('b', 30, 100, 0.9)]).b).toBeUndefined();
  });

  test('headlines lead with the outcome', () => {
    const rooms = [{ short: 'Walnut Creek', priority: { tier: 'urgent' } }, { short: 'Oakland', priority: { tier: 'steady' } }];
    expect(roomsHeadline(rooms, { kept: 50030.4 })).toBe('$50,030 kept after food & labor this week. Walnut Creek has the most going wrong.');
    expect(roomsHeadline(rooms)).toBe('1 of 2 restaurants in the green this week. Walnut Creek has the most going wrong.');
    expect(roomsHeadline(rooms.map((x) => ({ ...x, priority: { tier: 'steady' } })))).toBe('All 2 restaurants are in the green this week.');
    expect(dayHeadline({ iso: '2026-10-25' }, 0.023)).toBe('Sunday came in 2% above usual.');
    expect(dayHeadline({ iso: '2026-10-25' }, -0.08)).toBe('Sunday came in 8% below usual.');
    expect(dayHeadline({ iso: '2026-10-25' }, null)).toBe('Sunday: nothing to compare it with yet.');
  });

  test('a location report lists good and bad facts from computed figures, with no actions', () => {
    const room = {
      counted: true, state: 'sample-group', tests: 2,
      money: { contribution: { value: 18940 }, revenue: { value: 41620 }, change: { revenuePct: 0.031, marginPts: -1.4 } },
      savings: { runRate: 97, toDate: 1200, suspended: 0, reversed: [{ id: 'x', title: 'Switch romaine' }] },
    };
    const items = [{ id: 'o:feed:7shifts', kind: 'feed', tone: 'warn', icon: 'Clock', title: '7shifts feed is stale', body: 'Last update 18 hours ago.', cta: 'Reconnect', go: 'sources' }];
    const rep = locationReport(room, items, { badges: [{ k: 'margin', icon: 'Trophy', label: 'Best margin' }] });
    expect(rep.good.map((x) => x.text)).toEqual(['Sales up 3.1% on its normal', 'Best margin in the group', '$97/wk in verified savings', '2 changes being measured']);
    expect(rep.bad.map((x) => x.text)).toEqual(['Margin down 1.4 pts to 45.5%', 'Reversed: Switch romaine', '7shifts feed is stale']);
    expect(JSON.stringify(rep)).not.toMatch(/Reconnect|"go"|cta/);
  });

  test('one sidebar entry: Scoreboard, with Day by day as its second tab', () => {
    const items = CV_NAV.flatMap((g) => g.items);
    expect(items).toContain('portfolio');
    expect(items).not.toContain('daily');
    expect(CV_PAGES.portfolio.title).toBe('Scoreboard');
    expect(CV_PAGES.daily.title).toBe('Scoreboard');
  });
});
