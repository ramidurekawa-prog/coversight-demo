import { describe, expect, it } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { deriveRoom, choosePlan } from '../lib/data/model.js';
import { awaitingData, bankedFromWindows, trimReviews, weekDigest, weekOf, weekView, REVIEW_KEEP } from '../lib/data/page/week.js';

const NOW = new Date('2026-10-27T12:00:00Z');

describe('This week, on the sample', () => {
  const d = deriveRoom(SEED, 'oakland');
  const v = weekView(d, { now: NOW });

  it('names the week from the data, not the wall clock', () => {
    expect(weekOf(d.hist.rows)).toEqual({ start: '2026-10-19', end: '2026-10-25', label: 'Oct 19 – 25' });
    expect(v.period.label).toBe('Oct 19 – 25');
  });

  it('shows the same figures the model computes', () => {
    expect(v.earned.value).toBe(d.week.earned);
    expect(v.banked.week).toBe(d.banked.week);
    expect(v.margin.move).toBe(d.hist.marginMove);
    expect(v.margin.claimable).toBe(d.claimable);
    expect(v.margin.claimable + v.margin.unexplained).toBeCloseTo(v.margin.move, 9);
    expect(v.exposure.value).toBe(d.exposure);
  });

  it('the brief reads the same week as the earned figure', () => {
    expect(v.brief.week.earned).toBe(Math.round(d.week.earned));
    expect(v.brief.parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(v.brief.vsLast.earned, 6);
  });

  it('chooses the plan the way The plan page does, with the saved hours and set-aside findings', () => {
    const at2 = weekView(d, { hours: 2, now: NOW });
    expect(at2.plan.chosen.map((c) => c.id)).toEqual(choosePlan(d.candidates, 2).sorted.filter((c) => choosePlan(d.candidates, 2).chosen.has(c.id)).map((c) => c.id));
    const top = at2.plan.chosen[0].id;
    const later = weekView(d, { hours: 2, dismissed: { [top]: '2026-12-01T00:00:00.000Z' }, now: NOW });
    expect(later.plan.chosen.map((c) => c.id)).not.toContain(top);
    const expired = weekView(d, { hours: 2, dismissed: { [top]: '2026-10-01T00:00:00.000Z' }, now: NOW });
    expect(expired.plan.chosen.map((c) => c.id)).toContain(top);
    expect(weekView(d, { hours: 0.5, now: NOW }).plan.used).toBeLessThanOrEqual(0.5);
  });

  it('collects what needs the operator: written alarms, paused packets elsewhere, quarantined tests, stale feeds', () => {
    const ids = v.attention.map((a) => a.id);
    expect(ids.some((i) => i.startsWith('paused:'))).toBe(true);
    expect(ids.some((i) => i.startsWith('data:'))).toBe(true);
    expect(ids.filter((i) => i.startsWith('feed:'))).toHaveLength(d.feeds.filter((f) => f.state === 'stale').length);
    expect(v.inFlight.map((t) => t.id)).toEqual(d.proofs.filter((p) => p.outcome === 'testing').map((p) => p.id));
  });

  it('every room has a week, and none is waiting for data', () => {
    for (const id of Object.keys(SEED.rooms)) {
      const w = weekView(deriveRoom(SEED, id), { now: NOW });
      expect(w.period).not.toBeNull();
      expect(w.awaiting).toBe(false);
      expect(w.brief).not.toBeNull();
    }
  });
});

describe('This week, for a real group', () => {
  const ds = { ...SEED, proof: [] };
  const d = deriveRoom(ds, 'oakland');
  const win = (o) => ({ id: o.id, roomId: 'oakland', title: o.title || o.id, status: 'running', day: 0, bookedCents: 0, lowCents: null, pointCents: null, closedAt: null, reversedAt: null, ...o });

  it('banks only verified windows, at their lower bound, and never a sample packet', () => {
    const windows = [
      win({ id: 'a', status: 'verified', bookedCents: 7000, lowCents: 7000, pointCents: 9000, closedAt: '2026-10-13T12:00:00Z' }),
      win({ id: 'b', status: 'running', day: 14 }),
      win({ id: 'c', roomId: 'berkeley', status: 'verified', bookedCents: 5000, closedAt: '2026-10-01T00:00:00Z' }),
    ];
    const v = weekView(d, { windows, now: NOW });
    expect(v.real).toBe(true);
    expect(v.banked.week).toBe(70);
    expect(v.banked.toDate).toBe(140); // Oct 14 through today (Oct 27), 14 days × $10
    expect(v.banked.lead).toMatchObject({ id: 'a', bookable: 70, point: 90 });
    expect(v.margin.claimable).toBe(Math.max(0, Math.min(70, d.hist.marginMove)));
    expect(v.inFlight).toEqual([expect.objectContaining({ id: 'b', progress: 50, waiting: false })]);
    expect(v.attention.some((a) => a.id.startsWith('paused:') || a.id.startsWith('alarm:'))).toBe(false);
  });

  it('a reversed window stops accruing on the day it turned and shows up as needing attention', () => {
    const windows = [win({ id: 'r', status: 'reversed', lowCents: 7000, closedAt: '2026-10-13T12:00:00Z', reversedAt: '2026-10-20T08:00:00Z' })];
    const b = bankedFromWindows(windows, 'oakland', NOW);
    expect(b.week).toBe(0);
    expect(b.toDate).toBe(60); // Oct 14 – 19
    const v = weekView(d, { windows, now: NOW });
    expect(v.attention.map((a) => a.id)).toContain('reversed:r');
  });

  it('a waiting window says so', () => {
    const v = weekView(d, { windows: [win({ id: 'w', status: 'waiting', day: 7, staleDays: 12 })], now: NOW });
    expect(v.inFlight[0]).toMatchObject({ waiting: true });
    expect(v.inFlight[0].note).toMatch(/12 days old/);
  });

  it('a new room shows no numbers until its own sales are in', () => {
    const room = { ...SEED.rooms.oakland, profile: { ...SEED.rooms.oakland.profile, awaitingData: true } };
    expect(awaitingData(room)).toBe(true);
    expect(awaitingData({ ...room, fromToast: { end: '2026-10-24', weeks: 13, files: [] } })).toBe(false);
  });
});

describe('the digest and the review record', () => {
  it('writes the week as a few plain lines, every dollar from the view', () => {
    const v = weekView(deriveRoom(SEED, 'walnut'), { now: NOW });
    const g = weekDigest(v);
    expect(g.title).toBe(`${v.short}: the week of ${v.period.label}`);
    expect(g.body).toMatch(/^Earned \$/);
    expect(g.body.split('\n').length).toBeGreaterThanOrEqual(3);
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
