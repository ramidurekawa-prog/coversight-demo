/**
 * Forecasts are for decisions: how many servers, how much to prep. This file
 * turns a forecast and its measured misses into the decision that costs the
 * least, and keeps the record that shows whether following it actually paid.
 *
 *  - Sizing by cost: staff or prep to the point of the forecast's own misses
 *    where one more unit costs as much as it saves (the classic newsvendor
 *    rule). An idle server-hour costs the wage; a short one costs what the
 *    room says it does (guests lost, slower tables). A portion prepped and
 *    not sold costs its food cost; one short costs its margin.
 *  - The pilot ledger: per service, what Covercast recommended, what the
 *    manager would usually have done, what was actually done, and what
 *    happened (waste, stockouts, labor cost, ticket times). The verdict
 *    compares nights that followed Covercast with nights that didn't, and
 *    stays "collecting" until each side has enough nights. Figures from the
 *    backtest are labelled Simulated; only logged outcomes are Observed.
 */

export const MIN_PER_ARM = 10;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

/**
 * The point of the misses to size at: cost of being one short ÷ (that + cost of one too many).
 * @param {{ shortHour?: number|null, idleHour?: number|null } | null} costs
 */
export function costPoint(costs) {
  const cs = costs?.shortHour, ci = costs?.idleHour;
  if (!(cs > 0) || !(ci > 0)) return null;
  return Math.max(0.5, Math.min(0.95, cs / (cs + ci)));
}

/**
 * Simulated staffing cost on the backtest (Service page record): each sizing
 * point's short and idle hours on days it wasn't fit on, priced at the room's
 * costs, against the old rule (sized to the busiest of 4 weeks).
 * @param {any} staffing  backtestShiftPulse(...).staffing[service]
 * @param {{ shortHour: number, idleHour: number }} costs
 */
export function staffingCost(staffing, costs) {
  if (!staffing?.curve?.length || !(costs?.shortHour > 0) || !(costs?.idleHour > 0)) return null;
  const price = (x) => Math.round(x.shortHours * costs.shortHour + x.spareServerHours * costs.idleHour);
  const point = costPoint(costs);
  const at = staffing.curve.reduce((a, b) => (Math.abs(b.p - point) < Math.abs(a.p - point) ? b : a));
  return {
    claim: 'Simulated', point: at.p, hours: at.hours,
    covercast: { shortHours: at.shortHours, idleHours: at.spareServerHours, cost: price(at) },
    old: { shortHours: staffing.old.shortHours, idleHours: staffing.old.spareServerHours, cost: price(staffing.old) },
    saved: price(staffing.old) - price(at),
    note: 'Priced on past days the sizing wasn’t fit on, at the costs entered. A pilot shows whether it holds.',
  };
}

/**
 * Prep per item, sized by cost: the forecast units × the point of the item
 * forecast's misses where waste and running out cost the same. With no
 * price or cost on file, the 75th point, said so.
 * @param {{ item: string, forecast: number, price?: number|null, cost?: number|null }[]} items
 * @param {number[]} ratios  actual ÷ forecast on past item-days (prep task misses)
 */
export function prepPlan(items, ratios = []) {
  const sorted = [...ratios].filter(Number.isFinite).sort((a, b) => a - b);
  const at = (p) => (sorted.length >= 20 ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : 1 + (p - 0.5) * 0.6);
  return items.map((it) => {
    const margin = it.price != null && it.cost != null ? it.price - it.cost : null;
    const p = margin != null && margin > 0 && it.cost > 0 ? Math.max(0.5, Math.min(0.95, margin / (margin + it.cost))) : 0.75;
    return {
      item: it.item, forecast: Math.round(it.forecast), prep: Math.ceil(it.forecast * at(p)), point: Math.round(p * 100) / 100,
      sizedBy: margin != null ? 'cost' : 'default', measured: sorted.length >= 20,
    };
  });
}

/**
 * The pilot: nights that followed Covercast against nights run the usual way.
 * @param {{ date: string, service?: string, kind: 'staff'|'prep', followed: boolean, outcome?: { waste?: number, stockouts?: number, laborCost?: number, covers?: number, ticketMin?: number, guestIssues?: number } }[]} entries
 */
export function pilotReport(entries = []) {
  /** @type {Record<'staff' | 'prep', any>} */
  const out = /** @type {any} */ ({});
  for (const kind of /** @type {const} */ (['staff', 'prep'])) {
    const es = entries.filter((e) => e?.kind === kind && e.outcome);
    const arm = (f) => es.filter((e) => !!e.followed === f);
    const stats = (rs) => {
      const o = (k) => rs.map((e) => e.outcome[k]).filter((x) => typeof x === 'number' && Number.isFinite(x));
      const labor = rs.filter((e) => e.outcome.laborCost != null && e.outcome.covers > 0).map((e) => e.outcome.laborCost / e.outcome.covers);
      return {
        services: rs.length,
        wastePerService: r2(mean(o('waste'))), stockoutsPerService: r2(mean(o('stockouts'))),
        laborPerCover: r2(mean(labor)), ticketMin: r2(mean(o('ticketMin'))), guestIssuesPerService: r2(mean(o('guestIssues'))),
      };
    };
    const a = stats(arm(true)), b = stats(arm(false));
    const enough = a.services >= MIN_PER_ARM && b.services >= MIN_PER_ARM;
    const diff = (k) => (enough && a[k] != null && b[k] != null ? r2(a[k] - b[k]) : null);
    out[kind] = {
      claim: enough ? 'Observed' : null,
      status: enough ? 'ready' : 'collecting',
      need: MIN_PER_ARM,
      followed: a, usual: b,
      // Covercast nights minus usual nights; negative waste or labor is a saving, positive ticket time is slower service.
      difference: enough ? { wastePerService: diff('wastePerService'), stockoutsPerService: diff('stockoutsPerService'), laborPerCover: diff('laborPerCover'), ticketMin: diff('ticketMin'), guestIssuesPerService: diff('guestIssuesPerService') } : null,
      note: enough ? 'Nights are compared as logged; days weren’t assigned at random, so a busy-week mix can still tilt it.' : `Log at least ${MIN_PER_ARM} services each way (followed and usual) to compare.`,
    };
  }
  return out;
}
