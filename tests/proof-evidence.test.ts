// Honest Proof: missing evidence keeps a test pending (never filled in with
// the baseline), matched controls from the group's other rooms, and the three
// money figures kept apart.
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { guardrailCheck, proofStages, windowState } from '../lib/data/pilot.js';
import { readToastExports } from '../lib/data/toast.js';
import type { Db } from '../server/db/client';
import { testWindows, users } from '../server/db/schema';
import { commitInput, createSampleOrg } from '../server/org';
import { listWindows, runProofLoop, runReverify, startWindow } from '../server/proof';
import { freshDb } from './helpers/db';
import { toastFixture } from './helpers/toast-fixture.js';

/* ------------------------------------------------------------------ pure */
const GUARD = { avgCheck: { label: 'Average check', maxDropPct: 5 }, turn: { label: 'Turn time', maxRisePct: 15 } };
const pilot = (over: Record<string, unknown> = {}) => ({
  baseline: 240, direction: 'down', sign: -1, centsPerUnitWeek: 15, windowDays: 28, checkpointEvery: 7,
  checkpoints: [7, 14, 21, 28].map((day) => ({ day, observed: 0, controlDelta: null as number | null, services: 14 as number | null })),
  guardrails: { ...GUARD, avgCheckBase: 30, turnBase: 70, weekly: [0, 1, 2, 3, 4, 5].map(() => ({ avgCheck: 30 as number | null, turn: 70 as number | null })) },
  projectedCents: 3600,
  ...over,
});

describe('missing evidence keeps a test pending', () => {
  it('a guardrail week with no reading is missing, not passed', () => {
    const p = pilot();
    p.guardrails.weekly[4] = { avgCheck: null, turn: 70 };
    const g = guardrailCheck(p, 4);
    expect(g.ok).toBe(false);
    expect(g.missing).toBe(true);
    expect(g.failed).toBe(false);
    expect(g.rows[0]!.now).toBeNull();
  });

  it('closes as waiting (books $0) when the guardrail reading is missing, then verifies once it lands', () => {
    const p = pilot();
    p.guardrails.weekly[4] = { avgCheck: null, turn: null };
    const st = windowState(p, { day: 28 });
    expect(st.status).toBe('waiting');
    expect(st.waitingOn).toEqual(['guardrails']);
    expect(st.bookedCents).toBe(0);
    expect(st.stages.find((s: { key: string }) => s.key === 'verified')!.note).toMatch(/Pending: waiting on the guardrail readings/);
    p.guardrails.weekly[4] = { avgCheck: 30.5, turn: 69 };
    const later = windowState(p, { day: 28 });
    expect(later.status).toBe('verified');
    expect(later.bookedCents).toBeGreaterThan(0);
  });

  it('waits when the services behind the last week are unknown', () => {
    const p = pilot();
    p.checkpoints[3]!.services = null;
    const st = windowState(p, { day: 28 });
    expect(st.status).toBe('waiting');
    expect(st.waitingOn).toEqual(['services']);
  });

  it('a guardrail that is really outside its limit still rejects', () => {
    const p = pilot();
    p.guardrails.weekly[4] = { avgCheck: 27, turn: 70 };
    expect(windowState(p, { day: 28 }).status).toBe('rejected');
  });

  it('matched controls take the group-wide move off before the 5% floor', () => {
    const p = pilot();
    // Every room cut overtime the same way: the change itself did nothing.
    p.checkpoints.forEach((c) => { c.controlDelta = -240; });
    const st = windowState(p, { day: 28, controls: true });
    expect(st.effect.method).toBe('diff_in_diff');
    expect(st.status).toBe('rejected');
    expect(st.bookedCents).toBe(0);
  });

  it('keeps Projected, Measured and Verified apart; only Verified is savings', () => {
    const st = windowState(pilot(), { day: 28 });
    const [proj, meas, ver] = st.stages;
    expect([proj.label, meas.label, ver.label]).toEqual(['Projected', 'Measured', 'Verified savings']);
    expect([proj.claim, meas.claim, ver.claim]).toEqual(['mod', 'obs', 'book']);
    expect(proj.cents).toBe(3600);
    expect(meas.cents).toBe(240 * 15);
    expect(ver.cents).toBe(st.bookedCents);
    expect(proofStages({ status: 'running', effect: st.effect }).find((s) => s.key === 'verified')!.cents).toBe(0);
  });
});

