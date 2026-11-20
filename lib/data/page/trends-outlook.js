/**
 * Trends, looking forward: Coversight's own analyses that use Covercast and
 * the room's daily history. Pure: the page and the tests call the same code.
 *
 * - Covercast Outlook: the next four weeks of guests and sales from Covercast,
 *   with its measured range, turned into contribution at the room's recent
 *   kept share (what's left after food and labor). Modeled, never Observed.
 * - Week Shape: which days of the week are gaining or losing guests, the last
 *   13 weeks against the 13 before, holidays left out. Observed.
 * - Drift Clock: what an unfixed slow change costs over the same four weeks,
 *   if it stays where it is. Estimated.
 */
import { holidaysIn, isClosed } from './trends.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const DAY = 864e5;
const at = (iso) => Date.parse(`${iso}T12:00:00Z`);
const addDays = (iso, n) => new Date(at(iso) + n * DAY).toISOString().slice(0, 10);
const label = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Shares a forecast can lean on: the room's last few normal weeks (no holiday, no closure). */
export function recentKeep(t, weeks = 4) {
  const idx = [];
  for (let i = t.rows.length - 1; i >= t.w.from && idx.length < weeks; i--) if (!t.holidays[i]?.length && !isClosed(t.rows[i]) && num(t.rows[i].earned) != null) idx.push(i);
  if (!idx.length) return null;
  const net = idx.reduce((a, i) => a + t.rows[i].net, 0);
  const earned = idx.reduce((a, i) => a + t.rows[i].earned, 0);
  const covers = idx.reduce((a, i) => a + (num(t.rows[i].covers) ?? 0), 0);
  return { keep: earned / net, net: net / idx.length, earned: earned / idx.length, covers: covers / idx.length, weeks: idx.length };
}

/**
 * The next weeks from Covercast (`cc` is covercastRoom's record or the
 * server's), with contribution = forecast sales × recent kept share. The range
 * is Covercast's own 80% range carried through the same share.
 */
export function outlookOf(t, cc) {
  const sw = cc?.sales?.weeks ?? [], cw = cc?.covers?.weeks ?? [];
  const k = recentKeep(t);
  if (!sw.length || !k) return null;
  const weeks = sw.map((s) => {
    const c = cw.find((x) => x.start === s.start);
    return {
      start: s.start, label: label(s.start), holidays: holidaysIn(s.start),
      sales: { value: s.value, low: s.low, high: s.high },
      covers: c ? { value: c.value, low: c.low, high: c.high } : null,
      earned: { value: s.value * k.keep, low: s.low * k.keep, high: s.high * k.keep },
    };
  });
  const total = weeks.reduce((a, w) => a + w.earned.value, 0);
  const usual = t.metrics.earned.lim?.mean ?? null;
  const best = weeks.reduce((a, w) => (w.sales.value > a.sales.value ? w : a));
  return { weeks, keep: k.keep, recent: k, total, perWeek: total / weeks.length, usual, vsRecent: total / weeks.length - k.earned, best, engine: cc.engine ?? 'Covercast', claim: 'mod' };
}

const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/**
 * Guests per weekday, the last `weeks` weeks against the `weeks` before, from
 * the daily series. Holiday weeks' days and days with no guests are left out.
 * Monday first. `pct` is null when a side has fewer than 4 days.
 */
export function weekShapeOf(series, { weeks = 13 } = {}) {
  const days = (series?.days ?? []).filter((d) => num(d.covers) > 0);
  if (days.length < weeks * 7) return null;
  const end = days.at(-1).iso;
  const cut = addDays(end, -weeks * 7), start = addDays(end, -weeks * 14);
  const hol = new Set();
  const out = [1, 2, 3, 4, 5, 6, 0].map((wd) => ({ wd, name: WD[wd], recent: [], before: [] }));
  for (const d of days) {
    if (d.iso <= start) continue;
    const monday = addDays(d.iso, -((new Date(at(d.iso)).getUTCDay() + 6) % 7));
    if (!hol.has(monday) && holidaysIn(monday).length) hol.add(monday);
    if (hol.has(monday)) continue;
    const row = out.find((x) => x.wd === new Date(at(d.iso)).getUTCDay());
    (d.iso > cut ? row.recent : row.before).push(d.covers);
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const vari = (a, m) => (a.length > 1 ? a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1) : null);
  const rows = out.map((x) => {
    const r = avg(x.recent), b = avg(x.before);
    const ok = x.recent.length >= 4 && x.before.length >= 4 && b;
    // Real only when the move is more than twice its standard error (each day's own wobble).
    const se = ok ? Math.sqrt(vari(x.recent, r) / x.recent.length + vari(x.before, b) / x.before.length) : null;
    return { wd: x.wd, name: x.name, short: x.name.slice(0, 3), recent: r, before: b, pct: ok ? ((r - b) / b) * 100 : null, sure: ok ? Math.abs(r - b) > 2 * se : false, n: [x.recent.length, x.before.length] };
  });
  const scored = rows.filter((x) => x.pct != null);
  if (!scored.length) return null;
  const sure = scored.filter((x) => x.sure);
  const up = sure.filter((x) => x.pct > 0).reduce((a, x) => (!a || x.pct > a.pct ? x : a), null);
  const down = sure.filter((x) => x.pct < 0).reduce((a, x) => (!a || x.pct < a.pct ? x : a), null);
  const busiest = rows.reduce((a, x) => ((x.recent ?? 0) > (a.recent ?? 0) ? x : a));
  return { rows, up, down, busiest, weeks, through: end, claim: 'obs' };
}

const SHARE = new Set(['prime', 'food', 'labour', 'exc', 'check', 'net', 'wcm']);
/**
 * What one slow change costs over the outlook's weeks if it stays where it is:
 * its dollars a week, scaled by each forecast week's sales against recent
 * sales for changes that move with sales, flat for the rest. Only for ongoing
 * changes with a dollar figure.
 */
export function driftClockOf(e, outlook) {
  if (!e?.$ || !e.s.ongoing || !outlook) return null;
  const base = outlook.recent.net;
  const v = outlook.weeks.reduce((a, w) => a + e.$.perWeek * (SHARE.has(e.s.metric) && base ? w.sales.value / base : 1), 0);
  return { value: v, weeks: outlook.weeks.length, through: outlook.weeks.at(-1).start };
}
