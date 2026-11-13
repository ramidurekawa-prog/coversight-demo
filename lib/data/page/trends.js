/* Trends: weekly history judged against its own baseline. Pure, so the browser
 * (the Trends page) and the server (the nightly `trends` job) compute exactly
 * the same series, limits, signals and explanations from the same rows.
 *
 * Rows are `deriveRoom(ds, id).hist.rows` (the room's history with the live
 * week filled in). Nothing here changes a figure the model computes; it only
 * reads them, and refuses to judge what it can't judge fairly:
 *  - a room on its own Toast data is judged on its own weeks only; the
 *    sample's earlier weeks are never shown for it or used for its limits;
 *  - figures Toast doesn't give us yet (weighted margin per dish, register
 *    exceptions on past weeks) are blank on own weeks, never sample values;
 *  - a week with no sales (closed, or missing data) is a gap, never a zero
 *    and never a failure;
 *  - a week containing a public holiday (from the calendar, not guessed from
 *    the numbers) is labelled, left out of the baseline, and not flagged on
 *    its own;
 *  - food (and so prime cost and contribution) on own weeks is sales × the
 *    room's food rate until invoices are in, so it is Modelled, not Observed;
 *  - explanations split arithmetic (what moved, in which parts) from
 *    possibilities to check. Nothing here says what caused a change. */

/** Bump when the method changes, so a snapshot says which method judged it. */
export const METHOD = 'trends-v2';
/** How many recent weeks are judged against the baseline before them. */
export const JUDGE_WEEKS = 13;
/** Fewest baseline weeks we'll set limits from. */
export const MIN_BASELINE = 8;
/** Under this many baseline weeks, limits are shown but marked as built on limited history. */
export const SOLID_BASELINE = 26;
/** A run this long on one side of the mean is a shift (Western Electric rule 4). */
export const RUN = 8;
/** Fewest values a metric needs in a room's own weeks before the page offers it. */
export const MIN_VALUES = 4;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ratio = (a, b) => (num(a) != null && num(b) ? a / b : null);
function pct(v) { return v == null ? null : v * 100; }
const mean = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const DAY = 864e5;
const isoAdd = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * Every metric the page can show. `up`: higher is better. `food`: depends on
 * food cost. `own`: Toast gives it on own weeks. `sampleOnly`: the sample has it,
 * Toast exports don't. `group`: how rooms add up (sum, or a weighted ratio).
 */
export const METRICS = [
  { key: 'net', group: 'Sales', label: 'Net sales', short: 'Sales', unit: 'money', up: true, own: true, get: (r) => num(r.net), agg: 'sum', help: 'Sales after comps and discounts, from the register.', page: 'daily' },
  { key: 'covers', group: 'Sales', label: 'Covers', short: 'Covers', unit: 'count', up: true, own: true, get: (r) => num(r.covers), agg: 'sum', help: 'Guests served, from the register.', page: 'daily' },
  { key: 'check', group: 'Sales', label: 'Average check', short: 'Check', unit: 'cents', up: true, own: true, get: (r) => ratio(r.net, r.covers), agg: { num: 'net', den: 'covers' }, help: 'Net sales per cover.', page: 'menu', lever: 'Menu' },
  { key: 'earned', group: 'Margin', label: 'Contribution after food and labour', short: 'Contribution', unit: 'money', up: true, own: true, food: true, get: (r) => num(r.earned), agg: 'sum', help: 'Net sales less food and labour. Rent, utilities, tax and other overheads are not taken off: this is not profit.', page: 'week' },
  { key: 'prime', group: 'Costs', label: 'Prime cost', short: 'Prime', unit: 'pct', up: false, own: true, food: true, get: (r) => pct(num(r.food) != null && num(r.labour) != null ? ratio(r.food + r.labour, r.net) : null), agg: { num: ['food', 'labour'], den: 'net', pct: true }, help: 'Food and labour together, as a share of net sales.', page: 'labour' },
  { key: 'food', group: 'Costs', label: 'Food cost', short: 'Food', unit: 'pct', up: false, own: true, food: true, get: (r) => pct(ratio(r.food, r.net)), agg: { num: ['food'], den: 'net', pct: true }, help: 'Food cost as a share of net sales.', page: 'purchasing', lever: 'Purchasing' },
  { key: 'labour', group: 'Costs', label: 'Labour cost', short: 'Labour', unit: 'pct', up: false, own: true, get: (r) => pct(ratio(r.labour, r.net)), agg: { num: ['labour'], den: 'net', pct: true }, help: 'Wages as a share of net sales, from the schedule and time clock.', page: 'labour', lever: 'Labour' },
  { key: 'ot', group: 'Operations', label: 'Overtime', short: 'Overtime', unit: 'mins', up: false, own: true, get: (r) => num(r.otMin), agg: 'sum', help: 'Minutes worked past 40 hours a week, from Toast time entries.', page: 'labour', lever: 'Labour' },
  { key: 'turn', group: 'Operations', label: 'Table turn time', short: 'Turn time', unit: 'minutes', up: false, own: true, get: (r) => num(r.turn), agg: null, help: 'Average minutes from a table opening to closing, from Toast checks.', page: 'kitchen', lever: 'Kitchen' },
  { key: 'exc', group: 'Operations', label: 'Register exceptions', short: 'Exceptions', unit: 'pct1', up: false, own: false, get: (r) => num(r.excPct), agg: null, help: 'Voids, comps and discounts together, as a share of sales. Per-person limits are on Controls.', page: 'controls', lever: 'Controls' },
  { key: 'wcm', group: 'Menu', label: 'Weighted margin per dish', short: 'Margin/dish', unit: 'cents', up: true, own: false, get: (r) => num(r.wcm), agg: null, help: 'What the average dish sold earns after its plate cost, weighted by what guests actually order.', page: 'menu', lever: 'Menu' },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));
