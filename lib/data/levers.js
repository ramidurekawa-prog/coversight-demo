/**
 * The six Toast-fed levers, brought to "measured" — every figure from the
 * room's own observations (seed.levers), none from a typed constant. Pure JS
 * (no React); screens and tests import it. Each lever answers the same five
 * questions, the bars a lever must clear to count as working:
 *
 *   1. real data        — does it read the room's own observations?
 *   2. no made-up input — is every number in its dollar figure measured?
 *   3. measurable       — could a 28-day test prove the expected effect? (MDE)
 *   4. matched controls — is there an untouched comparison to subtract?
 *   5. books dollars    — does a verified test convert to $ a week?
 *
 * Methods (G-numbers from the September audit):
 *   G24 finding confidence · G21 minimum detectable effect · G19 matched
 *   controls · G12 measured service rate · G28 control-chart norm for voids
 *   and comps · G5 price sensitivity fitted from price history · G16 measured
 *   fill for table turns.
 */
import { t90 } from './pilot.js';

/* ------------------------------------------------------------------ shared */
const sum = (xs) => xs.reduce((a, x) => a + x, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);
const sd = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
};
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** G24. One rule for every finding's 0–100 confidence. 4/4 weeks → 100, 3/4 → 85, 2/4 → 70. */
export function findingConfidence({ periods, periodsHeld, observations, observationsNeeded, estimatedShare = 0, sourceCap = 100 }) {
  const stability = periods > 0 ? clamp01(periodsHeld / periods) : 0;
  const sample = observationsNeeded > 0 ? Math.min(1, Math.sqrt(Math.max(0, observations) / observationsNeeded)) : 1;
  const est = clamp01(estimatedShare);
  const raw = 100 * (0.4 + 0.6 * stability) * sample * (1 - 0.4 * est);
  return { confidence: Math.round(Math.min(sourceCap, raw)), stability, sample, estimatedShare: est };
}

/** One-sided 80% t (the power term), df 1–10. */
const T80 = [1.376, 1.061, 0.978, 0.941, 0.92, 0.906, 0.896, 0.889, 0.883, 0.879];
export const t80 = (df) => (df < 1 ? Infinity : df <= 10 ? T80[df - 1] : df <= 20 ? 0.86 : 0.845);

/** G21. Smallest true effect a window of n checkpoints proves four times in five: (t95 + t80) × σ/√n. */
export function minimumDetectableEffect({ baselineSamples, samplesPerCheckpoint = 1, checkpoints = 4 }) {
  const s = sd(baselineSamples);
  if (s === null || checkpoints < 2) return null;
  const checkpointSd = s / Math.sqrt(Math.max(1, samplesPerCheckpoint));
  return { mdeUnits: ((t90(checkpoints - 1) + t80(checkpoints - 1)) * checkpointSd) / Math.sqrt(checkpoints), checkpointSd };
}

/** G19. What the season did, scaled to the treated baseline (a ratio, so other roles or servers on another scale still count). */
export function controlDeltaFrom(treatedBaseline, controlBaseline, controlNow) {
  if (!(controlBaseline > 0) || !Number.isFinite(controlNow)) return null;
  return Math.round(treatedBaseline * (controlNow / controlBaseline - 1) * 100) / 100;
}

/** G12. Covers a server carries an hour: busy hours (≥ median covers), 90th percentile, ≥ 20 of them. */
export function measuredServiceRate(hours, minHours = 20) {
  const served = hours.filter((h) => h.covers > 0 && h.servers >= 0.5);
  if (!served.length) return null;
  const med = quantile(served.map((h) => h.covers), 0.5);
  const busy = served.filter((h) => h.covers >= med);
  if (busy.length < minHours) return null;
  return { coversPerServerHour: Math.round(quantile(busy.map((h) => h.covers / h.servers), 0.9) * 100) / 100, hoursUsed: busy.length };
}

/** G5. Constant-elasticity fit, log units on log price; needs two price changes. */
export function fitElasticity(points) {
  const usable = points.filter((p) => p.price > 0 && p.units > 0);
  let changes = 0;
  for (let i = 1; i < usable.length; i++) if (usable[i].price !== usable[i - 1].price) changes++;
  if (changes < 2 || new Set(usable.map((p) => p.price)).size < 2) return { ok: false, priceChanges: changes };
  const x = usable.map((p) => Math.log(p.price)), y = usable.map((p) => Math.log(p.units));
  const mx = mean(x), my = mean(y);
  const sxx = sum(x.map((v) => (v - mx) ** 2));
  const e = sum(x.map((v, i) => (v - mx) * (y[i] - my))) / sxx;
  const a = my - e * mx;
  const rss = sum(y.map((v, i) => (v - (a + e * x[i])) ** 2));
  const se = usable.length > 2 ? Math.sqrt(rss / (usable.length - 2) / sxx) : Infinity;
  return { ok: true, e, se, priceChanges: changes, n: usable.length };
}

