/**
 * The rest of tonight's shift, from who has actually walked in.
 *
 * POS orders lag arrivals (a table orders 10 to 20 minutes after it's seated)
 * and can't tell a booked table from a walk-in. So when the host stand's
 * counts are on hand, Covercast forecasts the rest of the shift in two parts:
 *
 *   booked   covers still on the books from now on (as the bookings stood
 *            when the forecast was made) × the show rate, learned from past
 *            services and nudged by tonight's own show rate so far
 *   walk-ins the usual walk-in share of the plan from now on × tonight's
 *            walk-in pace, trusted more as the shift fills in
 *
 * With no host counts it falls back to the POS pace (livePace), and with
 * nothing live to the plan, saying which one it used. Arrival counts come
 * from a reservation or waitlist system when one is connected (placeholder
 * until partner access), or from the host's own tally typed in.
 *
 * Accuracy on arrivals can only be measured from logged services: each log
 * keeps the bookings and the plan as they stood at forecast time, the counts
 * at each check, and the final covers. Until 20 services are logged it says
 * it isn't validated yet, and never claims a gain it hasn't measured.
 */
import { score, quantile } from './engine.js';

export const MIN_LOGGED = 20;
/** Before any service is logged: a typical show rate and walk-in share, used only as a starting point and labelled so. */
export const STARTING = { showRate: 0.9, walkInShare: 0.35, kappa: 0.4 };
const sum = (a) => a.reduce((s, x) => s + x, 0);

/**
 * What the room's past logged services say: show rate (booked covers that came)
 * and walk-in share (walk-in covers of all covers), each shrunk toward the
 * starting value by how much evidence there is.
 * @param {any[]} logs  [{ date, service, booked, final: { covers, walkIns, bookedSeated } }]
 */
export function learnArrivals(logs = []) {
  const done = logs.filter((l) => l?.final?.covers > 0 && l.booked >= 0);
  const B = sum(done.map((l) => l.booked)), S = sum(done.map((l) => l.final.bookedSeated ?? Math.max(0, l.final.covers - (l.final.walkIns ?? 0))));
  const C = sum(done.map((l) => l.final.covers)), W = sum(done.map((l) => l.final.walkIns ?? 0));
  const shrink = (obs, n, prior, k) => (n > 0 ? (obs * n + prior * k) / (n + k) : prior);
  return {
    services: done.length,
    showRate: { value: B > 0 ? shrink(S / B, B, STARTING.showRate, 60) : STARTING.showRate, source: B >= 100 ? 'learned' : 'starting', bookedSeen: B },
    walkInShare: { value: C > 0 ? shrink(W / C, C, STARTING.walkInShare, 150) : STARTING.walkInShare, source: C >= 300 ? 'learned' : 'starting', coversSeen: C },
  };
}

/**
 * The rest of the shift from arrivals so far.
 * @param {{
 *   planRest: number, planSoFar: number, planTotal: number,
 *   seated: number, walkIns: number, bookedSeated?: number|null,
 *   bookedBefore?: number|null, bookedRest?: number|null,
 *   learned?: ReturnType<typeof learnArrivals>, q?: number[]|null,
 * }} p  plan = Covercast's expected covers (before / after now); booked* = from the bookings as they stood
 */
export function arrivalsForecast({ planRest, planSoFar, planTotal, seated, walkIns, bookedSeated = null, bookedBefore = null, bookedRest = null, learned = learnArrivals([]), q = null }) {
  const share = planTotal > 0 ? Math.min(1, planSoFar / planTotal) : 0;
  const trust = share / (share + STARTING.kappa);
  // Booked part: tonight's own show rate so far, blended with the learned one.
  let show = learned.showRate.value, showTonight = null;
  const bs = bookedSeated ?? Math.max(0, seated - walkIns);
  if (bookedBefore != null && bookedBefore >= 5) {
    showTonight = bs / bookedBefore;
    show = (showTonight * bookedBefore + learned.showRate.value * 30) / (bookedBefore + 30);
  }
  const booked = bookedRest != null ? Math.round(bookedRest * show) : null;
  // Walk-in part: the usual share of the plan ahead, at tonight's walk-in pace.
  const wShare = learned.walkInShare.value;
  const expectW = planSoFar * wShare;
  const pace = ((walkIns + 1) / (expectW + 1)) ** trust;
  let walk = planRest * wShare * pace;
  // Without the books, the booked part rides the same pace as tonight's covers.
  let rest;
  if (booked != null) rest = booked + walk;
  else {
    const all = ((seated + 1) / (planSoFar + 1)) ** trust;
    rest = planRest * all;
    walk = rest * wShare;
  }
  rest = Math.round(rest);
  const lo = q ? q[0] : 1 - 0.25 * (1 - share), hi = q ? q[1] : 1 + 0.25 * (1 - share);
  return {
    from: 'arrivals', soFar: seated, remaining: rest, total: seated + rest,
    range: [Math.round(rest * lo), Math.round(rest * hi)], measured: !!q,
    parts: {
      booked: booked == null ? null : { rest: booked, onBooks: bookedRest, showRate: Math.round(show * 100) / 100, showTonight: showTonight == null ? null : Math.round(showTonight * 100) / 100, source: learned.showRate.source },
      walkIns: { rest: Math.round(walk), soFar: walkIns, pace: Math.round((pace - 1) * 100), share: Math.round(wShare * 100), source: learned.walkInShare.source },
    },
    trust: Math.round(trust * 100),
  };
}

/**
 * Score the arrivals forecast on logged services, each check forecast only
 * from services logged before it. Against the plan (no update) and the
 * covers pace (the same pace the POS gives, from seated counts).
 * @param {any[]} logs  [{ date, service, booked, cuts: [{ at, seated, walkIns, bookedSeated?, bookedBefore?, bookedRest?, planSoFar, planRest }], final: { covers, walkIns?, bookedSeated? } }]
 */
export function backtestArrivals(logs = []) {
  const done = [...logs].filter((l) => l?.final?.covers > 0 && Array.isArray(l.cuts)).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (done.length < MIN_LOGGED) return { validated: false, services: done.length, need: MIN_LOGGED, why: `Log ${MIN_LOGGED} services with the host's counts (or a connected waitlist) to measure this. ${done.length} so far.` };
  const rows = [];
  done.forEach((l, i) => {
    const learned = learnArrivals(done.slice(0, i));
    for (const c of l.cuts) {
      if (!(c.planRest > 0)) continue;
      const actual = l.final.covers - c.seated;
      if (actual < 0) continue;
      const f = arrivalsForecast({ ...c, planTotal: c.planSoFar + c.planRest, learned });
      const pace = c.planSoFar > 0 ? c.seated / c.planSoFar : 1;
      rows.push({ actual, arrivals: f.remaining, plan: c.planRest, pace: c.planRest * pace, i });
    }
  });
  const half = Math.floor(done.length / 2);
  const ratios = rows.filter((r) => r.i < half && r.arrivals > 0).map((r) => r.actual / r.arrivals);
  const q = ratios.length >= 20 ? [quantile(ratios, 0.1), quantile(ratios, 0.9)] : null;
  const held = rows.filter((r) => r.i >= half);
  const inside = q ? held.filter((r) => r.actual >= r.arrivals * q[0] && r.actual <= r.arrivals * q[1]).length : null;
  return {
    validated: true, services: done.length, checks: rows.length,
    arrivals: score(rows, (r) => r.arrivals), plan: score(rows, (r) => r.plan), pace: score(rows, (r) => r.pace),
    q, coverage: inside == null || !held.length ? null : Math.round((inside / held.length) * 100),
  };
}