export const METRIC_GROUPS = [...new Set(METRICS.map((m) => m.group))];

/** Formatting shared by the page, the CSV and the notifications. */
export function fmtMetric(key, v, { exact = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '—';
  const u = METRIC[key]?.unit;
  if (u === 'money') return `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
  if (u === 'cents') return `$${v.toFixed(2)}`;
  if (u === 'count') return Math.round(v).toLocaleString('en-US');
  if (u === 'mins') return `${Math.round(v).toLocaleString('en-US')} min`;
  if (u === 'minutes') return `${v.toFixed(1)} min`;
  if (u === 'pct1') return `${v.toFixed(2)}%`;
  if (u === 'pct') return `${v.toFixed(exact ? 2 : 1)}%`;
  return String(v);
}
/** A difference in the metric's own unit: points for shares, % for the rest. */
export function fmtChange(key, a, b) {
  if (a == null || b == null) return null;
  const u = METRIC[key]?.unit;
  if (u === 'pct' || u === 'pct1') { const d = a - b; return { v: d, text: Math.abs(d) < 0.05 ? 'level' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pts` }; }
  if (!b) return null;
  const p = ((a - b) / Math.abs(b)) * 100;
  return { v: p, text: Math.abs(p) < 0.05 ? 'level' : `${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%` };
}

/* ------------------------------------------------------------- calendar */

/** nth weekday (0 = Sunday) of a month, or the last when n < 0. */
function nthDow(y, m, dow, n) {
  if (n > 0) { const d = new Date(Date.UTC(y, m, 1)); const off = (dow - d.getUTCDay() + 7) % 7; return Date.UTC(y, m, 1 + off + (n - 1) * 7); }
  const d = new Date(Date.UTC(y, m + 1, 0)); const off = (d.getUTCDay() - dow + 7) % 7; return Date.UTC(y, m + 1, -off);
}
/** US public holidays and the days that change restaurant demand most, for one year. Calendar facts only. */
export function holidaysOfYear(y) {
  const at = (ms, name) => ({ iso: new Date(ms).toISOString().slice(0, 10), name });
  return [
    at(Date.UTC(y, 0, 1), 'New Year’s Day'),
    at(Date.UTC(y, 1, 14), 'Valentine’s Day'),
    at(nthDow(y, 4, 0, 2), 'Mother’s Day'),
    at(nthDow(y, 4, 1, -1), 'Memorial Day'),
    at(Date.UTC(y, 6, 4), 'Independence Day'),
    at(nthDow(y, 8, 1, 1), 'Labor Day'),
    at(nthDow(y, 10, 4, 4), 'Thanksgiving'),
    at(Date.UTC(y, 11, 24), 'Christmas Eve'),
    at(Date.UTC(y, 11, 25), 'Christmas Day'),
    at(Date.UTC(y, 11, 31), 'New Year’s Eve'),
  ];
}
/** Holidays falling in the 7 days starting `iso`. */
export function holidaysIn(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return [];
  const end = isoAdd(iso, 6);
  const years = [...new Set([+iso.slice(0, 4), +end.slice(0, 4)])];
  return years.flatMap(holidaysOfYear).filter((h) => h.iso >= iso && h.iso <= end).map((h) => h.name);
}

