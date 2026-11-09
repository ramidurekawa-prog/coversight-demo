import { describe, expect, it, test } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { measureEffect, t90, windowState, guardrailCheck, statusz, WORKER_JOBS } from '../lib/data/pilot.js';

/* The estimator is a port of the monorepo's packages/engine/src/verification/effect.ts.
 * These are that file's own tests, so the two can't drift apart unnoticed. */
describe('measureEffect (same cases as the platform)', () => {
  it('books the lower bound of the measured effect, not the estimate', () => {
    const m = measureEffect({ baselineValue: 529, targetDirection: 'up', checkpoints: [{ observedValue: 600 }, { observedValue: 595 }, { observedValue: 605 }, { observedValue: 600 }], centsPerUnitWeek: 150 });
    expect(m.method).toBe('before_after');
    expect(m.pointUnits).toBe(71);
    expect(m.pointCents).toBe(10_650);
    expect(m.lowCents).toBeLessThan(m.pointCents);
    expect(m.bookableWeeklyCents).toBe(m.lowCents);
  });

  it('a window that moved half as much as the estimate books at most half', () => {
    const estimateCents = 346 * 150;
    const m = measureEffect({ baselineValue: 529, targetDirection: 'up', checkpoints: [{ observedValue: 700 }, { observedValue: 704 }, { observedValue: 702 }, { observedValue: 702 }], centsPerUnitWeek: 150 });
    expect(m.pointCents).toBe(Math.round(estimateCents / 2));
    expect(m.bookableWeeklyCents).toBeLessThanOrEqual(estimateCents / 2);
    expect(m.bookableWeeklyCents).toBeGreaterThan(0);
  });

  it('subtracts the control group (difference-in-differences)', () => {
    const m = measureEffect({ baselineValue: 3460, targetDirection: 'up', checkpoints: [{ observedValue: 3700, controlDelta: 100 }, { observedValue: 3720, controlDelta: 110 }, { observedValue: 3690, controlDelta: 95 }], centsPerUnitWeek: 10 });
    expect(m.method).toBe('diff_in_diff');
    expect(Math.round(m.pointUnits)).toBe(Math.round((240 + 260 + 230) / 3 - (100 + 110 + 95) / 3));
  });

  it('signs down-is-better metrics correctly', () => {
    const m = measureEffect({ baselineValue: 52, targetDirection: 'down', checkpoints: [{ observedValue: 47 }, { observedValue: 46 }, { observedValue: 47 }], centsPerUnitWeek: 1000 });
    expect(m.pointUnits).toBeCloseTo(5.33, 2);
  });

  it('books $0 below zero, with one checkpoint, or with no conversion', () => {
    const noisy = measureEffect({ baselineValue: 100, targetDirection: 'up', checkpoints: [{ observedValue: 140 }, { observedValue: 70 }, { observedValue: 110 }], centsPerUnitWeek: 100 });
    expect(noisy.lowCents).toBeLessThan(0);
    expect(noisy.bookableWeeklyCents).toBe(0);
    expect(measureEffect({ baselineValue: 1, targetDirection: 'up', checkpoints: [{ observedValue: 2 }], centsPerUnitWeek: 1 }).bookableWeeklyCents).toBe(0);
    expect(measureEffect({ baselineValue: 1, targetDirection: 'up', checkpoints: [{ observedValue: 2 }, { observedValue: 2 }], centsPerUnitWeek: null }).method).toBe('unmeasured');
  });

  it('t table', () => {
    expect(t90(3)).toBe(2.353);
    expect(t90(100)).toBe(1.697);
  });
});

describe('the sample test windows', () => {
  const rooms = ['oakland', 'berkeley', 'walnut'];

  test('every room has a window with four weekly checkpoints and a Toast connection', () => {
    for (const id of rooms) {
      const p = SEED.rooms[id].pilot;
      expect(p.checkpoints.map((c) => c.day)).toEqual([7, 14, 21, 28]);
      expect(p.toast.guid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(p.toast.backfill.weeks).toBe(13);
    }
    expect(new Set(rooms.map((id) => SEED.rooms[id].pilot.toast.guid)).size).toBe(3);
  });

  /* Pinned: the booked figure each sample window closes at. If one moves, change it deliberately. */
  test('day 28 closes Verified at the lower bound', () => {
    const booked = rooms.map((id) => {
      const w = windowState(SEED.rooms[id].pilot, { day: 28 });
      expect(w.status).toBe('verified');
      expect(w.effect.method).toBe('before_after');
      expect(w.bookedCents).toBe(Math.max(0, w.effect.lowCents));
      return w.bookedCents;
    });
    expect(booked).toEqual([2197, 8690, 9423]);
  });

  test('controls change the estimate, in the direction the season pushed', () => {
    const oak = SEED.rooms.oakland.pilot, bk = SEED.rooms.berkeley.pilot;
    const ba = (p) => windowState(p, { day: 28 }).effect.pointCents;
    const did = (p) => windowState(p, { day: 28, controls: true }).effect.pointCents;
    expect(windowState(oak, { day: 28, controls: true }).effect.method).toBe('diff_in_diff');
    // Oakland's overtime was rising everywhere, so before/after understates; Berkeley's comps were falling everywhere, so it overstates.
    expect(did(oak)).toBeGreaterThan(ba(oak));
    expect(did(bk)).toBeLessThan(ba(bk));
  });

  test('the window runs, waits on a failing feed, and reverses on a guardrail breach', () => {
    const p = SEED.rooms.oakland.pilot;
    expect(windowState(p, { day: 0 }).effect.n).toBe(0);
    expect(windowState(p, { day: 21 }).status).toBe('running');
    expect(windowState(p, { day: 21 }).effect.n).toBe(3);
    expect(windowState(p, { day: 21, feedFailing: true }).status).toBe('waiting');
    expect(windowState(p, { day: 28, feedFailing: true }).status).toBe('waiting');
    expect(windowState(p, { day: 28, breach: true }).status).toBe('verified');
    expect(windowState(p, { day: 35, breach: true }).status).toBe('reversed');
    expect(windowState(p, { day: 35 }).status).toBe('verified');
  });

  test('guardrails hold on the sample weeks and trip at a 7% check drop', () => {
    for (const id of rooms) {
      const p = SEED.rooms[id].pilot;
      for (let wk = 0; wk < 5; wk++) expect(guardrailCheck(p, wk).ok, `${id} week ${wk}`).toBe(true);
      expect(guardrailCheck(p, 4, true).ok).toBe(false);
    }
  });
});

test('statusz is secret-free and turns not-ok when the worker stops', () => {
  expect(statusz()).toEqual({ ok: true, worker: { ok: true, lastBeatAt: expect.any(String) }, toast: { connections: 3, failing: 0 } });
  expect(statusz({ workerOk: false }).ok).toBe(false);
  expect(WORKER_JOBS.map((j) => j.queue)).toEqual(['heartbeat', 'toast-incremental-sync', 'toast-backfill', 'nightly-detection', 'daily-proof-loop', 'weekly-reverification']);
});