/** G16. Share of full-room departures reseated within 15 minutes (someone was waiting); ≥ 20 departures. */
export const RESEAT_WAITING_MIN = 15;
/** An hour at 85% or more of the room's busiest hour counts as full (the platform's rule). */
export const FULL_SHARE = 0.85;
export function measuredFillPct(gaps) {
  if (gaps.length < 20) return null;
  return gaps.filter((g) => g !== null && g >= 0 && g <= RESEAT_WAITING_MIN).length / gaps.length;
}

/* ------------------------------------------------------------------ the levers */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const OT_PREMIUM_SHARE = 0.5; // the law's half-time premium, not an estimate

function overtime(L) {
  const [role, weeks] = Object.entries(L.ot).sort((a, b) => sum(b[1]) - sum(a[1]))[0];
  const held = weeks.filter((m) => m > 0).length;
  const perMin = (L.wage * OT_PREMIUM_SHARE) / 60;
  const weekly = mean(weeks) * perMin;
  const mde = minimumDetectableEffect({ baselineSamples: weeks });
  const others = Object.entries(L.ot).filter(([r]) => r !== role).some(([, w]) => sum(w) > 0);
  return {
    key: 'overtime', name: 'Overtime', scope: `${role === 'boh' ? 'Kitchen' : role === 'foh' ? 'Floor' : 'Bar'} overtime`,
    weekly, expectedUnits: mean(weeks) * 0.6, unit: 'min/wk', mde: mde?.mdeUnits ?? null,
    conf: findingConfidence({ periods: 4, periodsHeld: held, observations: weeks.length, observationsNeeded: 4 }),
    measured: true, controls: others, controlNote: others ? 'other roles’ overtime' : 'no other role works overtime',
    method: `${Math.round(mean(weeks))} OT min a week × ${'$'}${perMin.toFixed(2)}/min (the half-time premium)`,
  };
}

function labour(L) {
  const rate = measuredServiceRate(L.serviceHours);
  const cap = rate?.coversPerServerHour ?? null;
  const byDay = DAYS.map((day) => {
    const hrs = L.serviceHours.filter((h) => h.day === day);
    const idle = cap ? sum(hrs.map((h) => Math.max(0, h.servers - Math.ceil(h.covers / cap)))) / 4 : 0;
    return { day, idle, hrs };
  }).sort((a, b) => b.idle - a.idle);
  const top = byDay[0];
  const weeksHeld = [0, 1, 2, 3].filter((w) => top.hrs.filter((h) => h.week === w).some((h) => cap && h.servers > Math.ceil(h.covers / cap))).length;
  const perService = [0, 1, 2, 3].map((w) => sum(top.hrs.filter((h) => h.week === w).map((h) => h.servers)));
  const mde = minimumDetectableEffect({ baselineSamples: perService });
  return {
    key: 'labour', name: 'Labour overstaff', scope: `${top.day} dinner`,
    weekly: top.idle * L.wage, expectedUnits: top.idle, unit: 'server-h/wk', mde: mde?.mdeUnits ?? null,
    conf: findingConfidence({ periods: 4, periodsHeld: weeksHeld, observations: top.hrs.length, observationsNeeded: 8, estimatedShare: cap ? 0 : 0.5 }),
    measured: !!rate, controls: true, controlNote: `${top.day === 'Mon' ? 'Tue' : 'Mon'}–Sun dinners`,
    method: rate ? `${top.idle.toFixed(1)} idle server-hours a week at ${cap.toFixed(1)} covers/server (this room’s pace in its ${rate.hoursUsed} busiest hours)` : 'too few busy hours to measure the room’s pace',
    rate: cap,
  };
}