/* ------------------------------------------------------------- windows */

/** A week with no sales is closed or missing: a gap, never a zero. */
export const isClosed = (r) => !(num(r?.net) > 0);

/** The value a row has for a metric, honest about provenance (see the header). */
export function valueOf(metric, row, { last = false } = {}) {
  const m = METRIC[metric];
  if (!m || isClosed(row)) return null;
  if (row.own && !m.own && !(last && metric === 'exc')) return null;
  if (!row.own && m.own && (metric === 'ot' || metric === 'turn')) return null; // sample rows don't carry these
  return m.get(row);
}

/**
 * Which weeks are trusted, which set the baseline and which are judged.
 * Sample history: all weeks; the first (n − 13) are the baseline.
 * Own data: only the trailing run of own weeks counts. With fewer than
 * 13 + 8 of them, the judged window shrinks so the baseline keeps 8 usable
 * weeks (holiday and closed weeks don't count), and until there are 9 usable
 * own weeks there's no baseline yet. `skip` marks the weeks that don't count.
 */
export function windows(rows, skip = []) {
  const n = rows.length;
  let from = 0;
  if (rows[n - 1]?.own) { from = n - 1; while (from > 0 && rows[from - 1].own) from--; }
  const trusted = n - from;
  // The baseline needs MIN_BASELINE usable weeks (not holiday, not closed) before the judged ones.
  let usable = 0, k = from;
  while (k < n && usable < MIN_BASELINE) { if (!skip[k]) usable++; k++; }
  const judgeFrom = usable < MIN_BASELINE ? n : Math.max(n - JUDGE_WEEKS, k);
  const ready = judgeFrom < n;
  const total = rows.slice(from).filter((_, i) => !skip[from + i]).length;
  return { from, baseFrom: from, baseTo: judgeFrom, judgeFrom, trusted, own: from > 0 || !!rows[0]?.own, ready, needWeeks: ready ? 0 : Math.max(1, MIN_BASELINE + 1 - total) };
}

/** Mean ± 3σ of the non-blank values. Null under MIN_BASELINE values or no spread. */
export function limitsOf(values) {
  const b = values.filter((v) => v != null);
  if (b.length < MIN_BASELINE) return null;
  const mu = b.reduce((s, v) => s + v, 0) / b.length;
  const sd = Math.sqrt(b.reduce((s, v) => s + (v - mu) ** 2, 0) / (b.length - 1));
  if (!(sd > 1e-9 * Math.max(1, Math.abs(mu)))) return null; // no real spread (float noise): nothing to judge
  return { mean: mu, sd, ucl: mu + 3 * sd, lcl: mu - 3 * sd, n: b.length, limited: b.length < SOLID_BASELINE };
}

/** The nearest week a year earlier (within a week of 364 days back), when that row exists and is as trusted. */
export function lastYearIndex(rows, i, w = windows(rows)) { // w only bounds which rows are trusted
  const iso = rows[i]?.iso;
  if (!iso) return null;
  const target = Date.parse(`${iso}T00:00:00Z`) - 364 * DAY;
  let best = null;
  rows.forEach((r, j) => {
    if (j >= i || !r.iso) return;
    const d = Math.abs(Date.parse(`${r.iso}T00:00:00Z`) - target) / DAY;
    if (d <= 7 && (best == null || d < best.d)) best = { j, d };
  });
  if (!best) return null;
  return best.j >= w.from ? best.j : null;
}

/* ------------------------------------------------------------- signals */

/** How much an episode matters: never a probability, just an ordered label. */
function severityOf({ good, kind, z, breaches, weeks, limited }) {
  if (good) return 'info';
  let s = kind === 'limit' ? (z >= 4 || breaches >= 3 ? 'high' : 'medium') : weeks >= 12 ? 'medium' : 'low';
  if (limited && s === 'high') s = 'medium'; // a short baseline can't carry a "high"
  return s;
}
export const SEVERITY_RANK = { high: 0, medium: 1, low: 2, info: 3 };

/**
 * The signals in one judged series, as episodes: a stretch of weeks that are
 * outside the limits, or part of a run of RUN or more on one side of the
 * baseline mean, all in the same direction. Holiday weeks and gaps neither
 * count towards nor break a run, and a holiday week is never flagged on its
 * own. One episode is one thing to look into, however many weeks it lasts.
 * Only episodes reaching the judged window count. An episode keeps its first
 * week as it grows, so a note on it sticks.
 */