/* ------------------------------------------------------------------ server */
let db: Db;
let orgId: string;
const v = () => ({ orgId, userId: 'u1', rooms: null });
beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});
const summary = (opts: Parameters<typeof toastFixture>[0]) => {
  const { unknown, ...s } = readToastExports(Object.entries(toastFixture(opts)).map(([name, text]) => ({ name, text })));
  return JSON.parse(JSON.stringify(s));
};
const load = (roomId: string, s: unknown) => commitInput(db, { ...v(), roomId, kind: 'toast', rows: [s] });
const cut = Date.UTC(2026, 9, 25);
const end = Date.UTC(2026, 10, 22);

describe('the weekly test runner with matched controls', () => {
  it('measures against the group’s other rooms when their own data covers the same weeks', async () => {
    await load('oakland', summary({}));
    await load('berkeley', summary({ seed: 11 }));
    await startWindow(db, v(), { roomId: 'oakland', lever: 'overtime' });
    await load('oakland', summary({ weeks: 17, end, otCut: cut }));
    await load('berkeley', summary({ weeks: 17, end, seed: 11 }));
    await runProofLoop(db, orgId, new Date('2026-11-23T12:00:00Z'));
    const [w] = await listWindows(db, orgId);
    expect(w!.checkpoints.every((c) => c.controlDelta != null)).toBe(true);
    expect(w!.controls).toEqual(['berkeley']);
    expect(w!.checkpoints.every((c) => c.services != null && c.services >= 5)).toBe(true);
    expect(w!.method).toBe('diff_in_diff');
    expect(w!.status).toBe('verified');
    expect(w!.stages.map((s: { key: string }) => s.key)).toEqual(['projected', 'measured', 'verified']);
  });

  it('does not credit the change when the control room improved just as much', async () => {
    await load('oakland', summary({}));
    await load('berkeley', summary({ seed: 11 }));
    await startWindow(db, v(), { roomId: 'oakland', lever: 'overtime' });
    await load('oakland', summary({ weeks: 17, end, otCut: cut }));
    await load('berkeley', summary({ weeks: 17, end, seed: 11, otCut: cut }));
    await runProofLoop(db, orgId, new Date('2026-11-23T12:00:00Z'));
    const [w] = await listWindows(db, orgId);
    expect(w!.status).toBe('rejected');
    expect(w!.bookedCents).toBe(0);
  });

  it('a room on sample figures is never used as a control', async () => {
    await load('oakland', summary({}));
    await startWindow(db, v(), { roomId: 'oakland', lever: 'overtime' });
    await load('oakland', summary({ weeks: 17, end, otCut: cut }));
    await runProofLoop(db, orgId, new Date('2026-11-23T12:00:00Z'));
    const [w] = await listWindows(db, orgId);
    expect(w!.controls).toEqual([]);
    expect(w!.method).toBe('before_after');
  });
});

describe('reverification with no reading', () => {
  it('leaves a verified result alone, and says it could not check, when the latest week has no own reading', async () => {
    await load('oakland', summary({}));
    const w = await startWindow(db, v(), { roomId: 'oakland', lever: 'overtime' });
    await load('oakland', summary({ weeks: 17, end, otCut: cut }));
    await runProofLoop(db, orgId, new Date('2026-11-23T12:00:00Z'));
    // A guardrail base of zero has no reading to compare: unknown, not a pass and not a breach.
    const g = (await db.select().from(testWindows).where(eq(testWindows.id, w.id)))[0]!.guard as Record<string, number>;
    await db.update(testWindows).set({ guard: { ...g, avgCheckBase: 0, turnBase: 0 } }).where(eq(testWindows.id, w.id));
    const res = await runReverify(db, orgId);
    expect(res.reversed).toEqual([]);
    expect(res.unchecked).toEqual([w.id]);
    expect((await listWindows(db, orgId))[0]!.status).toBe('verified');
  });
});