function voidComp(L) {
  const hist = L.voidWeeks.filter((r) => r.week < 8), recent = L.voidWeeks.filter((r) => r.week >= 8);
  const rateOf = (rows) => sum(rows.map((r) => r.exceptions)) / sum(rows.map((r) => r.sales));
  const pbar = rateOf(hist);
  const limit = (n, k) => pbar + k * Math.sqrt((pbar * (1 - pbar)) / Math.max(1, n));
  const servers = [...new Set(recent.map((r) => r.server))];
  const flagged = servers.filter((s) => {
    const mine = recent.filter((r) => r.server === s);
    return rateOf(mine) > limit(sum(mine.map((r) => r.checks)), 3);
  });
  const weeksOut = (rows) => [8, 9, 10, 11].filter((w) => {
    const wk = rows.filter((r) => r.week === w);
    return wk.length && rateOf(wk) > limit(sum(wk.map((r) => r.checks)), 2);
  }).length;
  const roomRate = rateOf(recent);
  const room = !flagged.length && roomRate > limit(sum(recent.map((r) => r.checks)), 3);
  const target = flagged.length ? recent.filter((r) => flagged.includes(r.server)) : room ? recent : [];
  const excess = target.length ? (rateOf(target) - pbar) * sum(target.map((r) => r.sales)) / 4 : 0;
  const weekly = [8, 9, 10, 11].map((w) => sum(target.filter((r) => r.week === w).map((r) => r.exceptions)));
  const mde = target.length ? minimumDetectableEffect({ baselineSamples: weekly }) : null;
  return {
    key: 'void_comp', name: 'Voids & comps', scope: flagged.length ? flagged.join(', ') : room ? 'Whole room' : 'Nothing above the limit',
    weekly: Math.max(0, excess), expectedUnits: excess * 0.7, unit: '$/wk', mde: mde?.mdeUnits ?? null,
    conf: target.length ? findingConfidence({ periods: 4, periodsHeld: weeksOut(target), observations: sum(target.map((r) => r.checks)), observationsNeeded: 160 * Math.max(1, flagged.length) }) : null,
    measured: true, controls: flagged.length > 0, controlNote: flagged.length ? 'the other servers' : room ? 'none: the whole room moved' : '—',
    method: `normal rate ${(pbar * 100).toFixed(1)}% of sales over the 8 weeks before; ${flagged.length ? `${flagged.length === 1 ? 'one server' : 'servers'} beyond the 3σ limit` : room ? `room at ${(roomRate * 100).toFixed(1)}%, beyond the limit` : 'everyone inside the limit'}`,
    found: target.length > 0,
  };
}

function menuMargin(room) {
  const L = room.levers;
  const food = room.menu.filter((m) => !m.balancing && m.cat === 'Food');
  const line = sum(food.map((m) => (m.price - m.cost) * m.units)) / sum(food.map((m) => m.units)); // weighted (M2)
  const cands = food
    .map((m) => ({ m, gap: line - (m.price - m.cost), fit: fitElasticity(L.priceHistory[m.key] ?? []) }))
    // A fit that says guests buy more at a higher price is noise, not a measurement.
    .filter((c) => c.gap > 0 && c.fit.ok && c.fit.e < 0)
    .map((c) => {
      const p1 = c.m.price + Math.min(c.gap, c.m.price * 0.1); // a rise of at most 10%
      const q1 = c.m.units * Math.pow(p1 / c.m.price, c.fit.e);
      return { ...c, p1, delta: (p1 - c.m.cost) * q1 - (c.m.price - c.m.cost) * c.m.units };
    })
    .filter((c) => c.delta > 0)
    .sort((a, b) => b.delta - a.delta);
  const best = cands[0];
  const dailyCm = best ? (L.priceHistory[best.m.key] ?? []).map((p) => (p.price - best.m.cost) * p.units) : [];
  const mde = best ? minimumDetectableEffect({ baselineSamples: dailyCm }) : null;
  return {
    key: 'menu_margin', name: 'Menu margin', scope: best ? `${best.m.name} → $${best.p1.toFixed(2)}` : 'No dish worth repricing',
    weekly: best?.delta ?? 0, expectedUnits: best?.delta ?? null, unit: '$/wk', mde: mde?.mdeUnits ?? null,
    conf: best ? findingConfidence({ periods: 8, periodsHeld: 8, observations: best.m.units * 4, observationsNeeded: 150 }) : null,
    measured: !!best, controls: food.length > 1, controlNote: 'the rest of the food menu',
    method: best ? `elasticity ${best.fit.e.toFixed(2)} fitted from ${best.fit.priceChanges} price changes; worth it after the plates it loses` : 'no dish under the line with enough price history',
    found: !!best,
  };
}

