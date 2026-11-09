/**
 * The live platform's proof loop, in the browser. A line-for-line port of the
 * monorepo's estimator (packages/engine/src/verification/effect.ts) and the
 * pilot's window rules, so the demo shows what the real platform computes
 * today rather than the finished product.
 *
 * Per checkpoint i the improvement-signed effect, in metric units, is
 *   d_i = s × (observed_i − baseline) − s × controlDelta_i
 * with s = +1 when up is better, −1 when down is better. With control
 * readings that is difference-in-differences; without, a before/after
 * against the frozen baseline. What gets booked is the lower bound of a
 * two-sided 90% Student-t interval, in whole cents a week, never below $0.
 *
 * Pure JS (no React): screens and tests import it.
 */

/** Two-sided 90% Student-t critical values, df = 1…30. */
const T90 = [
  6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761,
  1.753, 1.746, 1.74, 1.734, 1.729, 1.725, 1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701,
  1.699, 1.697,
];
export function t90(df) {
  if (df < 1) return Number.POSITIVE_INFINITY;
  return T90[Math.min(df, 30) - 1] ?? 1.645;
}

/**
 * @param {{ baselineValue: number, targetDirection: 'up' | 'down', centsPerUnitWeek: number | null,
 *           checkpoints: { observedValue: number, controlDelta?: number | null }[] }} inputs
 */
export function measureEffect(inputs) {
  const { checkpoints, centsPerUnitWeek } = inputs;
  const n = checkpoints.length;
  if (centsPerUnitWeek === null || !Number.isFinite(centsPerUnitWeek) || n === 0) {
    return { method: 'unmeasured', n, pointUnits: 0, lowUnits: 0, highUnits: 0, pointCents: 0, lowCents: 0, highCents: 0, bookableWeeklyCents: 0 };
  }
  const sign = inputs.targetDirection === 'up' ? 1 : -1;
  const withControl = checkpoints.every((c) => c.controlDelta != null);
  const d = checkpoints.map((c) => sign * (c.observedValue - inputs.baselineValue) - (withControl ? sign * (c.controlDelta ?? 0) : 0));
  const mean = d.reduce((s, x) => s + x, 0) / n;
  // One checkpoint has no spread to measure: book nothing rather than guess.
  const half = n < 2 ? Number.POSITIVE_INFINITY : t90(n - 1) * Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) / n);
  const lowUnits = mean - half;
  const highUnits = mean + half;
  const cents = (u) => (Number.isFinite(u) ? Math.round(u * centsPerUnitWeek) : 0);
  const lowCents = Number.isFinite(lowUnits) ? cents(lowUnits) : 0;
  return {
    method: withControl ? 'diff_in_diff' : 'before_after',
    n, pointUnits: mean, lowUnits, highUnits,
    pointCents: cents(mean), lowCents, highCents: cents(highUnits),
    bookableWeeklyCents: Math.max(0, lowCents),
  };
}

export const METHOD_LABEL = {
  before_after: 'Before/after against the frozen baseline',
  diff_in_diff: 'Difference-in-differences against matched controls',
  unmeasured: 'Not measured yet',
};

/** Gate 1's floor: a move counts once it is at least 5% of the baseline. */
export const MAGNITUDE_FLOOR_PCT = 5;
/** Gate 1 also needs at least 5 services compared at the last checkpoint. */
export const MIN_SERVICES = 5;

/** Improvement-signed move at one checkpoint, as % of the baseline. */
export function checkpointDeltaPct(pilot, c) {
  return (pilot.sign * (c.observed - pilot.baseline) / Math.abs(pilot.baseline)) * 100;
}

/** Weekly guardrail readings against the limits set at the first window. */
export function guardrailCheck(pilot, week, breach = false) {
  const g = pilot.guardrails;
  const r = g.weekly[Math.min(week, g.weekly.length - 1)];
  const avgCheck = breach ? Math.round(g.avgCheckBase * 0.93 * 100) / 100 : r.avgCheck;
  const checkPct = ((avgCheck - g.avgCheckBase) / g.avgCheckBase) * 100;
  const turnPct = ((r.turn - g.turnBase) / g.turnBase) * 100;
  const rows = [
    { key: 'avgCheck', label: g.avgCheck.label, base: g.avgCheckBase, now: avgCheck, pct: checkPct, limit: `may not fall more than ${g.avgCheck.maxDropPct}%`, ok: checkPct > -g.avgCheck.maxDropPct, unit: '$' },
    { key: 'turn', label: g.turn.label, base: g.turnBase, now: r.turn, pct: turnPct, limit: `may not rise more than ${g.turn.maxRisePct}%`, ok: turnPct < g.turn.maxRisePct, unit: 'min' },
  ];
  return { rows, ok: rows.every((x) => x.ok) };
}

/**
 * The window as the daily proof loop sees it on a given day since Start.
 * Days 0–28 run the window; day 35 is the first weekly reverification after
 * it closes.
 * @param {object} pilot the room's seed.pilot
 * @param {{ day: number, controls?: boolean, breach?: boolean, feedFailing?: boolean }} opts
 */
