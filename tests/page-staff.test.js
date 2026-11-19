import { describe, expect, test } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { applyInputs } from '../lib/data/apply.js';
import { deriveRoom } from '../lib/data/model.js';
import { readToastExports } from '../lib/data/toast.js';
import { MIN_SHIFTS, anonymize, staffPage, staffSource } from '../lib/data/page/staff.js';
import { slotOf } from '../lib/data/page/staff-pos.js';
import { toastFixture } from './helpers/toast-fixture.js';

const near = (a, b, tol = 0.02) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const ROOMS = Object.keys(SEED.rooms);

describe('Staff page on the sample', () => {
  test.each(ROOMS)('%s: the 4 weeks add up to the same sales, giveaways and hours as Labor and Giveaways', (id) => {
    const P = staffPage(SEED, id);
    const d = deriveRoom(SEED, id);
    const staff = SEED.rooms[id].staff;
    near(P.reconcile.sales, d.staff.sales);
    near(P.reconcile.comps, d.staff.types.comps.total);
    near(P.reconcile.disc, d.staff.types.disc.total);
    near(P.reconcile.voids, d.staff.types.postVoid.total);
    near(P.reconcile.hoursThisWeek, staff.reduce((t, s) => t + s.hours, 0), 0.05);
    near(P.people.reduce((t, p) => t + (p.hoursThisWeek || 0) * (p.rate || 0), 0), d.week.labour, 0.5);
    // Sellers' guests seat the room's covers.
    expect(P.sellers.reduce((t, p) => t + p.R.guests, 0)).toBe(SEED.rooms[id].anchor.covers * 4);
    expect(P.people).toHaveLength(staff.length);
  });

  test('a "closer look" is only ever a register signal from the Giveaways page limits', () => {
    for (const id of ROOMS) {
      const P = staffPage(SEED, id);
      for (const p of P.people.filter((x) => x.read.kind === 'closer')) {
        expect(['postVoid', 'comps', 'disc'].some((k) => p.reg?.[`${k}Signal`])).toBe(true);
      }
    }
    expect(staffPage(SEED, 'oakland').people.find((p) => p.name === 'Kayla P.').read.kind).toBe('closer');
    expect(staffPage(SEED, 'walnut').people.find((p) => p.name === 'Dani K.').read.kind).toBe('closer');
  });

  test('never ranks on too few shifts, and never says to fire anyone', () => {
    for (const id of ROOMS) {
      const P = staffPage(SEED, id);
      for (const p of P.sellers) {
        if (p.shifts < MIN_SHIFTS) { expect(p.read.kind).toBe('early'); expect(p.m.fit.pct).toBeNull(); }
        else expect(p.m.fit.pct).not.toBeNull();
      }
      const text = JSON.stringify({ reads: P.people.map((p) => p.read), team: P.team });
      expect(text).not.toMatch(/\b(fire|fired|terminate|let go|dismiss)\b/i);
    }
    expect(staffPage(SEED, 'oakland').team.overCorrect.some((o) => o.kind === 'early')).toBe(true);
  });

  test('ranks within a job, on the same kind of shifts, and says so', () => {
    const P = staffPage(SEED, 'berkeley');
    const bar = P.sellers.filter((p) => p.job === 'Bartender');
    expect(bar.length > 0 && bar.every((p) => p.peers.scope === 'group')).toBe(true); // two bartenders: compared with every room's
    expect(P.sellers.filter((p) => p.job === 'Server').every((p) => p.peers.scope === 'room')).toBe(true);
    // A team habit, not a person: Berkeley's servers are light on desserts against the other rooms.
    expect(P.team.habits.map((h) => h.k)).toContain('desserts');
    expect(P.team.action.kind).toBe('team');
    expect(P.team.action.task.system).toBe('Coaching');
    // Over-correcting: a server who looks slow on the raw number but isn't on the same shifts.
    expect(staffPage(SEED, 'oakland').team.overCorrect.some((o) => o.kind === 'shifts')).toBe(true);
  });

  test('labels the period and keeps 13 weeks of trend', () => {
    const P = staffPage(SEED, 'oakland');
    expect(P.period.label).toBe('Last 4 weeks, Sep 28 – Oct 25');
    expect(P.labels).toHaveLength(13);
    expect(P.sellers[0].trend).toHaveLength(13);
  });

  test('anonymize leaves no names', () => {
    const A = anonymize(staffPage(SEED, 'oakland'));
    const names = SEED.rooms.oakland.staff.map((s) => s.name);
    const text = JSON.stringify(A);
    for (const n of names) expect(text).not.toContain(n);
  });
});

describe('Staff page on a room’s own Toast data', () => {
  const { unknown, ...summary } = readToastExports(Object.entries(toastFixture({})).map(([name, text]) => ({ name, text })));
  void unknown;
  const ds = applyInputs(SEED, { oakland: { toast: { rows: [JSON.parse(JSON.stringify(summary))], date: 'Nov 1', label: 'Toast data export', n: 1 } } });

  test('uses only the Toast rows, never the sample’s people', () => {
    expect(staffSource(ds, 'oakland').from).toBe('toast');
    const P = staffPage(ds, 'oakland');
    const sample = new Set(SEED.rooms.oakland.staff.map((s) => s.name));
    expect(P.people.length).toBeGreaterThan(0);
    expect(P.people.some((p) => sample.has(p.name))).toBe(false);
  });

  test('its 4 weeks match Toast’s own employee rows (the Labor and Giveaways source)', () => {
    const P = staffPage(ds, 'oakland');
    for (const e of summary.rows.exceptions.filter((x) => x.sales > 0)) {
      const p = P.people.find((x) => x.name === e.employee);
      near(p.R.sales, e.sales, 0.05);
      near(p.R.voids, e.post_send_voids, 0.05);
      near(p.R.disc, e.discounts, 0.05);
    }
    // Late clock-ins need a schedule the exports don't have: shown as unknown, not zero.
    expect(P.people.every((p) => p.m.late.raw === null)).toBe(true);
  });

  test('slots: weekday lunch, Mon–Thu dinner, Fri–Sat dinner, weekend', () => {
    expect(slotOf(Date.UTC(2026, 9, 20, 12))).toBe(0); // Tue noon
    expect(slotOf(Date.UTC(2026, 9, 20, 19))).toBe(1); // Tue 7 pm
    expect(slotOf(Date.UTC(2026, 9, 23, 19))).toBe(2); // Fri 7 pm
    expect(slotOf(Date.UTC(2026, 9, 25, 11))).toBe(3); // Sun brunch
    expect(slotOf(Date.UTC(2026, 9, 25, 19))).toBe(3); // Sun dinner
  });
});
