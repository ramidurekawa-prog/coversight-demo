/**
 * Covercast for the Service page: each service (lunch, dinner)
 * hour by hour and 15 minutes at a time, the servers it needs at the forecast
 * and at the top of its measured range, and the rest of a live service
 * re-forecast from the covers so far.
 *
 * It replaces three simple rules the page used to run on:
 *  - the plan:  the mean of 4 recent same weekdays per hour, servers sized to
 *               the busiest of them;
 *  - the live:  tonight's raw pace × that mean, trusted fully from the first
 *               hour;
 *  - the band:  the worst miss over those 4 nights, the same in every hour.
 * Covercast's day forecast (seven methods, blended by their record) split by
 * the weekday's measured shape, a pace that earns trust as the service fills
 * in (tuned per service and cut on the room's own past), and ranges measured
 * from its own misses per service. `backtestShiftPulse` scores both on the
 * same days, no lookahead.
 */
import { addDays } from './calendar.js';
import { costPoint } from './decisions.js';
import { buildDays, byDay, quantile, score, shapeFor, TUNING, usualSlots, walk } from './engine.js';

export const SERVICES = {
  lunch: { key: 'lunch', label: 'Lunch', from: 0, to: 16, cuts: [12, 13] },
  dinner: { key: 'dinner', label: 'Dinner', from: 16, to: 24, cuts: [18, 19, 20] },
};
export const serviceOfHour = (hour) => (hour >= 16 ? 'dinner' : 'lunch');
/** Recent same weekdays the old plan averaged (the page's COMPARABLE_WEEKS). */
export const OLD_WEEKS = 4;
const SLOT = 15;
/** The point of Covercast's hour misses that servers are sized to (80% of hours need no more). */
export const STAFF_PCT = 0.8;
/** Points tried when sizing by cost. */
export const STAFF_POINTS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
const sum = (a) => a.reduce((s, x) => s + x, 0);
const r1 = (x) => Math.round(x * 10) / 10;
const need = (v, rate) => (v > 0.5 ? Math.max(1, Math.ceil(v / rate)) : 0);
const inService = (s) => (h) => h >= SERVICES[s].from && h < SERVICES[s].to;

/**
 * One service of a forecast day, by hour: covers, the measured range and the
 * servers it needs (`servers` at the forecast, `serversHigh` at the range's
 * top, the one a cut must clear) and `serversPlan` (sized to the point of
 * its misses backtestShiftPulse measured as both safer and leaner than the
 * busiest recent week). `report` is backtestShiftPulse's; without one, the
 * day's range is used and rangeFrom says so.
 * @param {any} day  a day from forecast(…, 'covers')
 * @param {'lunch'|'dinner'} service
 * @param {{ rate?: number|null, report?: any }} [opt]
 */
export function servicePlanOf(day, service, { rate = null, report = null, costs = null } = {}) {
  const q = report?.q?.[service] ?? null;
  const st = report?.staffing?.[service] ?? null;
  // Sized by cost when the room has set what a short hour and an idle hour cost it.
  const point = costPoint(costs);
  const byCost = point != null && st?.curve?.length ? st.curve.reduce((a, b) => (Math.abs(b.p - point) < Math.abs(a.p - point) ? b : a)) : null;
  const size = byCost?.size ?? st?.size ?? null;
  if (!day?.hours?.length) return null;
  const hrs = day.hours.filter((h) => inService(service)(h.hour) && h.value > 0);
  if (!hrs.length) return null;
  const lo = q ? q[0] : day.value ? day.low / day.value : 1, hi = q ? q[1] : day.value ? day.high / day.value : 1;
  const hours = hrs.map((h) => ({
    hour: h.hour, covers: h.value, low: Math.round(h.value * lo), high: Math.round(h.value * hi),
    servers: rate ? need(h.value, rate) : null, serversHigh: rate ? need(h.value * hi, rate) : null,
    serversPlan: rate ? need(h.value * (size ?? hi), rate) : null,
  }));
  const s = day.shifts?.[service];
  return {
    service, iso: day.iso, weekday: day.weekday, rate, rangeFrom: q ? 'service' : 'day',
    sizedBy: byCost ? { by: 'cost', point: byCost.p } : { by: 'default', point: STAFF_PCT },
    covers: s?.value ?? sum(hours.map((h) => h.covers)), low: s?.low ?? null, high: s?.high ?? null,
    hours, drivers: day.drivers, calibrated: day.calibrated,
  };
}