export function windowState(pilot, { day, controls = false, breach = false, feedFailing = false }) {
  const recorded = pilot.checkpoints.filter((c) => c.day <= day);
  const effect = measureEffect({
    baselineValue: pilot.baseline,
    targetDirection: pilot.direction,
    centsPerUnitWeek: pilot.centsPerUnitWeek,
    checkpoints: recorded.map((c) => ({ observedValue: c.observed, controlDelta: controls ? c.controlDelta : null })),
  });
  const deltas = recorded.map((c) => checkpointDeltaPct(pilot, c));
  const trailing = deltas.slice(-2);
  const last = recorded[recorded.length - 1];
  const closed = day >= pilot.windowDays;
  const week = Math.floor(day / 7);
  /* The verdict uses the readings up to the close; a breach after it is the weekly reverification's to catch. */
  const guardAtClose = guardrailCheck(pilot, Math.min(week, pilot.windowDays / 7), false);
  const guard = guardrailCheck(pilot, week, breach && day > pilot.windowDays);
  const gates = [
    {
      key: 'magnitude', label: 'Moved enough, for long enough',
      ok: trailing.length === 2 && trailing.every((x) => x >= MAGNITUDE_FLOOR_PCT) && !!last && last.services >= MIN_SERVICES,
      pending: trailing.length < 2,
      detail: trailing.length < 2 ? `${recorded.length} of 2 checkpoints needed` : `last two moves ${trailing.map((x) => `${x.toFixed(1)}%`).join(' and ')} vs a ${MAGNITUDE_FLOOR_PCT}% floor · ${last.services} services`,
    },
    { key: 'data', label: 'Feed healthy through the window', ok: !feedFailing, pending: feedFailing, detail: feedFailing ? 'Toast sync failing; the window waits rather than fails' : 'Toast synced every 15 minutes' },
    { key: 'guardrails', label: 'No guardrail failed', ok: guardAtClose.ok, pending: false, detail: guardAtClose.ok ? 'average check and turn time inside their limits' : 'a guardrail is outside its limit' },
    {
      key: 'window', label: 'Watched the full window', ok: closed && recorded.length >= pilot.windowDays / pilot.checkpointEvery, pending: !closed,
      detail: `day ${Math.min(day, pilot.windowDays)} of ${pilot.windowDays} · ${recorded.length} of ${pilot.windowDays / pilot.checkpointEvery} checkpoints`,
    },
  ];
  let status = 'running';
  /* A feed that can't be read records no checkpoint: the proof loop retries the window rather than failing it. */
  if (feedFailing) status = 'waiting';
  else if (closed) status = gates.every((g) => g.ok) ? 'verified' : 'rejected';
  if (status === 'verified' && !guard.ok) status = 'reversed';
  const bookedCents = status === 'verified' ? effect.bookableWeeklyCents : 0;
  return { day, recorded, effect, deltas, gates, guard, status, bookedCents, nextCheckpoint: pilot.checkpoints.find((c) => c.day > day) || null };
}

/* ------------------------------------------------------------------ worker and health
   The real worker's queues and schedules (apps/worker), and what /statusz
   returns. Times are UTC in the platform; shown here on the room's clock. */
export const WORKER_JOBS = [
  { queue: 'heartbeat', schedule: 'Every minute', what: 'Stamps the worker alive; /statusz turns 503 after 5 minutes without one', last: '7:14 pm' },
  { queue: 'toast-incremental-sync', schedule: 'Every 15 minutes', what: 'Pulls new orders and clock-ins from each connected Toast restaurant', last: '7:00 pm' },
  { queue: 'toast-backfill', schedule: 'On connect', what: 'Pulls 13 weeks of history once, then hands over to the incremental sync', last: 'Sep 14' },
  { queue: 'nightly-detection', schedule: 'Daily, 2:00 am', what: 'Refreshes rollups, then runs the seven detectors', last: '2:00 am' },
  { queue: 'daily-proof-loop', schedule: 'Daily, 4:00 am', what: 'Records due checkpoints and closes windows that reached day 28', last: '4:00 am' },
  { queue: 'weekly-reverification', schedule: 'Mondays, 3:00 am', what: 'Checks average check and turn time against each room\'s guardrails; a breach reverses', last: 'Mon 3:00 am' },
];

/** What /statusz returns for a group: secret-free, platform-wide counts only. */
export function statusz({ workerOk = true, rooms = 3, failing = 0 } = {}) {
  return {
    ok: workerOk,
    worker: { ok: workerOk, lastBeatAt: workerOk ? '2026-10-28T02:14:00.000Z' : '2026-10-28T02:03:00.000Z' },
    toast: { connections: rooms, failing },
  };
}

/** Toast's own error text for each way a connect check fails, as the platform shows it. */
export const TOAST_ERRORS = {
  secret: 'Toast rejected the client ID or secret. Re-copy the secret (Toast shows it once) or create new credentials.',
  host: 'Couldn’t reach that API host. Use the hostname shown on the Toast credentials page.',
  guid: 'Can’t access this restaurant: these credentials don’t cover it, or the orders or labor scope is missing.',
};
