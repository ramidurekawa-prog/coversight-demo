/* Trends: weekly history judged against its own baseline. Pure, so the browser
 * (the Trends page) and the server (the nightly `trends` job) compute exactly
 * the same series, limits and signals from the same rows.
 *
 * Rows are `deriveRoom(ds, id).hist.rows` (the room's history with the live
 * week filled in). Nothing here changes a figure the model computes; it only
 * reads them, and refuses to judge what it can't judge fairly:
 *  - a room on its own Toast data is judged on its own weeks only; the
 *    sample's earlier weeks never set the limits for a real restaurant;
 *  - figures Toast doesn't give us yet (weighted margin per dish, register
 *    exceptions on past weeks) are blank on own weeks, never sample values;
 *  - food (and so prime cost and earned) on own weeks is sales × the room's
 *    food rate until invoices are in, so it is Modelled, not Observed. */

/** How many recent weeks are judged against the baseline before them. */
export const JUDGE_WEEKS = 13;
/** Fewest baseline weeks we'll set limits from. */
export const MIN_BASELINE = 8;
/** A run this long on one side of the mean is a shift (Western Electric rule 4). */
export const RUN = 8;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ratio = (a, b) => (num(a) != null && num(b) ? a / b : null);

/** Every metric on the page. `up`: higher is better. `food`: depends on food cost. `own`: Toast gives it on own weeks. */
export const METRICS = [
  { key: 'net', label: 'Net sales', short: 'Sales', unit: 'money', up: true, own: true, get: (r) => num(r.net), help: 'Sales after comps and discounts, from the register.' },
  { key: 'earned', label: 'Earned (contribution)', short: 'Earned', unit: 'money', up: true, own: true, food: true, get: (r) => num(r.earned), help: 'Net sales less food and labour: what the week left to cover rent and overheads.' },
  { key: 'covers', label: 'Covers', short: 'Covers', unit: 'count', up: true, own: true, get: (r) => num(r.covers), help: 'Guests served, from the register.' },
  { key: 'check', label: 'Average check', short: 'Check', unit: 'cents', up: true, own: true, get: (r) => ratio(r.net, r.covers), help: 'Net sales per cover.' },
  { key: 'prime', label: 'Prime cost', short: 'Prime', unit: 'pct', up: false, own: true, food: true, get: (r) => pct(ratio(num(r.food) != null && num(r.labour) != null ? r.food + r.labour : null, r.net)), help: 'Food and labour together, as a share of net sales.' },
  { key: 'food', label: 'Food cost', short: 'Food', unit: 'pct', up: false, own: true, food: true, get: (r) => pct(ratio(r.food, r.net)), help: 'Food cost as a share of net sales.' },
  { key: 'labour', label: 'Labour', short: 'Labour', unit: 'pct', up: false, own: true, get: (r) => pct(ratio(r.labour, r.net)), help: 'Wages as a share of net sales, from the schedule and time clock.' },
  { key: 'exc', label: 'Register exceptions', short: 'Exceptions', unit: 'pct1', up: false, own: false, get: (r) => num(r.excPct), help: 'Voids, comps and discounts together, as a share of sales. Per-person limits are on Controls.' },
  { key: 'wcm', label: 'Weighted margin per dish', short: 'Margin/dish', unit: 'cents', up: true, own: false, get: (r) => num(r.wcm), help: 'What the average dish sold earns after its plate cost, weighted by what guests actually order.' },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));
function pct(v) { return v == null ? null : v * 100; }