/** A service's 15-minute curve from a forecast day, over a window (minutes after midnight). */
export function quarterCurve(day, { start, end }) {
  const slots = Math.max(0, Math.round((end - start) / SLOT));
  const out = Array(slots).fill(0);
  const qs = day?.quarters?.length ? day.quarters : null;
  if (qs) for (const x of qs) { const i = Math.floor((x.min - start) / SLOT); if (i >= 0 && i < slots) out[i] += x.value; }
  else for (const h of day?.hours || []) for (let k = 0; k < 4; k++) { const i = Math.floor((h.hour * 60 + k * SLOT - start) / SLOT); if (i >= 0 && i < slots) out[i] += h.value / 4; }
  return out.map(r1);
}

/** The tuned setting for a live moment: the latest cut at or before it. */
function tunedFor(live, service, nowMin) {
  const cuts = SERVICES[service].cuts.filter((c) => c * 60 <= nowMin);
  const c = cuts.length ? cuts.at(-1) : SERVICES[service].cuts[0];
  return live?.[service]?.[c] ?? null;
}

/**
 * The rest of a live service, 15 minutes at a time. `curve` is Covercast's
 * expected covers per slot from the window's start, `actual` the covers in the
 * complete slots so far. The pace counts for more as more of the service's
 * usual business is in (trust); the range is the room's measured range at
 * this point of the service. Shaped like the page's pacing() so it drops in.
 * @param {{ curve: number[], actual: number[], now: number, service: 'lunch'|'dinner', start: number, tuned?: any }} p
 */
export function livePace({ curve, actual, now, service, start, tuned = null }) {
  const k = Math.max(0, Math.min(now, curve.length, actual.length));
  const so = sum(actual.slice(0, k)), E = sum(curve.slice(0, k)), total = sum(curve);
  const t = tuned ?? tunedFor(null, service, start + k * SLOT);
  const kappa = t?.kappa ?? 0.15;
  const share = total > 0 ? E / total : 0;
  const trust = share / (share + kappa || 1);
  const raw = E > 0 ? so / E : 1;
  const factor = ((so + 1) / (E + 1)) ** trust;
  const rest = sum(curve.slice(k));
  const remaining = Math.round(rest * factor);
  const q = t?.q ?? null;
  const lo = q ? q[0] : 1 - 0.3 * (1 - share), hi = q ? q[1] : 1 + 0.3 * (1 - share);
  const spread = Math.round(Math.max(1 - lo, hi - 1, 0.05) * 1000) / 1000;
  return {
    so, cmp: Math.round(E), now: k, factor, rawPace: Math.round((raw - 1) * 100), pace: Math.round((factor - 1) * 100), trust: Math.round(trust * 100),
    spread, remaining, range: [Math.round(rest * factor * lo), Math.round(rest * factor * hi)], measured: !!q,
  };
}

/** The tuned trust and range for a live moment, from backtestShiftPulse's `live`. */
export const liveTuning = (report, service, nowMin) => tunedFor(report?.live, service, nowMin);

/**
 * A live service's pace on Covercast, the one calculation Service and Today
 * both show: tonight's covers against Covercast's curve for this date, with its
 * tuned trust. Null when Covercast has no curve for the date (the page then
 * says so or falls back to its own rule, never a made-up number).
 * @param {any} cc  covercastRoom(…) or the server's forecast
 * @param {string} date
 * @param {{ actual: number[], now: number, start: number, slots: number, service?: 'lunch'|'dinner', atMin?: number }} at
 */
export function covercastPace(cc, date, { actual, now, start, slots, service = 'dinner', atMin }) {
  const day = cc?.covers?.days?.find((d) => d.iso === date) ?? null;
  if (!day) return null;
  const curve = quarterCurve(day, { start, end: start + slots * SLOT });
  if (!curve.some((x) => x > 0)) return null;
  const tuned = liveTuning(cc.shiftPulse, service, atMin ?? start + now * SLOT);
  return { comp: curve, ...livePace({ curve, actual, now, service, start, tuned }), engine: 'Covercast' };
}

