/**
 * Covercast: Coversight's demand forecast. Covers and sales for every day,
 * week, service (lunch, dinner), hour and 15 minutes ahead, from the room's
 * own history, with a range that says how sure it is.
 *
 * How it works, in order:
 *  1. Six methods each forecast every day (methods.js), from the room's own
 *     days only.
 *  2. Each method is scored on the room's recent days the way it would have
 *     been used (forecast made h days ahead, nothing after the origin seen),
 *     and weighted by 1 / error². Methods that have been wrong lately count
 *     for less, per room, per figure and per horizon.
 *  3. A slow bias check nudges the blend when it has been running high or low
 *     (shrunk, and capped at ±15%).
 *  4. Days that aren't normal days are handled on their own: holidays (from
 *     the calendar) and events take the room's own past effect for that day;
 *     closures are zero; rain, reservations and events add what the room's
 *     history says they're worth, or the manager's own estimate, labelled.
 *  5. The range is the room's own recent misses (10th to 90th percentile of
 *     actual ÷ forecast), so "80% of days land inside" is measured, not assumed.
 *  6. Days split into services, hours and 15-minute slots by the weekday's
 *     recent shape, so every level adds up to the day.
 *  7. During service, the rest of the day is re-forecast from covers so far,
 *     trusting the pace more as more of the day is in (tuned on past days).
 *
 * Everything here is pure: the browser and the server run the same code.
 */
import { addDays, daysBetween, holidayOn, isIso, wdOf, WEEKDAYS } from './calendar.js';
import { METHODS, METHOD_KEYS, median, methodForecasts, sameWeekday } from './methods.js';

export const ENGINE = 'Covercast';
export const VERSION = 'covercast-1';
export const TUNING = {
  minHistory: 28, // days before any forecast is made
  weightWindow: 56, // recent scored days that set the weights
  weightPower: 3, // weight = 1 / error^power
  trim: 0, // off: tried 1.05–1.3 (a method that far behind the best gets no weight); it never beat plain 1/error³ weighting
  specialShrink: 1, // until a room has enough special days to measure it: pull a learned effect halfway to none after one sighting
  minScored: 14, // a method needs this many scored days to get a weight
  biasWindow: 28,
  biasShrink: 30,
  biasCap: 0.15,
  rangeWindow: 91,
  minRange: 20, // scored days before the range is calibrated
  quantiles: [0.1, 0.9],
  evalDays: 182, // days in the accuracy report
  warmDays: 120,
  maxHorizon: 14,
  kappas: [0, 0.03, 0.06, 0.1, 0.2, 0.4, 1, 1e9], // intraday pace trust, tuned per room
};
/** Lunch is every hour before 4 pm, dinner from 4 pm (the same split as the Service page). */
export const SHIFTS = [{ key: 'lunch', label: 'Lunch', from: 0, to: 16 }, { key: 'dinner', label: 'Dinner', from: 16, to: 24 }];
export const shiftOf = (hour) => (hour >= 16 ? 'dinner' : 'lunch');