/** Formatting shared by the page, the CSV and the notifications. */
export function fmtMetric(key, v, { exact = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '—';
  const u = METRIC[key]?.unit;
  if (u === 'money') return `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
  if (u === 'cents') return `$${v.toFixed(2)}`;
  if (u === 'count') return Math.round(v).toLocaleString('en-US');
  if (u === 'pct1' || u === 'pct') return `${v.toFixed(exact ? 2 : 1)}%`;
  return String(v);
}

/** Mean ± 3σ of the non-blank values. Null under MIN_BASELINE values or no spread. */
export function limitsOf(values) {
  const b = values.filter((v) => v != null);
  if (b.length < MIN_BASELINE) return null;
  const mean = b.reduce((s, v) => s + v, 0) / b.length;
  const sd = Math.sqrt(b.reduce((s, v) => s + (v - mean) ** 2, 0) / (b.length - 1));
  if (!(sd > 0)) return null;
  return { mean, sd, ucl: mean + 3 * sd, lcl: mean - 3 * sd, n: b.length };
}

/** The value a row has for a metric, honest about provenance (see the header). */
export function valueOf(metric, row, { last = false } = {}) {
  const m = METRIC[metric];
  if (!m) return null;
  if (row.own && !m.own && !(last && metric === 'exc')) return null;
  return m.get(row);
}

/**
 * Which weeks are trusted, which set the baseline and which are judged.
 * Sample history: all weeks; the first (n − 13) are the baseline.
 * Own data: only the trailing run of own weeks counts. With fewer than
 * 13 + 8 of them, the judged window shrinks so the baseline keeps 8 weeks,
 * and with fewer than 9 own weeks there's no baseline yet.
 */
export function windows(rows) {
  const n = rows.length;
  let from = 0;
  if (rows[n - 1]?.own) { from = n - 1; while (from > 0 && rows[from - 1].own) from--; }
  const trusted = n - from;
  const judge = Math.max(0, Math.min(JUDGE_WEEKS, trusted - MIN_BASELINE));
  const judgeFrom = n - judge;
  return { from, baseFrom: from, baseTo: judgeFrom, judgeFrom, trusted, own: from > 0 || !!rows[0]?.own, ready: judge > 0, needWeeks: judge > 0 ? 0 : MIN_BASELINE + 1 - trusted };
}

/** The nearest week a year earlier (within a week of 364 days back), when that row exists and is as trusted. */
export function lastYearIndex(rows, i, w = windows(rows)) {
  const iso = rows[i]?.iso;
  if (!iso) return null;
  const target = Date.parse(`${iso}T00:00:00Z`) - 364 * 864e5;
  let best = null;
  rows.forEach((r, j) => {
    if (j >= i || !r.iso) return;
    const d = Math.abs(Date.parse(`${r.iso}T00:00:00Z`) - target) / 864e5;
    if (d <= 7 && (best == null || d < best.d)) best = { j, d };
  });
  if (!best) return null;
  return best.j >= w.from ? best.j : null;
}

/**
 * The signals in one judged series, as episodes: a stretch of weeks that are
 * outside the limits, or part of a run of RUN or more on one side of the
 * baseline mean, all in the same direction. One episode is one thing to look
 * into, however many weeks it lasts. Only episodes reaching the judged window
 * count. An episode keeps its first week as it grows, so a note on it sticks.
 */
export function signalsOf(metric, vals, lim, w) {
  if (!lim || !w.ready) return [];
  const m = METRIC[metric];
  const n = vals.length;
  const side = vals.map((v) => (v == null ? 0 : v > lim.mean ? 1 : v < lim.mean ? -1 : 0));
  const out = vals.map((v, i) => (i < w.judgeFrom || v == null ? 0 : v > lim.ucl ? 1 : v < lim.lcl ? -1 : 0));
  const inRun = new Array(n).fill(0);
  for (let i = w.baseFrom; i < n;) {
    if (!side[i]) { i++; continue; }
    let j = i;
    while (j + 1 < n && side[j + 1] === side[i]) j++;
    if (j - i + 1 >= RUN && j >= w.judgeFrom) for (let k = i; k <= j; k++) inRun[k] = side[i];
    i = j + 1;
  }
  const flag = vals.map((_, i) => out[i] || inRun[i]);
  const eps = [];
  for (let i = w.baseFrom; i < n;) {
    if (!flag[i]) { i++; continue; }
    let j = i;
    while (j + 1 < n && flag[j + 1] === flag[i]) j++;
    if (j >= w.judgeFrom) {
      const breaches = [];
      for (let k = i; k <= j; k++) if (out[k]) breaches.push(k);
      const dir = flag[i] > 0 ? 'up' : 'down';
      const worst = breaches.length ? breaches.reduce((a, k) => (Math.abs(vals[k] - lim.mean) > Math.abs(vals[a] - lim.mean) ? k : a), breaches[0]) : j;
      eps.push({ metric, from: i, to: j, i: worst, weeks: j - i + 1, breaches: breaches.length, kind: breaches.length ? 'limit' : 'shift', dir, value: vals[worst], ongoing: j === n - 1, good: (dir === 'up') === m.up });
    }
    i = j + 1;
  }
  return eps;
}

/** Everything the page and the job need for one room's rows. */
export function trendsFor(rows) {
  const w = windows(rows);
  const n = rows.length;
  const metrics = {};
  for (const m of METRICS) {
    const vals = rows.map((r, i) => valueOf(m.key, r, { last: i === n - 1 }));
    const lim = limitsOf(vals.slice(w.baseFrom, w.baseTo));
    const signals = signalsOf(m.key, vals, lim, w);
    const latest = vals[n - 1];
    const lyI = lastYearIndex(rows, n - 1, w);
    const ly = lyI == null ? null : vals[lyI];
    const claim = w.own && m.food ? 'mod' : 'obs';
    metrics[m.key] = { key: m.key, vals, lim, signals, latest, ly, lyI, claim, inside: lim && latest != null ? latest <= lim.ucl && latest >= lim.lcl : null };
  }
  const order = Object.fromEntries(METRICS.map((m, i) => [m.key, i]));
  const signals = Object.values(metrics).flatMap((x) => x.signals).sort((a, b) => Number(a.good) - Number(b.good) || b.to - a.to || order[a.metric] - order[b.metric]);
  return { w, metrics, signals, rows };
}

/** Saved notes are keyed `<week start>:<metric>`. */
export const noteKey = (iso, metric) => `${iso}:${metric}`;
export const NOTE_KEY_RE = /^\d{4}-\d{2}-\d{2}:(net|earned|covers|check|prime|food|labour|exc|wcm)$/;
export const CAUSES = [
  { value: 'one-off', label: 'One-off event', hint: 'A private party, a closure, a storm. Not expected to repeat.' },
  { value: 'season', label: 'Seasonal or holiday', hint: 'A holiday or the season. Expected every year.' },
  { value: 'change', label: 'We changed something', hint: 'A new menu, prices, staffing or hours. The new level may be the norm.' },
  { value: 'data', label: 'Data problem', hint: 'A missing export, a mis-keyed invoice, a register outage.' },
  { value: 'looking', label: 'Still looking into it', hint: 'Keeps it on the list for the weekly meeting.' },
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
  if (s.kind === 'limit') {
    const limit = fmtMetric(s.metric, s.dir === 'up' ? lim.ucl : lim.lcl);
    const title = `${m.label} ${s.dir === 'up' ? 'high' : 'low'}${s.weeks > 1 ? ` for ${s.weeks} weeks` : ''}`;
    const body = s.breaches === 1
      ? `${fmtMetric(s.metric, s.value)} in the week of ${rows[s.i]?.label ?? ''}, ${word} its limit of ${limit} (baseline ${fmtMetric(s.metric, lim.mean)}).`
      : `${s.breaches} weeks ${word} the limit of ${limit} over ${span}; furthest ${fmtMetric(s.metric, s.value)} in the week of ${rows[s.i]?.label ?? ''} (baseline ${fmtMetric(s.metric, lim.mean)}).`;
    return { title, body };
  }
  return { title: `${m.label} shifted ${s.dir}`, body: `${word[0].toUpperCase()}${word.slice(1)} its baseline average of ${fmtMetric(s.metric, lim.mean)} every week for ${span}. No single week broke a limit, but a run this long rarely happens by chance.` };
}

/** Per seat, so rooms of different sizes compare fairly. Takes derived rooms ({ id, profile, hist }), any ids, any count. */
export function groupSeries(rooms) {
  return rooms.map((d) => {
    const seats = d.profile?.seats || 1;
    const rows = d.hist.rows;
    const t = trendsFor(rows);
    const perSeat = rows.map((r, i) => (i < t.w.from || num(r.earned) == null ? null : r.earned / seats));
    const mean = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
    const baseMean = t.w.ready ? mean(perSeat.slice(t.w.baseFrom, t.w.baseTo)) : null;
    const recentMean = t.w.ready ? mean(perSeat.slice(t.w.judgeFrom)) : null;
    return { id: d.id, name: d.profile?.short || d.id, seats, perSeat, latest: perSeat.at(-1), baseMean, recentMean, t, own: t.w.own, labels: rows.map((r) => r.label) };
  });
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The weekly history as CSV, with limits, signals and notes: what an accountant or GM would want in a sheet. */
export function trendsCsv(t, notes = {}, roomName = '', { header = true } = {}) {
  const head = ['room', 'week_start', 'week', 'source', 'window', ...METRICS.map((m) => `${m.key}${m.unit === 'pct' || m.unit === 'pct1' ? '_pct' : ''}`), 'signals', 'notes'];
  const lines = header ? [head.join(',')] : [];
  t.rows.forEach((r, i) => {
    const win = i < t.w.from ? 'not judged (sample)' : i < t.w.baseTo ? 'baseline' : 'judged';
    const sig = t.signals.filter((s) => i >= s.from && i <= s.to).map((s) => `${s.metric}:${s.kind}-${s.dir}`).join(' ');
    const ns = METRICS.map((m) => notes[noteKey(r.iso, m.key)]).filter(Boolean).map((n) => `${n.cause}${n.text ? `: ${n.text}` : ''}`).join(' | ');
    const vals = METRICS.map((m) => { const v = t.metrics[m.key].vals[i]; return v == null ? '' : m.unit === 'money' || m.unit === 'count' ? Math.round(v) : +v.toFixed(2); });
    lines.push([roomName, r.iso ?? '', r.label ?? '', r.own ? 'own data' : 'sample', win, ...vals, sig, ns].map(csvCell).join(','));
  });
  return lines.length ? `${lines.join('\n')}\n` : '';
}
