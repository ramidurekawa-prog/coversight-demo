/**
 * Accounting periods (pure). Restaurants close their books either by calendar
 * month or on a 52-week retail calendar (4-4-5, 4-5-4 or 5-4-4 weeks a
 * quarter), so every period has whole weeks and the same weekdays.
 *
 * Weekly rows carry `iso`, the first day of their week. On a retail calendar
 * week 1 is the week that holds January 1; a 53rd week joins period 12. By
 * month, a week belongs to the month it ends in. Figures are sums of the
 * rows given: nothing is estimated or pro-rated here.
 */
const DAY = 86_400_000;
export const CALENDARS = {
  month: { label: 'Calendar months', weeks: null },
  '445': { label: '4-4-5 weeks', weeks: [4, 4, 5] },
  '454': { label: '4-5-4 weeks', weeks: [4, 5, 4] },
  '544': { label: '5-4-4 weeks', weeks: [5, 4, 4] },
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);

/** The fiscal year and week number (from 1) of a week that starts on `iso`. */
export function fiscalWeek(iso) {
  const start = ms(iso);
  let y = new Date(start + 6 * DAY).getUTCFullYear();
  // The start of the week (same weekday as this one) that holds January 1 of a year.
  const first = (yr) => { const j = Date.UTC(yr, 0, 1); return j - ((((j - start) / DAY) % 7) + 7) % 7 * DAY; };
  let w1 = first(y);
  if (start < w1) { y -= 1; w1 = first(y); }
  return { year: y, week: Math.round((start - w1) / (7 * DAY)) + 1 };
}

/** Which period a week belongs to: { id, year, n (1 to 12), label }. */
export function periodOf(iso, calendar = 'month') {
  const c = CALENDARS[calendar] || CALENDARS.month;
  if (!c.weeks) {
    const end = new Date(ms(iso) + 6 * DAY);
    const y = end.getUTCFullYear(), m = end.getUTCMonth();
    return { id: `${y}-${String(m + 1).padStart(2, '0')}`, year: y, n: m + 1, label: `${MONTHS[m]} ${y}` };
  }
  const { year, week } = fiscalWeek(iso);
  let n = 12, at = 0;
  for (let p = 0; p < 12; p++) { at += c.weeks[p % 3]; if (week <= at) { n = p + 1; break; } }
  return { id: `${year}-P${String(n).padStart(2, '0')}`, year, n, label: `Period ${n}, ${year}` };
}

/**
 * Weekly rows rolled into periods, oldest first. Each period has its weeks,
 * its sums and prime cost; `complete` is false when a retail period is short
 * of its weeks (the first or the current one).
 */
export function periodPnl(rows, calendar = 'month') {
  const c = CALENDARS[calendar] || CALENDARS.month;
  const out = new Map();
  for (const r of rows) {
    if (!r?.iso || !(r.net > 0)) continue;
    const p = periodOf(r.iso, calendar);
    if (!out.has(p.id)) out.set(p.id, { ...p, weeks: [], net: 0, food: 0, labour: 0, earned: 0, covers: 0 });
    const o = out.get(p.id);
    o.weeks.push({ iso: r.iso, label: r.label, net: r.net, food: r.food, labour: r.labour, earned: r.earned, covers: r.covers || 0 });
    for (const k of ['net', 'food', 'labour', 'earned']) o[k] += r[k] || 0;
    o.covers += r.covers || 0;
  }
  return [...out.values()].map((o) => {
    const want = c.weeks ? (o.n === 12 ? null : c.weeks[(o.n - 1) % 3]) : null;
    return { ...o, prime: (o.food + o.labour) / o.net, foodRate: o.food / o.net, labourRate: o.labour / o.net, complete: want == null ? null : o.weeks.length >= want };
  });
}

/** The P&L as CSV rows: one line per week, then the period's total. */
export function pnlCsv(periods, { room = '' } = {}) {
  const pct = (x) => (x * 100).toFixed(1);
  const rows = [['Location', 'Period', 'Week starting', 'Net sales', 'Food cost', 'Labor cost', 'Prime cost', 'Food cost %', 'Labor %', 'Prime cost %', 'Kept after food and labor']];
  for (const p of periods) {
    for (const w of p.weeks) rows.push([room, p.label, w.iso, Math.round(w.net), Math.round(w.food), Math.round(w.labour), Math.round(w.food + w.labour), pct(w.food / w.net), pct(w.labour / w.net), pct((w.food + w.labour) / w.net), Math.round(w.earned)]);
    rows.push([room, `${p.label} total`, '', Math.round(p.net), Math.round(p.food), Math.round(p.labour), Math.round(p.food + p.labour), pct(p.foodRate), pct(p.labourRate), pct(p.prime), Math.round(p.earned)]);
  }
  return rows.map((r) => r.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(',')).join('\n');
}