const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => sum(a) / a.length;
function quantile(a, q) {
  const s = [...a].sort((x, y) => x - y);
  const p = (s.length - 1) * q, i = Math.floor(p);
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (p - i);
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const roundTo = (metric) => (metric === 'covers' ? (x) => Math.round(x) : (x) => Math.round(x));

/* ------------------------------------------------------------ the days */

/**
 * The contiguous run of days the methods read, from the first day of history
 * to `through` (or the last day), plus `ahead` future days.
 * @param {{ iso: string, covers?: number|null, net?: number|null }[]} days
 * @param {'covers'|'net'} metric
 * @param {{ ahead?: number, special?: Map<string, { kind: string, key: string, label: string }>, closed?: Set<string>, through?: string }} [opt]
 */
export function buildDays(days, metric, { ahead = 0, special = new Map(), closed = new Set(), through } = {}) {
  const rows = days.filter((d) => isIso(d.iso)).sort((a, b) => (a.iso < b.iso ? -1 : 1));
  if (!rows.length) return { D: [], last: -1 };
  const val = new Map(rows.map((d) => [d.iso, d[metric]]));
  const first = rows[0].iso, end = through ?? rows.at(-1).iso;
  const n = daysBetween(first, end) + 1;
  const D = [];
  for (let i = 0; i < n + ahead; i++) {
    const iso = addDays(first, i);
    const raw = i < n ? val.get(iso) : null;
    const v = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null; // no sales = closed or missing, never zero
    const hol = holidayOn(iso);
    const sp = special.get(iso) ?? (hol ? { kind: 'holiday', key: hol.key, label: hol.name } : null);
    D.push({ iso, wd: wdOf(iso), v: closed.has(iso) ? null : v, skip: !!sp || closed.has(iso), special: sp, closed: closed.has(iso) });
  }
  return { D, last: n - 1 };
}

const logRatio = (D, i) => {
  const base = sameWeekday(D, i - 1, i, 8);
  return base.length >= 3 && D[i].v != null ? Math.log(D[i].v / median(base)) : null;
};
const PRIOR = new WeakMap();
/**
 * How far to trust one sighting of a special day on this room (empirical
 * Bayes): plain-day noise σ² against how much this room's special days
 * really move, τ² (their spread beyond the noise). A room whose holidays look
 * like any other day gets its effects pulled almost to none; one whose
 * holidays swing hard keeps nearly all of what it saw.
 */
function specialPrior(D, o) {
  if (!PRIOR.has(D)) PRIOR.set(D, new Map());
  const memo = PRIOR.get(D);
  const key = o >> 3; // close enough within a week
  if (memo.has(key)) return memo.get(key);
  const plain = [], special = [];
  for (let i = Math.max(7, o - 364); i <= o; i++) {
    if (D[i].closed || D[i].v == null) continue;
    if (D[i].special) { const r = logRatio(D, i); if (r != null) special.push(r); }
    else if (i > o - 182) { const r = logRatio(D, i); if (r != null) plain.push(r); }
  }
  let k = TUNING.specialShrink;
  if (plain.length >= 28 && special.length >= 3) {
    const sigma2 = sum(plain.map((x) => x * x)) / plain.length;
    const tau2 = Math.max(1e-4, sum(special.map((x) => x * x)) / special.length - sigma2);
    k = clamp(sigma2 / tau2, 0.02, 50);
  }
  memo.set(key, k);
  return k;
}

/** The room's own past effect of a special day (holiday or named event): actual ÷ what a normal day would have been, shrunk toward none by how much this room's special days really move. */
export function specialEffect(D, o, key) {
  const r = [];
  for (let i = 7; i <= o; i++) {
    if (D[i].special?.key !== key) continue;
    const x = logRatio(D, i);
    if (x != null) r.push(x);
  }
  if (!r.length) return null;
  return { mult: Math.exp(sum(r) / (r.length + specialPrior(D, o))), seen: r.length };
}

/* -------------------------------------------------------- the ensemble */

/**
 * One forecast from the methods' numbers and the scored days before it.
 * `past` holds scored days (actual known, target on or before the origin), oldest first.
 */
export function blend(f, past) {
  const weights = {};
  for (const k of METHOD_KEYS) {
    if (f[k] == null) continue;
    let err = 0, act = 0, n = 0;
    for (let j = past.length - 1; j >= 0 && n < TUNING.weightWindow; j--) {
      const p = past[j];
      if (p.special || p.f[k] == null) continue;
      err += Math.abs(p.actual - p.f[k]); act += p.actual; n++;
    }
    if (n >= TUNING.minScored && act > 0) weights[k] = 1 / Math.max(err / act, 0.01) ** TUNING.weightPower;
  }
  // Methods well behind the best lately sit out (they only add noise).
  if (TUNING.trim) {
    const best = Math.max(...Object.values(weights));
    for (const k of Object.keys(weights)) if (weights[k] < best / TUNING.trim ** TUNING.weightPower) delete weights[k];
  }
  let keys = Object.keys(weights), scored = true;
  if (!keys.length) { keys = METHOD_KEYS.filter((k) => f[k] != null); scored = false; keys.forEach((k) => { weights[k] = 1; }); }
  if (!keys.length) return null;
  const W = sum(keys.map((k) => weights[k]));
  const raw = sum(keys.map((k) => weights[k] * f[k])) / W;
  // Bias: has the blend been running high or low lately?
  const logs = [];
  for (let j = past.length - 1; j >= 0 && logs.length < TUNING.biasWindow; j--) {
    const p = past[j];
    if (p.special || !p.raw) continue;
    logs.push(Math.log(p.actual / p.raw));
  }
  const bias = logs.length ? clamp(Math.exp((sum(logs) / logs.length) * (logs.length / (logs.length + TUNING.biasShrink))), 1 - TUNING.biasCap, 1 + TUNING.biasCap) : 1;
  // Range: the room's own recent misses.
  const ratios = [];
  for (let j = past.length - 1; j >= 0 && ratios.length < TUNING.rangeWindow; j--) {
    const p = past[j];
    if (p.special || !p.final) continue;
    ratios.push(p.actual / p.final);
  }
  const calibrated = ratios.length >= TUNING.minRange;
  const q = calibrated ? TUNING.quantiles.map((x) => quantile(ratios, x)) : [0.7, 1.3];
  return {
    raw, bias, final: raw * bias, q, calibrated, scored,
    weights: Object.fromEntries(keys.map((k) => [k, Math.round((weights[k] / W) * 1000) / 1000])),
  };
}

/**
 * Forecast every day in [tFrom, tTo] made h days ahead, in date order, each
 * blended only from scored days its origin could have known. This is the
 * backtest and also how the live forecast learns its weights.
 */
export function walk(D, h, tFrom, tTo) {
  const out = [];
  let ready = 0; // out[0..ready) have target <= current origin
  for (let t = Math.max(tFrom, TUNING.minHistory + h); t <= tTo; t++) {
    const o = t - h;
    while (ready < out.length && out[ready].t <= o) ready++;
    const f = methodForecasts(D, o, t);
    const b = blend(f, out.slice(0, ready).filter((p) => p.actual != null));
    if (!b) continue;
    let final = b.final;
    const sp = D[t].special;
    if (D[t].closed) final = 0;
    else if (sp) { const e = specialEffect(D, o, sp.key); if (e) final *= e.mult; }
    out.push({ t, iso: D[t].iso, h, f, actual: D[t].v, special: !!sp || D[t].closed, raw: b.raw, final, q: b.q, calibrated: b.calibrated });
  }
  return out;
}

/* ---------------------------------------------------- accuracy (backtest) */

/** Sum |actual − forecast| ÷ sum actual, MAPE, bias and range coverage over scored rows. */
export function score(rows, pick) {
  const ok = rows.filter((r) => r.actual != null && pick(r) != null);
  if (!ok.length) return null;
  const A = sum(ok.map((r) => r.actual));
  const E = sum(ok.map((r) => Math.abs(r.actual - pick(r))));
  const B = sum(ok.map((r) => pick(r) - r.actual));
  return {
    n: ok.length,
    wape: Math.round((E / A) * 10000) / 100,
    mape: Math.round(mean(ok.map((r) => Math.abs(r.actual - pick(r)) / r.actual)) * 10000) / 100,
    bias: Math.round((B / A) * 10000) / 100,
  };
}

/**
 * The accuracy report for one room and figure: Covercast against the current
 * method and each method alone, a day ahead and a week ahead, over the last
 * `evalDays` days, plus week totals and how often the range held.
 */
export function backtestDays(days, metric, { evalDays = TUNING.evalDays, special, closed } = {}) {
  const { D, last } = buildDays(days, metric, { special, closed });
  if (last < TUNING.minHistory + 14) return null;
  const evalFrom = Math.max(TUNING.minHistory + 14, last - evalDays + 1);
  const from = Math.max(0, evalFrom - TUNING.warmDays);
  const byH = {};
  for (let h = 1; h <= 7; h++) byH[h] = walk(D, h, from, last);
  const inEval = (r) => r.t >= evalFrom;
  const horizons = {};
  for (const h of [1, 7]) {
    const rows = byH[h].filter(inEval);
    const normal = rows.filter((r) => !r.special);
    horizons[h] = {
      covercast: score(rows, (r) => r.final),
      normalDays: { covercast: score(normal, (r) => r.final), current: score(normal, (r) => r.f.current) },
      specialDays: { covercast: score(rows.filter((r) => r.special), (r) => r.final), current: score(rows.filter((r) => r.special), (r) => r.f.current) },
      current: score(rows, (r) => r.f.current),
      methods: Object.fromEntries(METHOD_KEYS.map((k) => [k, score(normal, (r) => r.f[k])])),
      coverage: (() => {
        const c = normal.filter((r) => r.calibrated && r.actual != null);
        return c.length ? Math.round((c.filter((r) => r.actual >= r.final * r.q[0] && r.actual <= r.final * r.q[1]).length / c.length) * 1000) / 10 : null;
      })(),
      rangeWidth: (() => {
        const c = normal.filter((r) => r.calibrated);
        return c.length ? Math.round(mean(c.map((r) => r.q[1] - r.q[0])) * 1000) / 10 : null;
      })(),
    };
  }
  // Weeks, Monday to Sunday, forecast the Sunday before.
  const at = Object.fromEntries(Object.entries(byH).map(([h, rows]) => [h, new Map(rows.map((r) => [r.t, r]))]));
  const weeks = [];
  for (let s = evalFrom; s + 6 <= last; s++) {
    if (D[s].wd !== 1) continue;
    const parts = [0, 1, 2, 3, 4, 5, 6].map((d) => at[d + 1].get(s + d));
    if (parts.some((p) => !p || p.f.current == null)) continue;
    const actual = sum(parts.map((p) => p.actual ?? 0));
    if (!(actual > 0)) continue;
    weeks.push({ start: D[s].iso, actual, final: sum(parts.map((p) => p.final)), current: sum(parts.map((p) => (p.actual == null ? 0 : p.f.current))) });
  }
  return {
    metric, through: D[last].iso, from: D[evalFrom].iso, days: last - evalFrom + 1,
    horizons,
    week: { covercast: score(weeks, (w) => w.final), current: score(weeks, (w) => w.current), n: weeks.length },
  };
}

/* --------------------------------------------------- shapes within a day */

/** hours → Map(iso → Map(hour → value)) for one figure. */
function byDay(rows, key, field) {
  const m = new Map();
  for (const r of rows || []) {
    if (!m.has(r.iso)) m.set(r.iso, new Map());
    const d = m.get(r.iso);
    d.set(r[key], (d.get(r[key]) ?? 0) + (r[field] || 0));
  }
  return m;
}

/**
 * The share of a day that falls in each slot (hour or 15 minutes) on this
 * weekday: the last eight same weekdays with detail before `iso`, recent
 * weeks weighted most. Null with fewer than two such days.
 * @param {Map<string, Map<number, number>>} detail
 */
export function shapeFor(detail, iso, { skip = new Set(), n = 8 } = {}) {
  const shares = new Map();
  let used = 0, W = 0;
  for (let k = 1; k <= 12 && used < n; k++) {
    const d = addDays(iso, -7 * k);
    const m = detail.get(d);
    if (!m || skip.has(d)) continue;
    const tot = sum([...m.values()]);
    if (!(tot > 0)) continue;
    const w = 0.5 ** (used / 4);
    for (const [s, v] of m) shares.set(s, (shares.get(s) ?? 0) + (w * v) / tot);
    W += w; used++;
  }
  if (used < 2) return null;
  const out = new Map([...shares].sort((a, b) => a[0] - b[0]).map(([s, v]) => [s, v / W]));
  return { shares: out, days: used };
}

/** The usual hour (the pages' current way): the mean of up to 8 recent same weekdays. */
function usualSlots(detail, iso) {
  const nights = [];
  for (let k = 1; k <= 12 && nights.length < 8; k++) { const m = detail.get(addDays(iso, -7 * k)); if (m && sum([...m.values()]) > 0) nights.push(m); }
  if (nights.length < 2) return null;
  const keys = new Set(nights.flatMap((m) => [...m.keys()]));
  return new Map([...keys].sort((a, b) => a - b).map((s) => [s, mean(nights.map((m) => m.get(s) ?? 0))]));
}

/**
 * Hour and service accuracy, a day ahead: Covercast (the day's blend split by
 * the weekday's shape) against the usual hour, on the same hours. Then the
 * rest of the day re-forecast during service, the pace trust tuned on the
 * first half of the days and scored on the second.
 */
export function backtestHours(days, hours, metric, { special, closed } = {}) {
  const field = metric === 'covers' ? 'covers' : 'sales';
  const detail = byDay(hours, 'hour', field);
  const isos = [...detail.keys()].sort();
  if (isos.length < 21) return null;
  const { D, last } = buildDays(days, metric, { special, closed });
  const idx = new Map(D.map((d, i) => [d.iso, i]));
  const firstT = idx.get(isos[0]) ?? 0;
  const rows = walk(D, 1, Math.max(0, firstT - TUNING.warmDays), last);
  const dayF = new Map(rows.map((r) => [r.iso, r]));
  const skip = new Set(D.filter((d) => d.skip).map((d) => d.iso));
  const cells = { hour: [], shift: [] };
  const tests = [];
  for (const iso of isos) {
    const r = dayF.get(iso);
    const shape = shapeFor(detail, iso, { skip });
    const usual = usualSlots(detail, iso);
    const act = detail.get(iso);
    if (!r || !shape || !usual || !act || skip.has(iso)) continue;
    const hrs = [...new Set([...act.keys(), ...shape.shares.keys(), ...usual.keys()])].sort((a, b) => a - b);
    const fc = new Map(hrs.map((h) => [h, r.final * (shape.shares.get(h) ?? 0)]));
    for (const h of hrs) cells.hour.push({ actual: act.get(h) ?? 0, final: fc.get(h), current: usual.get(h) ?? 0 });
    for (const s of SHIFTS) {
      const pick = (m) => sum(hrs.filter((h) => h >= s.from && h < s.to).map((h) => m.get(h) ?? 0));
      cells.shift.push({ shift: s.key, actual: pick(act), final: pick(fc), current: pick(usual) });
    }
    tests.push({ iso, hrs, act, fc, usual, day: r.final });
  }
  const pos = (rows) => rows.filter((c) => c.actual > 0 || c.final > 0);
  const out = { metric, days: tests.length };
  for (const k of ['hour', 'shift']) {
    out[k] = { covercast: score(pos(cells[k]), (c) => c.final), current: score(pos(cells[k]), (c) => c.current) };
  }
  out.byShift = Object.fromEntries(SHIFTS.map((s) => {
    const c = cells.shift.filter((x) => x.shift === s.key);
    return [s.key, { covercast: score(c, (x) => x.final), current: score(c, (x) => x.current) }];
  }));
  // Intraday: re-forecast the rest of the day at each cut.
  const cuts = [12, 15, 18, 19];
  const half = Math.floor(tests.length / 2);
  const remaining = (t, cut, kappa) => {
    const before = t.hrs.filter((h) => h < cut), after = t.hrs.filter((h) => h >= cut);
    const A = sum(before.map((h) => t.act.get(h) ?? 0));
    const E = sum(before.map((h) => t.fc.get(h)));
    const R = sum(after.map((h) => t.fc.get(h)));
    const actual = sum(after.map((h) => t.act.get(h) ?? 0));
    const share = t.day > 0 ? E / t.day : 0;
    const w = kappa >= 1e9 ? 0 : share / (share + kappa || 1);
    const covercast = R * ((A + 1) / (E + 1)) ** w;
    const C = sum(before.map((h) => t.usual.get(h) ?? 0));
    const current = (C > 0 ? A / C : 1) * sum(after.map((h) => t.usual.get(h) ?? 0));
    return { actual, covercast, current, prior: R };
  };
  const tune = tests.slice(0, half), hold = tests.slice(half);
  out.intraday = Object.fromEntries(cuts.map((cut) => {
    let best = TUNING.kappas[0], bestE = Infinity;
    for (const k of TUNING.kappas) {
      const e = sum(tune.map((t) => { const x = remaining(t, cut, k); return Math.abs(x.actual - x.covercast); }));
      if (e < bestE) { bestE = e; best = k; }
    }
    const rs = hold.map((t) => remaining(t, cut, best)).filter((x) => x.actual > 0);
    const ratios = rs.filter((x) => x.covercast > 0).map((x) => x.actual / x.covercast);
    return [cut, {
      kappa: best,
      covercast: score(rs, (x) => x.covercast), current: score(rs, (x) => x.current), noUpdate: score(rs, (x) => x.prior),
      q: ratios.length >= 10 ? TUNING.quantiles.map((p) => Math.round(quantile(ratios, p) * 1000) / 1000) : null,
    }];
  }));
  return out;
}

/* ------------------------------------------------------- the live forecast */

/** Spread an hour into four 15-minute slots by the slope of the hours around it (when no order times exist). */
function quartersFromHours(hourly) {
  const hs = [...hourly.keys()].sort((a, b) => a - b);
  const out = [];
  for (const h of hs) {
    const v = hourly.get(h);
    const prev = hourly.get(h - 1) ?? v, next = hourly.get(h + 1) ?? v;
    const w = [0, 1, 2, 3].map((q) => Math.max(0.0001, q < 2 ? v + ((prev - v) * (1.5 - q)) / 4 : v + ((next - v) * (q - 1.5)) / 4));
    const W = sum(w);
    w.forEach((x, q) => out.push({ min: h * 60 + q * 15, value: (v * x) / W }));
  }
  return out;
}

const fmtPct = (m) => `${m >= 1 ? '+' : '−'}${Math.round(Math.abs(m - 1) * 100)}%`;

/**
 * The forecast from today on: every day for `days` days (each with services
 * and hours, and 15-minute slots for the first), the weeks they make up, and
 * what each number rests on.
 * @param {{ days: any[], hours?: any[], quarters?: any[] }} series
 * @param {'covers'|'net'} metric
 * @param {{ today: string, days?: number, signals?: any, rate?: number|null }} opt
 */
export function forecast(series, metric, { today, days: span = 14, signals = {}, rate = null }) {
  const sig = normalizeSignals(signals);
  const history = series.days.filter((d) => d.iso < today);
  const through = history.length ? history.at(-1).iso : null;
  if (!through) return { engine: ENGINE, version: VERSION, metric, ready: false, why: 'No days on file yet. Connect Toast or enter a few days by hand.', days: [], weeks: [] };
  const special = new Map(sig.events.map((e) => [e.date, { kind: 'event', key: `event:${e.name.toLowerCase()}`, label: e.name }]));
  const closed = new Set(sig.closures);
  const ahead = daysBetween(through, today) - 1 + span;
  const { D, last } = buildDays(history, metric, { ahead, special, closed, through });
  if (last + 1 < TUNING.minHistory) {
    return { engine: ENGINE, version: VERSION, metric, ready: false, why: `Covercast needs ${TUNING.minHistory} days of history; ${last + 1} on file.`, need: TUNING.minHistory, have: last + 1, days: [], weeks: [] };
  }
  const round = roundTo(metric);
  const field = metric === 'covers' ? 'covers' : 'sales';
  const hourly = byDay(series.hours, 'hour', field);
  const quarterly = byDay(series.quarters, 'min', field);
  const skip = new Set(D.filter((d) => d.skip).map((d) => d.iso));
  const learned = learnSignals(D, last, sig, history);
  // Scored days at each horizon up to a week (beyond a week, the week's weights).
  const walks = {};
  for (let h = 1; h <= 7; h++) walks[h] = walk(D, h, Math.max(0, last - TUNING.warmDays - TUNING.rangeWindow), last).filter((r) => r.actual != null);
  const out = [];
  for (let t = last + 1; t < D.length; t++) {
    const iso = D[t].iso;
    if (iso < today) continue;
    const h = t - last;
    const f = methodForecasts(D, last, t);
    const b = blend(f, walks[Math.min(h, 7)]);
    if (!b) continue;
    const adj = [];
    let value = b.final, widen = 1;
    if (D[t].closed) { value = 0; adj.push({ kind: 'closed', label: 'Closed (entered by you)', mult: 0, source: 'manual' }); }
    const sp = D[t].special;
    if (sp && !D[t].closed) {
      const e = specialEffect(D, last, sp.key);
      if (e) { value *= e.mult; adj.push({ kind: sp.kind, label: `${sp.label}: ${fmtPct(e.mult)} on past ${sp.kind === 'holiday' ? 'years' : 'times'}`, mult: e.mult, source: 'learned', seen: e.seen }); }
      else {
        const ev = sp.kind === 'event' ? sig.events.find((x) => x.date === iso) : null;
        if (ev?.lift != null) { value *= 1 + ev.lift / 100; adj.push({ kind: 'event', label: `${sp.label}: ${fmtPct(1 + ev.lift / 100)} (your estimate)`, mult: 1 + ev.lift / 100, source: 'manual' }); }
        else adj.push({ kind: sp.kind, label: `${sp.label}: no past ${sp.kind === 'holiday' ? 'year' : 'time'} on file to learn from, so not adjusted`, mult: 1, source: 'none' });
        widen = 1.5;
      }
    }
    const wx = sig.weather.find((w) => w.date === iso);
    if (wx && !D[t].closed) {
      if (wx.rainIn >= 0.1 && learned.rain) { value *= learned.rain.mult; adj.push({ kind: 'weather', label: `Rain forecast: ${fmtPct(learned.rain.mult)} on past rainy days`, mult: learned.rain.mult, source: 'learned', seen: learned.rain.seen }); }
      else if (wx.rainIn >= 0.1) adj.push({ kind: 'weather', label: `Rain forecast, but too few rainy days on file to know its effect (${learned.rainSeen} of ${RAIN_MIN})`, mult: 1, source: 'none' });
    }
    const book = sig.reservations.filter((r) => r.date === iso).sort((a, b) => (a.asOf < b.asOf ? 1 : -1))[0];
    if (book && metric === 'covers' && !D[t].closed) {
      const lead = daysBetween(book.asOf, iso);
      const p = learned.pickup(lead);
      if (p) {
        const pick = book.covers * p.mult;
        adj.push({ kind: 'reservations', label: `${book.covers} booked; booked days like this finish at ${p.mult.toFixed(2)}× bookings`, mult: (0.5 * value + 0.5 * pick) / value, source: 'learned', seen: p.seen });
        value = 0.5 * value + 0.5 * pick;
      } else if (book.covers > value) {
        adj.push({ kind: 'reservations', label: `${book.covers} already booked, more than the forecast, so raised to bookings`, mult: book.covers / value, source: book.source });
        value = book.covers;
      } else adj.push({ kind: 'reservations', label: `${book.covers} booked so far`, mult: 1, source: book.source });
    }
    const lowM = 1 - (1 - b.q[0]) * widen, highM = 1 + (b.q[1] - 1) * widen;
    const day = {
      iso, weekday: WEEKDAYS[D[t].wd], horizon: h,
      value: round(value), low: round(value * lowM), high: round(value * highM),
      calibrated: b.calibrated && widen === 1,
      methods: Object.fromEntries(METHOD_KEYS.map((k) => [k, f[k] == null ? null : round(f[k])])),
      weights: b.weights, bias: Math.round(b.bias * 1000) / 1000, adjustments: adj,
      shifts: /** @type {any} */ (null), hours: /** @type {any[] | null} */ (null), quarters: /** @type {any[] | null} */ (null),
    };
    // Services and hours from the weekday's shape.
    const shape = shapeFor(hourly, iso, { skip });
    if (shape && value > 0) {
      const hrs = [...shape.shares].map(([hour, s]) => {
        const v = value * s;
        const need = rate ? Math.max(1, Math.ceil(v / rate)) : null;
        return { hour, value: round(v), low: round(v * lowM), high: round(v * highM), servers: v > 0.5 && need ? need : v > 0.5 ? null : 0, serversHigh: rate && v > 0.5 ? Math.max(1, Math.ceil((v * highM) / rate)) : null };
      });
      day.hours = hrs;
      day.shapeDays = shape.days;
      day.shifts = Object.fromEntries(SHIFTS.map((s) => {
        const v = value * sum([...shape.shares].filter(([hh]) => hh >= s.from && hh < s.to).map(([, x]) => x));
        return [s.key, { value: round(v), low: round(v * lowM), high: round(v * highM) }];
      }));
      if (out.length === 0) {
        const qShape = shapeFor(quarterly, iso, { skip });
        day.quarters = qShape
          ? [...qShape.shares].map(([min, s]) => ({ min, value: Math.round(value * s * 10) / 10 }))
          : quartersFromHours(new Map([...shape.shares].map(([hh, s]) => [hh, value * s]))).map((q) => ({ min: q.min, value: Math.round(q.value * 10) / 10 }));
        day.quartersFrom = qShape ? 'orders' : 'hours';
      }
    }
    out.push(day);
  }
  // Weeks (Monday to Sunday) that the forecast fully covers.
  const weeks = [];
  for (let i = 0; i + 6 < out.length; i++) {
    if (WEEKDAYS.indexOf(out[i].weekday) !== 1) continue;
    const part = out.slice(i, i + 7);
    weeks.push({ start: part[0].iso, value: sum(part.map((d) => d.value)), low: sum(part.map((d) => d.low)), high: sum(part.map((d) => d.high)), note: 'Range adds up each day’s range, so it’s wider than a week usually swings.' });
  }
  return {
    engine: ENGINE, version: VERSION, metric, ready: true, through, today,
    history: { days: last + 1, from: D[0].iso, withHours: hourly.size, withQuarters: quarterly.size, sources: [...new Set(history.map((d) => d.source))] },
    learned: { rain: learned.rain, rainSeen: learned.rainSeen, pickupPairs: learned.pickupPairs },
    days: out, weeks,
  };
}

/**
 * Re-forecast the rest of today from the covers (or sales) so far. The pace
 * counts for more as more of the day's usual business is in; kappa sets how
 * fast (from backtestHours, else a middle setting).
 * @param {{ value: number, low: number, high: number, hours: { hour: number, value: number }[] | null }} day  today’s forecast
 * @param {Map<number, number> | Record<number, number> | number} soFar  actual by hour (complete hours), or a total since fromHour
 * @param {{ nowHour: number, fromHour?: number, kappa?: number, q?: number[] | null }} opt
 */
export function reforecast(day, soFar, { nowHour, fromHour = 0, kappa = 0.1, q = null }) {
  if (!day?.hours?.length) return null;
  const get = (h) => (soFar instanceof Map ? soFar.get(h) : soFar?.[h]) ?? 0;
  const before = day.hours.filter((x) => x.hour >= fromHour && x.hour < nowHour), after = day.hours.filter((x) => x.hour >= nowHour);
  // soFar is covers by hour, or one total since fromHour (a manager's count).
  const A = typeof soFar === 'number' ? soFar : sum(before.map((x) => get(x.hour)));
  const E = sum(before.map((x) => x.value));
  const share = day.value > 0 ? E / day.value : 0;
  const w = share / (share + kappa || 1);
  const factor = ((A + 1) / (E + 1)) ** w;
  const rest = after.map((x) => ({ hour: x.hour, value: Math.round(x.value * factor) }));
  const R = sum(rest.map((x) => x.value));
  const qq = q ?? [1 - (1 - day.low / Math.max(1, day.value)) * (1 - share), 1 + (day.high / Math.max(1, day.value) - 1) * (1 - share)];
  return {
    soFar: A, expectedSoFar: Math.round(E), pace: E > 0 ? Math.round((A / E - 1) * 100) : null, trust: Math.round(w * 100),
    rest, restTotal: R, restLow: Math.round(R * qq[0]), restHigh: Math.round(R * qq[1]),
    total: A + R, low: A + Math.round(R * qq[0]), high: A + Math.round(R * qq[1]),
  };
}

/* ------------------------------------------------------------- signals */

export const RAIN_MIN = 5;
/**
 * What a manager entered or a feed sent, cleaned:
 *  events [{ date, name, lift? (% they expect), by? }], closures [date],
 *  weather [{ date, rainIn, tempF?, source }], reservations [{ date, covers, asOf, source }].
 */
export function normalizeSignals(s = {}) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return {
    events: arr(s.events).filter((e) => isIso(e?.date) && typeof e.name === 'string' && e.name.trim()).map((e) => ({ date: e.date, name: e.name.trim(), lift: n(e.lift), by: e.by ?? null })),
    closures: arr(s.closures).filter(isIso),
    weather: arr(s.weather).filter((w) => isIso(w?.date) && n(w.rainIn) != null).map((w) => ({ date: w.date, rainIn: n(w.rainIn), tempF: n(w.tempF), source: w.source ?? 'manual' })),
    reservations: arr(s.reservations).filter((r) => isIso(r?.date) && n(r.covers) != null && isIso(r.asOf)).map((r) => ({ date: r.date, covers: Math.round(n(r.covers)), asOf: r.asOf, source: r.source ?? 'manual' })),
  };
}