export function signalsOf(metric, vals, lim, w, skip = []) {
  if (!lim || !w.ready) return [];
  const m = METRIC[metric];
  const n = vals.length;
  const neutral = (i) => vals[i] == null || skip[i];
  const out = vals.map((v, i) => (i < w.judgeFrom || neutral(i) ? 0 : v > lim.ucl ? 1 : v < lim.lcl ? -1 : 0));
  const inRun = new Array(n).fill(0);
  let start = -1, side = 0, count = 0;
  const close = (end) => { if (count >= RUN && end >= w.judgeFrom) for (let k = start; k <= end; k++) if (!neutral(k)) inRun[k] = side; };
  let lastReal = -1;
  for (let i = w.baseFrom; i < n; i++) {
    if (neutral(i)) continue;
    const s = vals[i] > lim.mean ? 1 : vals[i] < lim.mean ? -1 : 0;
    if (s && s === side) { count++; lastReal = i; continue; }
    close(lastReal);
    side = s; count = s ? 1 : 0; start = i; lastReal = i;
  }
  close(lastReal);
  const flag = vals.map((_, i) => out[i] || inRun[i]);
  const eps = [];
  for (let i = w.baseFrom; i < n;) {
    if (!flag[i]) { i++; continue; }
    let j = i;
    // extend over neutral weeks between flagged weeks in the same direction
    for (let k = i + 1; k < n; k++) { if (flag[k] === flag[i]) j = k; else if (!(neutral(k) && !flag[k])) break; }
    if (j >= w.judgeFrom) {
      const idx = [];
      for (let k = i; k <= j; k++) if (flag[k]) idx.push(k);
      const breaches = idx.filter((k) => out[k]);
      const dir = flag[i] > 0 ? 'up' : 'down';
      const worst = (breaches.length ? breaches : idx).reduce((a, k) => (Math.abs(vals[k] - lim.mean) > Math.abs(vals[a] - lim.mean) ? k : a));
      const kind = breaches.length ? 'limit' : 'shift';
      const avg = mean(idx.map((k) => vals[k]));
      const z = Math.abs(vals[worst] - lim.mean) / lim.sd;
      const good = (dir === 'up') === m.up;
      eps.push({
        metric, from: i, to: j, i: worst, weeks: idx.length, breaches: breaches.length, kind, dir, value: vals[worst], avg, ongoing: j === n - 1 || (j < n - 1 && vals.slice(j + 1).every((v, k) => neutral(j + 1 + k))), good,
        expected: { mean: lim.mean, lcl: lim.lcl, ucl: lim.ucl }, z: +z.toFixed(1), n: lim.n, limited: lim.limited,
        severity: severityOf({ good, kind, z, breaches: breaches.length, weeks: idx.length, limited: lim.limited }),
      });
    }
    i = j + 1;
  }
  return eps;
}

/**
 * On own data, past weeks' food is net × the room's food rate (apply.js), but
 * the live week's comes from the menu model, so the two aren't comparable and
 * the last week would look like a food-cost jump that never happened. Put the
 * live week on the same convention as the weeks before it. Sample rows are
 * left exactly as they are.
 */
function ownFoodConsistent(rows) {
  const n = rows.length;
  const last = rows[n - 1];
  if (!last?.own || isClosed(last)) return rows;
  const rates = rows.slice(0, -1).filter((r) => r.own && !isClosed(r) && num(r.food) != null).map((r) => r.food / r.net).sort((a, b) => a - b);
  if (!rates.length) return rows;
  const rate = rates[Math.floor(rates.length / 2)];
  const food = Math.round(last.net * rate);
  const out = rows.slice();
  out[n - 1] = { ...last, food, earned: num(last.labour) != null ? last.net - food - last.labour : last.earned };
  return out;
}