function mix(room) {
  const L = room.levers;
  const items = room.menu.filter((m) => !m.balancing && L.priceHistory[m.key]);
  // What the average plate earned in weeks 1–4 vs 5–8, at today's costs: a slide is mix, not price.
  const cmOver = (weeks) => {
    let cm = 0, units = 0;
    for (const m of items) for (const w of weeks) { const p = L.priceHistory[m.key][w]; cm += (m.price - m.cost) * p.units; units += p.units; }
    return { cm: cm / units, units: units / weeks.length };
  };
  const before = cmOver([0, 1, 2, 3]), now = cmOver([4, 5, 6, 7]);
  const slide = Math.max(0, before.cm - now.cm);
  const weeklyCm = [4, 5, 6, 7].map((w) => cmOver([w]).cm);
  const mde = minimumDetectableEffect({ baselineSamples: weeklyCm });
  return {
    key: 'mix', name: 'Mix shift', scope: 'Whole menu',
    weekly: slide * now.units, expectedUnits: slide, unit: '$/plate', mde: mde?.mdeUnits ?? null,
    conf: findingConfidence({ periods: 4, periodsHeld: weeklyCm.filter((c) => c < before.cm).length, observations: now.units * 4, observationsNeeded: 2000 }),
    measured: true, controls: false, controlNote: 'none: the whole menu changes together',
    method: slide > 0 ? `the average plate earns $${now.cm.toFixed(2)}, down $${slide.toFixed(2)} from the four weeks before, on ${Math.round(now.units)} plates a week` : `the average plate earns $${now.cm.toFixed(2)}, no slide from the four weeks before`,
    found: slide > 0,
  };
}

function turns(room, d) {
  const L = room.levers;
  const fill = measuredFillPct(L.reseatGaps);
  const fri = L.turns.filter((t) => t.fri).map((t) => t.min);
  const all = L.turns.map((t) => t.min);
  const meanTurn = mean(fri), target = quantile(all, 0.25);
  const items = room.menu.filter((m) => !m.balancing);
  const cmRate = sum(items.map((m) => (m.price - m.cost) * m.units)) / sum(items.map((m) => m.price * m.units));
  // Seatings a week and how often the room was full, both from the room's own service-hours.
  const friHours = L.serviceHours.filter((h) => h.day === 'Fri');
  const sessions = sum(friHours.map((h) => h.parties)) / 4;
  const peak = Math.max(...L.serviceHours.map((h) => h.covers));
  const fullPct = friHours.filter((h) => h.covers >= FULL_SHARE * peak).length / friHours.length;
  const check = room.pilot.guardrails.avgCheckBase;
  const extra = fill === null ? 0 : sessions * Math.max(0, 1 - target / meanTurn) * fullPct * fill;
  const mde = minimumDetectableEffect({ baselineSamples: fri, samplesPerCheckpoint: fri.length / 4 });
  return {
    key: 'turns', name: 'Table turns', scope: 'Fri dinner',
    weekly: extra * check * cmRate, expectedUnits: meanTurn - target, unit: 'min/turn', mde: mde?.mdeUnits ?? null,
    conf: fill === null ? null : findingConfidence({ periods: 4, periodsHeld: 4, observations: fri.length, observationsNeeded: 80, estimatedShare: 0.5 }),
    measured: fill !== null, controls: true, controlNote: 'the room’s other dinners',
    method: fill === null ? 'too few full-room departures to measure waiting' : `${Math.round(fill * 100)}% of tables reseated within ${RESEAT_WAITING_MIN} min when full; ${extra.toFixed(1)} extra parties × $${check.toFixed(0)} check × ${Math.round(cmRate * 100)}% left after food cost`,
    found: fill !== null,
  };
}

/** The five bars and a grade for one lever. */
function grade(l) {
  const bars = {
    data: true,
    measured: !!l.measured,
    measurable: l.mde === null ? null : Math.abs(l.expectedUnits ?? 0) >= l.mde,
    controls: !!l.controls,
    books: l.weekly > 0,
  };
  const score = Object.values(bars).filter((b) => b === true).length;
  // Nothing found is a result, not a failing lever: graded on what it could do.
  if (l.found === false) return { ...l, bars: { ...bars, measurable: null, books: null }, score, grade: 'Clear' };
  return { ...l, bars, score, grade: ['F', 'D', 'C', 'B', 'A−', 'A'][score] };
}

/** Every lever for one room, graded. */
export function leverReport(room, d = {}) {
  return [overtime(room.levers), labour(room.levers), voidComp(room.levers), menuMargin(room), mix(room), turns(room, d)].map(grade);
}