/**
 * The Service page's accuracy on a room: Covercast against the page's old rules,
 * on the same past days, per service.
 *  plan:     covers per hour, a day ahead (WAPE)
 *  staffing: at the room's covers per server-hour, the hours that turned out
 *            short (more servers needed than planned) and the server-hours
 *            planned beyond what was needed; old = sized to the busiest of 4
 *            weeks, Covercast = sized to the 80th point of its own misses
 *  live:     the rest of the service from each cut (WAPE), trust tuned on the
 *            first half of the days and scored on the second, with the range
 *            measured there
 * @param {{ days: any[], hours: any[] }} series
 * @param {{ rate?: number|null, special?: Map<string, any>, closed?: Set<string> }} [opt]
 */
export function backtestShiftPulse(series, { rate = null, special, closed } = {}) {
  const detail = byDay(series.hours, 'hour', 'covers');
  const isos = [...detail.keys()].sort();
  if (isos.length < 21) return null;
  const { D, last } = buildDays(series.days, 'covers', { special, closed });
  const idx = new Map(D.map((d, i) => [d.iso, i]));
  const firstT = idx.get(isos[0]) ?? 0;
  const dayF = new Map(walk(D, 1, Math.max(0, firstT - TUNING.warmDays), last).map((r) => [r.iso, r]));
  const skip = new Set(D.filter((d) => d.skip).map((d) => d.iso));
  const tests = [];
  for (const iso of isos.slice(-TUNING.evalDays)) {
    const r = dayF.get(iso), act = detail.get(iso);
    const shape = shapeFor(detail, iso, { skip });
    const old = usualSlots(detail, iso, OLD_WEEKS);
    if (!r || !shape || !old || !act || skip.has(iso)) continue;
    const back = [1, 2, 3, 4].map((k) => detail.get(addDays(iso, -7 * k))).filter(Boolean);
    const hrs = [...new Set([...act.keys(), ...shape.shares.keys(), ...old.keys()])].sort((a, b) => a - b);
    const fc = new Map(hrs.map((h) => [h, r.final * (shape.shares.get(h) ?? 0)]));
    const peak = new Map(hrs.map((h) => [h, Math.max(0, ...back.map((m) => m.get(h) ?? 0))]));
    tests.push({ iso, hrs, act, fc, old, peak, day: r.final, back });
  }
  if (tests.length < 20) return null;
  const half = Math.floor(tests.length / 2);
  const tune = tests.slice(0, half), hold = tests.slice(half);
  const out = { days: tests.length, scoredFrom: hold[0].iso, rate, plan: {}, staffing: {}, live: {}, liveScore: {}, q: {} };
  for (const s of /** @type {const} */ (['lunch', 'dinner'])) {
    const keep = inService(s);
    const cells = (ts) => ts.flatMap((t) => t.hrs.filter(keep).map((h) => ({ actual: t.act.get(h) ?? 0, cc: t.fc.get(h), old: t.old.get(h) ?? 0, peak: t.peak.get(h) })))
      .filter((c) => c.actual > 0 || c.cc > 0.5);
    const all = cells(tests);
    if (all.length < 30) continue;
    out.plan[s] = { covercast: score(all, (c) => c.cc), old: score(all, (c) => c.old) };
    // The hour range, measured on the first half; its top sizes the servers on the second.
    const ratios = cells(tune).filter((c) => c.cc > 1 && c.actual > 0).map((c) => c.actual / c.cc);
    const q = ratios.length >= 30 ? TUNING.quantiles.map((p) => Math.round(quantile(ratios, p) * 1000) / 1000) : null;
    out.q[s] = q;
    const heldCells = cells(hold);
    if (q) {
      const inside = heldCells.filter((c) => c.actual >= c.cc * q[0] && c.actual <= c.cc * q[1]).length;
      out.plan[s].coverage = Math.round((inside / heldCells.length) * 100);
    }
    if (rate && q) {
      const staff = (plan) => {
        let short = 0, spare = 0, hours = 0;
        for (const c of heldCells) {
          const needed = need(c.actual, rate), planned = plan(c);
          hours++;
          if (needed > planned) short++;
          spare += Math.max(0, planned - needed);
        }
        return { hours, shortHours: short, spareServerHours: spare };
      };
      // Servers are sized to the 80th point of Covercast's own hour misses (first half):
      // on the sample that is both safer and leaner than the busiest of 4 weeks.
      const fit = cells(tune).filter((c) => c.cc > 1 && c.actual > 0).map((c) => c.actual / c.cc);
      const size = Math.round(quantile(fit, STAFF_PCT) * 1000) / 1000;
      // Every sizing point, for sizing by cost (decisions.js): the size from the first half,
      // and the short and idle hours it gave on the second.
      const curve = STAFF_POINTS.map((pp) => { const sz = Math.round(quantile(fit, pp) * 1000) / 1000; return { p: pp, size: sz, ...staff((c) => need(c.cc * sz, rate)) }; });
      out.staffing[s] = { size, covercast: staff((c) => need(c.cc * size, rate)), old: staff((c) => need(c.peak, rate)), curve };
    }
    // Live: the rest of the service from each cut.
    out.live[s] = {}; out.liveScore[s] = {};
    const from = SERVICES[s].from;
    for (const cut of SERVICES[s].cuts) {
      const at = (t, kappa) => {
        const before = t.hrs.filter((h) => keep(h) && h < cut), after = t.hrs.filter((h) => keep(h) && h >= cut);
        const A = sum(before.map((h) => t.act.get(h) ?? 0));
        const E = sum(before.map((h) => t.fc.get(h)));
        const total = E + sum(after.map((h) => t.fc.get(h)));
        const R = sum(after.map((h) => t.fc.get(h)));
        const share = total > 0 ? E / total : 0;
        const w = share / (share + kappa || 1);
        const C = sum(before.map((h) => t.old.get(h) ?? 0));
        return {
          actual: sum(after.map((h) => t.act.get(h) ?? 0)),
          covercast: R * ((A + 1) / (E + 1)) ** w,
          old: (C > 0 ? A / C : 1) * sum(after.map((h) => t.old.get(h) ?? 0)),
          started: A + E > 0 && from <= cut,
        };
      };
      let best = TUNING.kappas[0], bestE = Infinity;
      for (const k of TUNING.kappas) {
        const e = sum(tune.map((t) => { const x = at(t, k); return x.actual > 0 ? Math.abs(x.actual - x.covercast) : 0; }));
        if (e < bestE) { bestE = e; best = k; }
      }
      const tuneRows = tune.map((t) => at(t, best)).filter((x) => x.actual > 0 && x.covercast > 0);
      const lq = tuneRows.length >= 10 ? TUNING.quantiles.map((p) => Math.round(quantile(tuneRows.map((x) => x.actual / x.covercast), p) * 1000) / 1000) : null;
      const rows = hold.map((t) => at(t, best)).filter((x) => x.actual > 0);
      // The old band: the worst of the last 4 nights' misses, the same in every hour.
      out.live[s][cut] = { kappa: best, q: lq };
      const inside = lq ? rows.filter((x) => x.actual >= x.covercast * lq[0] && x.actual <= x.covercast * lq[1]).length : null;
      out.liveScore[s][cut] = { covercast: score(rows, (x) => x.covercast), old: score(rows, (x) => x.old), coverage: inside == null ? null : Math.round((inside / rows.length) * 100) };
    }
  }
  return out;
}

/**
 * A day's services for the Service page from a room's Covercast (covercastRoom):
 * lunch and dinner plans, and the measured record behind them.
 * @param {any} cc  covercastRoom(…)
 * @param {string} iso
 * @param {{ costs?: any }} [opt]
 */
export function shiftPulseDay(cc, iso, { costs = cc?.costs ?? null } = {}) {
  const day = cc?.covers?.days?.find((d) => d.iso === iso) ?? null;
  if (!day) return null;
  const report = cc.shiftPulse ?? null;
  return {
    engine: 'Covercast', iso, weekday: day.weekday, value: day.value, low: day.low, high: day.high, drivers: day.drivers,
    lunch: servicePlanOf(day, 'lunch', { rate: cc.rate, report, costs }),
    dinner: servicePlanOf(day, 'dinner', { rate: cc.rate, report, costs }),
  };
}