/** Everything the page and the job need for one room's rows. */
export function trendsFor(input) {
  const rows = ownFoodConsistent(input);
  const n = rows.length;
  const holidays = rows.map((r) => holidaysIn(r.iso));
  const closed = rows.map((r) => isClosed(r));
  const skip = holidays.map((h, i) => h.length > 0 || closed[i]);
  const w = windows(rows, skip);
  const metrics = {};
  for (const m of METRICS) {
    const vals = rows.map((r, i) => valueOf(m.key, r, { last: i === n - 1 }));
    const base = vals.slice(w.baseFrom, w.baseTo).map((v, k) => (skip[w.baseFrom + k] ? null : v));
    const lim = limitsOf(base);
    const signals = signalsOf(m.key, vals, lim, w, skip);
    const latest = vals[n - 1];
    const lyI = lastYearIndex(rows, n - 1, w);
    const ly = lyI == null ? null : vals[lyI];
    const claim = w.own && m.food ? 'mod' : 'obs';
    const count = vals.slice(w.from).filter((v) => v != null).length;
    const modelledOnly = w.own && m.key === 'food'; // a fixed rate × sales: nothing to judge until invoices are in
    metrics[m.key] = { key: m.key, vals, lim: modelledOnly ? null : lim, signals: modelledOnly ? [] : signals, latest, ly, lyI, claim, count, available: !modelledOnly && count >= MIN_VALUES, modelledOnly, inside: modelledOnly ? null : lim && latest != null ? latest <= lim.ucl && latest >= lim.lcl : null };
  }
  const order = Object.fromEntries(METRICS.map((m, i) => [m.key, i]));
  const signals = Object.values(metrics).flatMap((x) => x.signals)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Number(b.ongoing) - Number(a.ongoing) || b.to - a.to || order[a.metric] - order[b.metric]);
  return { method: METHOD, w, metrics, signals, rows, holidays, closed };
}

/** Metrics the room has data for, in their groups. */
export const availableMetrics = (t) => METRICS.filter((m) => t.metrics[m.key].available);

/** Ranges the room's own history can fill. Never longer than what's there. */
export function rangesFor(t) {
  const have = t.w.trusted;
  const opts = [{ v: 4, label: '4 weeks' }, { v: 13, label: '13 weeks' }, { v: 26, label: '26 weeks' }, { v: 52, label: '52 weeks' }, { v: 104, label: '24 months' }].filter((o) => o.v <= have);
  if (!opts.some((o) => o.v === have) && have > 0) opts.push({ v: have, label: `All ${have} weeks` });
  return opts;
}

/* ------------------------------------------------------------- answers */

/**
 * Is the room getting better or worse? Contribution over the judged weeks
 * against the baseline weeks, with a standard-error test so ordinary week to
 * week noise reads as "steady", and against the same weeks a year earlier
 * when they exist (that takes seasonality out).
 */
export function directionOf(t, metric = 'earned') {
  const x = t.metrics[metric];
  if (!t.w.ready || !x.lim) return { state: 'unknown', metric };
  const recent = x.vals.slice(t.w.judgeFrom).filter((v, k) => v != null && !t.holidays[t.w.judgeFrom + k].length);
  const r = mean(recent);
  if (r == null) return { state: 'unknown', metric };
  const se = x.lim.sd / Math.sqrt(recent.length);
  const z = (r - x.lim.mean) / se;
  const ly = [];
  for (let i = t.w.judgeFrom; i < t.rows.length; i++) { const j = lastYearIndex(t.rows, i, t.w); if (j != null && x.vals[i] != null && x.vals[j] != null) ly.push([x.vals[i], x.vals[j]]); }
  const yoy = ly.length >= 4 ? { now: mean(ly.map((p) => p[0])), then: mean(ly.map((p) => p[1])), weeks: ly.length } : null;
  const better = METRIC[metric].up ? z > 0 : z < 0;
  const state = Math.abs(z) < 2 ? 'steady' : better ? 'improving' : 'slipping';
  return { state, metric, recent: r, base: x.lim.mean, weeks: recent.length, baseWeeks: x.lim.n, change: fmtChange(metric, r, x.lim.mean), yoy, limited: x.lim.limited };
}

/* ------------------------------------------------------------- explanations */

const sumOf = (rows, from, to, f) => { let s = 0, k = 0; for (let i = from; i <= to; i++) { const v = f(rows[i]); if (v != null) { s += v; k++; } } return k ? s / k : null; };

/**
 * What can be said about one episode, in three kinds that are never mixed:
 * `arithmetic`: what moved and by how much, in parts that add up (no cause);
 * `possible`: things worth checking, each phrased as a possibility;
 * `related`: proof-governed changes on the same lever (their effect is measured on Proof, not here).
 * `known` is always false: these figures alone can't establish a cause.
 */
