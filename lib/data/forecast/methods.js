/**
 * Covercast's day-level methods. Each one forecasts one day (index t) from
 * the days up to an origin (index o, the last day whose result is known),
 * reading nothing after o. Each returns a number or null (not enough of the
 * room's own history to say).
 *
 * D is a contiguous run of days: { iso, wd, v, skip, holiday }. v is null on a
 * closed or missing day; skip marks a day that isn't a normal day (holiday,
 * event, closure) and so doesn't set the baseline for normal days.
 */

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export function median(a) {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Values on the same weekday as t, newest first, known by o (up to n, within 26 weeks). */
export function sameWeekday(D, o, t, n, { skip = true } = {}) {
  const out = [];
  const k0 = Math.max(1, Math.ceil((t - o) / 7));
  for (let k = k0, i = t - 7 * k0; i >= 0 && out.length < n && k <= 26; k++, i -= 7) {
    const x = D[i];
    if (x.v != null && !(skip && x.skip)) out.push(x.v);
  }
  return out;
}

/**
 * Weekday indices and a smoothed level over the last 8 weeks before o:
 * a multiplicative weekday profile with a damped trend (Holt–Winters style).
 */
function levelSeason(D, o, t) {
  const lo = Math.max(0, o - 55);
  const pts = [];
  for (let i = lo; i <= o; i++) if (D[i].v != null && !D[i].skip) pts.push(i);
  if (pts.length < 21) return null;
  const byWd = Array.from({ length: 7 }, () => []);
  for (const i of pts) byWd[D[i].wd].push(D[i].v);
  const wdMean = byWd.map((a) => (a.length >= 2 ? mean(a) : null));
  const have = wdMean.filter((x) => x != null);
  if (wdMean[D[t].wd] == null || have.length < 3) return null;
  const overall = mean(have);
  if (!(overall > 0)) return null;
  const idx = wdMean.map((m) => (m == null ? null : m / overall));
  const z = pts.filter((i) => idx[D[i].wd]).map((i) => ({ i, z: D[i].v / idx[D[i].wd] }));
  const A = 0.12;
  let L = mean(z.slice(0, 7).map((p) => p.z));
  for (const p of z.slice(7)) L = A * p.z + (1 - A) * L;
  // Least-squares slope of the deseasonalised level, per day.
  const mi = mean(z.map((p) => p.i)), mz = mean(z.map((p) => p.z));
  let sxy = 0, sxx = 0;
  for (const p of z) { sxy += (p.i - mi) * (p.z - mz); sxx += (p.i - mi) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  const PHI = 0.92;
  const h = t - o;
  let damp = 0;
  for (let j = 1, f = PHI; j <= h; j++, f *= PHI) damp += f;
  const lagFix = slope * ((1 - A) / A) * 0.5; // an EWMA trails a trend; half-correct it
  return Math.max(0, (L + lagFix + slope * damp) * idx[D[t].wd]);
}

/** The same day a year ago (364 days, same weekday), scaled by the last four weeks against the same four a year before. */
function yearAgo(D, o, t) {
  const b = t - 364;
  if (b - 7 < 0) return null;
  const base = [b - 7, b, b + 7].filter((i) => i <= o && D[i].v != null && !D[i].skip).map((i) => D[i].v);
  if (!base.length || D[b].v == null) return null;
  let now = 0, then = 0, n = 0;
  for (let j = o - 27; j <= o; j++) {
    const k = j - 364;
    if (k < 0 || D[j].v == null || D[k].v == null || D[j].skip || D[k].skip) continue;
    now += D[j].v; then += D[k].v; n++;
  }
  if (n < 20 || !(then > 0)) return null;
  // Lean on the day itself, with its neighbours to steady it.
  const anchor = 0.5 * D[b].v + 0.5 * mean(base);
  return anchor * (now / then);
}

/**
 * The methods, by key. `current` is the method the pages use today (the
 * average of up to eight recent same weekdays, nothing set aside); it's kept
 * in the ensemble as one voice and as the yardstick in every accuracy report.
 */
export const METHODS = {
  current: { label: 'Usual night (8 same weekdays)', fn: (D, o, t) => { const v = sameWeekday(D, o, t, 8, { skip: false }); return v.length >= 2 ? mean(v) : null; } },
  lastWeek: { label: 'Same day last week', fn: (D, o, t) => sameWeekday(D, o, t, 1)[0] ?? null },
  median: { label: 'Median of 8 same weekdays', fn: (D, o, t) => { const v = sameWeekday(D, o, t, 8); return v.length >= 3 ? median(v) : null; } },
  recent: { label: 'Recent weeks weighted most', fn: (D, o, t) => {
    const v = sameWeekday(D, o, t, 12);
    if (v.length < 3) return null;
    let s = 0, w = 0;
    v.forEach((x, k) => { const wk = 0.5 ** (k / 3); s += x * wk; w += wk; });
    return s / w;
  } },
  level: { label: 'Level × weekday pattern, with trend', fn: levelSeason },
  yearAgo: { label: 'Same day last year, scaled to this year', fn: yearAgo },
};
export const METHOD_KEYS = Object.keys(METHODS);

/** Every method's forecast for day t from origin o. */
export function methodForecasts(D, o, t) {
  const out = {};
  for (const k of METHOD_KEYS) {
    const v = METHODS[k].fn(D, o, t);
    out[k] = v != null && Number.isFinite(v) ? v : null;
  }
  return out;
}