/** What the room's own past says rain and bookings are worth. */
function learnSignals(D, last, sig, history) {
  const idx = new Map(D.map((d, i) => [d.iso, i]));
  const ratioAt = (iso) => {
    const i = idx.get(iso);
    if (i == null || i > last || D[i].v == null) return null;
    const base = sameWeekday(D, i - 1, i, 8);
    return base.length >= 3 ? D[i].v / median(base) : null;
  };
  const wet = [], dry = [];
  for (const w of sig.weather) { const r = ratioAt(w.date); if (r != null && !D[idx.get(w.date)].skip) (w.rainIn >= 0.1 ? wet : dry).push(r); }
  let rain = null;
  if (wet.length >= RAIN_MIN && dry.length >= 3 * RAIN_MIN) {
    const e = median(wet) / median(dry);
    rain = { mult: Math.exp(Math.log(e) * (wet.length / (wet.length + 5))), seen: wet.length };
  }
  const actual = new Map(history.map((d) => [d.iso, d.covers]));
  const pairs = sig.reservations.filter((r) => actual.get(r.date) > 0 && r.covers > 0).map((r) => ({ lead: daysBetween(r.asOf, r.date), ratio: actual.get(r.date) / r.covers }));
  const bucket = (l) => (l <= 1 ? 0 : l <= 3 ? 1 : l <= 7 ? 2 : 3);
  return {
    rain, rainSeen: wet.length, pickupPairs: pairs.length,
    pickup: (lead) => {
      const p = pairs.filter((x) => bucket(x.lead) === bucket(lead));
      return p.length >= 6 ? { mult: median(p.map((x) => x.ratio)), seen: p.length } : null;
    },
  };
}

export { METHODS };