export function explainSignal(s, t, { proofs = [], candidates = [] } = {}) {
  const rows = t.rows, m = METRIC[s.metric];
  const bFrom = t.w.baseFrom, bTo = t.w.baseTo - 1;
  const okBase = (r, i) => (t.holidays[i]?.length || isClosed(r) ? null : r);
  const base = (f) => { let sum = 0, k = 0; for (let i = bFrom; i <= bTo; i++) { const r = okBase(rows[i], i); const v = r ? f(r) : null; if (v != null) { sum += v; k++; } } return k ? sum / k : null; };
  const now = (f) => sumOf(rows, s.from, s.to, (r) => (isClosed(r) ? null : f(r)));
  const money = (v) => fmtMetric('net', v);
  const arithmetic = [], possible = [];
  const net0 = base((r) => r.net), net1 = now((r) => r.net);
  if (s.metric === 'prime' || s.metric === 'food' || s.metric === 'labour') {
    const food0 = base((r) => r.food), food1 = now((r) => r.food), lab0 = base((r) => r.labour), lab1 = now((r) => r.labour);
    const ch = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.abs(((a - b) / b) * 100).toFixed(1)}%` : '—');
    if (s.metric === 'prime') {
      const fp = (food1 / net1 - food0 / net0) * 100, lp = (lab1 / net1 - lab0 / net0) * 100;
      const pts = (v) => `${v >= -0.05 ? '+' : '−'}${Math.abs(v).toFixed(1)} pts`;
      arithmetic.push(`Of the ${Math.abs(fp + lp).toFixed(1)}-point move, food accounts for ${pts(fp)} and labour ${pts(lp)}.`);
    }
    arithmetic.push(`Weekly sales averaged ${money(net1)} (${ch(net1, net0)} on the baseline), food ${money(food1)} (${ch(food1, food0)}) and labour ${money(lab1)} (${ch(lab1, lab0)}).`);
    if (s.metric !== 'food') possible.push('Possible: scheduled hours didn’t follow sales. Compare the schedule with covers on Labour.');
    if (s.metric !== 'labour') possible.push(t.w.own ? 'Food on your weeks is sales × your food rate until invoices are in, so a food move here can’t come from prices yet. Bring in invoices to measure it.' : 'Possible: supplier prices or portioning moved. Check invoice prices on Purchasing.');
  } else if (s.metric === 'earned') {
    const f0 = base((r) => r.food), f1 = now((r) => r.food), l0 = base((r) => r.labour), l1 = now((r) => r.labour);
    const sign = (v) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;
    arithmetic.push(`Per week against the baseline: sales ${sign(net1 - net0)}, food ${sign(-(f1 - f0))}, labour ${sign(-(l1 - l0))}, contribution ${sign(net1 - f1 - l1 - (net0 - f0 - l0))}.`);
  } else if (s.metric === 'net') {
    const c0 = base((r) => r.covers), c1 = now((r) => r.covers);
    if (c0 && c1) {
      const k0 = net0 / c0, k1 = net1 / c1;
      const cov = (c1 - c0) * k0, chk = c1 * (k1 - k0);
      arithmetic.push(`Of the ${money(Math.abs(net1 - net0))} a week, more or fewer guests account for ${cov >= 0 ? '+' : '−'}${money(Math.abs(cov))} and the average check for ${chk >= 0 ? '+' : '−'}${money(Math.abs(chk))}.`);
    }
    possible.push('Possible: season, weather or a local event. Check whether the same weeks last year moved the same way.');
  } else if (s.metric === 'check' || s.metric === 'covers') {
    const c0 = base((r) => r.covers), c1 = now((r) => r.covers);
    arithmetic.push(`Average check is net sales ÷ covers: sales averaged ${money(net1)} a week (baseline ${money(net0)}) over ${Math.round(c1).toLocaleString('en-US')} covers (baseline ${Math.round(c0).toLocaleString('en-US')}).`);
    if (s.metric === 'check') possible.push('Possible: guests ordering a different mix, or more discounts. Compare item mix on Menu and discounts on Controls.');
  } else if (s.metric === 'wcm') {
    const fr0 = base((r) => ratio(r.food, r.net)), fr1 = now((r) => ratio(r.food, r.net));
    if (fr0 != null && fr1 != null) arithmetic.push(`Food cost as a share of sales was ${(fr1 * 100).toFixed(1)}% over these weeks against ${(fr0 * 100).toFixed(1)}% in the baseline.`);
    possible.push('Possible: guests moving to lower-earning dishes. Compare each dish’s share of orders on Menu.');
  } else if (s.metric === 'exc') {
    possible.push('Possible: one or two people, one shift, or a new discount. Per-person rates are on Controls.');
  } else if (s.metric === 'ot' || s.metric === 'turn') {
    possible.push(s.metric === 'ot' ? 'Possible: short-staffed weeks or a schedule built past 40 hours. Check who on Labour.' : 'Possible: a slow station or longer stays. Ticket times by station are on Kitchen.');
  }
  const related = proofs.filter((p) => m.lever && p.lever === m.lever && (p.outcome === 'verified' || p.outcome === 'limited' || p.outcome === 'testing'))
    .map((p) => ({ id: p.id, title: p.title, outcome: p.outcome, since: p.since ?? null }));
  const finding = m.lever ? candidates.filter((c) => c.lever === m.lever).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0] : null;
  return { arithmetic, possible, related, finding: finding ? { id: finding.id, title: finding.title } : null, known: false };
}

/* ------------------------------------------------------------- notes */

/** Saved notes are keyed `<week start>:<metric>`. */
export const noteKey = (iso, metric) => `${iso}:${metric}`;
export const NOTE_KEY_RE = new RegExp(`^\\d{4}-\\d{2}-\\d{2}:(${METRICS.map((m) => m.key).join('|')})$`);
export const CAUSES = [
  { value: 'one-off', label: 'One-off event', hint: 'A private party, a closure, a storm. Not expected to repeat.' },
  { value: 'season', label: 'Seasonal or holiday', hint: 'A holiday or the season. Expected every year.' },
  { value: 'change', label: 'We changed something', hint: 'A new menu, prices, staffing or hours. The new level may be the norm.' },
  { value: 'data', label: 'Data problem', hint: 'A missing export, a mis-keyed invoice, a register outage.' },
  { value: 'looking', label: 'Still looking into it', hint: 'Keeps it on the list and keeps the nightly alert on.' },
];
/** Notes as saved, keeping only well-formed ones (local browser storage isn't validated by the server). */
export function cleanNotes(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, n] of Object.entries(raw)) {
    if (!NOTE_KEY_RE.test(k) || !n || typeof n !== 'object' || !CAUSES.some((c) => c.value === n.cause)) continue;
    out[k] = { cause: n.cause, text: typeof n.text === 'string' ? n.text.slice(0, 280) : '', at: typeof n.at === 'string' && !Number.isNaN(Date.parse(n.at)) ? n.at : '' };
  }
  return out;
}

/** Explained = a note exists and its cause isn't "still looking". */
export const isExplained = (note) => !!note && note.cause !== 'looking';

/** The note key for an episode: its first week and metric. */
export const signalKey = (s, rows) => noteKey(rows[s.from]?.iso ?? '', s.metric);

/** A short title and a sentence for one episode, used by the page and by the notification. */
export function describeSignal(s, rows, lim) {
  const m = METRIC[s.metric];
  const first = rows[s.from]?.label ?? '', last = rows[s.to]?.label ?? '';
  const span = s.weeks === 1 ? `the week of ${first}` : `${s.weeks} weeks, ${first} to ${s.ongoing ? 'this week' : last}`;
  const word = s.dir === 'up' ? 'above' : 'below';
  const range = `usual range ${fmtMetric(s.metric, lim.lcl)} to ${fmtMetric(s.metric, lim.ucl)}, from ${lim.n} baseline weeks`;
  if (s.kind === 'limit') {
    const title = `${m.label} ${s.dir === 'up' ? 'high' : 'low'}${s.weeks > 1 ? ` for ${s.weeks} weeks` : ''}`;
    const body = s.breaches === 1 && s.weeks === 1
      ? `${fmtMetric(s.metric, s.value)} in the week of ${rows[s.i]?.label ?? ''}, ${word} its ${range}.`
      : `${s.breaches} of ${s.weeks} weeks ${word} its ${range}; furthest ${fmtMetric(s.metric, s.value)} in the week of ${rows[s.i]?.label ?? ''}.`;
    return { title, body };
  }
  return { title: `${m.label} shifted ${s.dir}`, body: `${word[0].toUpperCase()}${word.slice(1)} its baseline average of ${fmtMetric(s.metric, lim.mean)} every week for ${span}. No single week left its ${range}, but a run this long is unlikely to be ordinary variation.` };
}

/* ------------------------------------------------------------- group */

/** Per seat, so rooms of different sizes compare fairly. Takes derived rooms ({ id, profile, hist }), any ids, any count. */
export function groupSeries(rooms) {
  return rooms.map((d) => {
    const seats = d.profile?.seats || 1;
    const rows = d.hist.rows;
    const t = trendsFor(rows);
    const perSeat = rows.map((r, i) => (i < t.w.from || isClosed(r) || num(r.earned) == null ? null : r.earned / seats));
    const baseMean = t.w.ready ? mean(perSeat.slice(t.w.baseFrom, t.w.baseTo)) : null;
    const recentMean = t.w.ready ? mean(perSeat.slice(t.w.judgeFrom)) : null;
    return { id: d.id, name: d.profile?.short || d.id, seats, perSeat, latest: perSeat.at(-1), baseMean, recentMean, t, own: t.w.own, labels: rows.map((r) => r.label), isos: rows.map((r) => r.iso) };
  });
}

/**
 * One metric across rooms, week by week, matched on the week's start date.
 * Totals add only rooms of the same kind (never sample with real) that have a
 * value that week; shares are weighted (Σ part ÷ Σ sales), never averaged.
 */
export function groupTrend(rooms, metric) {
  const m = METRIC[metric];
  const per = rooms.map((d) => { const t = trendsFor(d.hist.rows); return { id: d.id, name: d.profile?.short || d.id, seats: d.profile?.seats || null, t, own: t.w.own, rows: d.hist.rows }; });
  const anyOwn = per.some((r) => r.own);
  const inTotal = per.filter((r) => r.own === anyOwn);
  const excluded = per.filter((r) => r.own !== anyOwn).map((r) => ({ id: r.id, name: r.name, why: 'Sample data: not added to your rooms’ totals' }));
  const isoSet = new Set();
  inTotal.forEach((r) => r.rows.forEach((row, i) => { if (i >= r.t.w.from && row.iso) isoSet.add(row.iso); }));
  const isos = [...isoSet].sort();
  const at = (r, iso) => { const i = r.rows.findIndex((row, k) => k >= r.t.w.from && row.iso === iso); return i < 0 ? null : i; };
  const series = per.map((r) => ({ id: r.id, name: r.name, own: r.own, inTotal: r.own === anyOwn, vals: isos.map((iso) => { const i = at(r, iso); return i == null ? null : r.t.metrics[metric].vals[i]; }) }));
  let total = null;
  if (m.agg) {
    total = isos.map((iso) => {
      const rowsAt = inTotal.map((r) => { const i = at(r, iso); return i == null || isClosed(r.rows[i]) ? null : r.rows[i]; });
      if (rowsAt.some((x) => x == null)) return null; // a missing room makes the week non-comparable
      if (m.agg === 'sum') { const v = inTotal.map((r, k) => r.t.metrics[metric].vals[at(r, iso)]); return v.some((x) => x == null) ? null : v.reduce((a, b) => a + b, 0); }
      const numer = rowsAt.reduce((s, row) => s + [].concat(m.agg.num).reduce((a, k) => a + (num(row[k]) ?? NaN), 0), 0);
      const den = rowsAt.reduce((s, row) => s + (num(row[m.agg.den]) ?? NaN), 0);
      const v = den ? numer / den : null;
      return v == null || !Number.isFinite(v) ? null : m.agg.pct ? v * 100 : v;
    });
  }
  const labels = isos.map((iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
  return { metric, isos, labels, series, total, excluded, inTotal: inTotal.map((r) => r.id), weighted: !!m.agg && m.agg !== 'sum' };
}

/* ------------------------------------------------------------- export */

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The weekly history as CSV, with window, holidays, signals and notes. A room on its own data exports its own weeks only. */
export function trendsCsv(t, notes = {}, roomName = '', { header = true } = {}) {
  const head = ['room', 'week_start', 'week', 'source', 'window', 'holiday', ...METRICS.map((m) => `${m.key}${m.unit === 'pct' || m.unit === 'pct1' ? '_pct' : m.unit === 'mins' || m.unit === 'minutes' ? '_min' : ''}`), 'signals', 'notes', 'method'];
  const lines = header ? [head.join(',')] : [];
  t.rows.forEach((r, i) => {
    if (i < t.w.from) return;
    const win = isClosed(r) ? 'closed or missing' : !t.w.ready ? 'building baseline' : i < t.w.baseTo ? (t.holidays[i].length ? 'baseline (holiday, left out)' : 'baseline') : 'judged';
    const sig = t.signals.filter((s) => i >= s.from && i <= s.to).map((s) => `${s.metric}:${s.kind}-${s.dir}`).join(' ');
    const ns = METRICS.map((m) => notes[noteKey(r.iso, m.key)]).filter(Boolean).map((n) => `${n.cause}${n.text ? `: ${n.text}` : ''}`).join(' | ');
    const vals = METRICS.map((m) => { const v = t.metrics[m.key].vals[i]; return v == null ? '' : m.unit === 'money' || m.unit === 'count' || m.unit === 'mins' ? Math.round(v) : +v.toFixed(2); });
    lines.push([roomName, r.iso ?? '', r.label ?? '', r.own ? 'own data' : 'sample', win, t.holidays[i].join('; '), ...vals, sig, ns, t.method].map(csvCell).join(','));
  });
  return lines.length ? `${lines.join('\n')}\n` : '';
}
