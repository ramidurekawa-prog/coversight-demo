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

import { fitGBM, predictGBM } from './gbm.js';

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

/** Solve (A + λI) x = b for a small symmetric system (Gaussian elimination). */
function solve(A, b, lam) {
  const n = b.length, M = A.map((r, i) => [...r.map((v, j) => v + (i === j && i > 0 ? lam : 0)), b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

const HK = 5; // yearly harmonics (tried 2, 3, 5, 8)
const HALF = 730; // the last two years count, the latest most (tried half-lives of 1 year, 2 years, none)
const P = 2 + 6 + 2 * HK;
/** Features of day i: intercept, trend (years since the series began), 6 weekday dummies, yearly sine/cosine pairs. */
function feats(D, i) {
  const x = [1, i / 365.25];
  for (let w = 1; w < 7; w++) x.push(D[i].wd === w ? 1 : 0);
  const doy = (Date.parse(`${D[i].iso}T12:00:00Z`) / 864e5) % 365.25;
  for (let k = 1; k <= HK; k++) { const a = (2 * Math.PI * k * doy) / 365.25; x.push(Math.sin(a), Math.cos(a)); }
  return x;
}
/**
 * Running sums of the weighted normal equations, so a fit over any two-year
 * window is a subtraction, not a pass over every day. Weights grow by 2^(i/730),
 * which is the same as decaying from each origin up to one constant factor.
 */
const SUMS = new WeakMap();
function sumsFor(D) {
  if (SUMS.has(D)) return SUMS.get(D);
  const n = D.length, A = new Float64Array((n + 1) * P * P), b = new Float64Array((n + 1) * P), cnt = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const oa = i * P * P, na = (i + 1) * P * P, ob = i * P, nb = (i + 1) * P;
    for (let k = 0; k < P * P; k++) A[na + k] = A[oa + k];
    for (let k = 0; k < P; k++) b[nb + k] = b[ob + k];
    cnt[i + 1] = cnt[i];
    if (D[i].v == null || D[i].skip) continue;
    const x = feats(D, i), y = Math.log(D[i].v), w = 2 ** (i / HALF);
    for (let a = 0; a < P; a++) { b[nb + a] += w * x[a] * y; for (let c = 0; c < P; c++) A[na + a * P + c] += w * x[a] * x[c]; }
    cnt[i + 1]++;
  }
  const out = { A, b, cnt };
  SUMS.set(D, out);
  return out;
}
const FIT = new WeakMap();
/**
 * Trend + weekday + yearly season, fit on log covers over the last two years
 * (the decomposition Prophet-style forecasters use), one fit per origin.
 * Needs most of a year so the season isn't guessed.
 */
function harmonic(D, o, t) {
  if (!FIT.has(D)) FIT.set(D, new Map());
  const memo = FIT.get(D);
  if (!memo.has(o)) {
    const lo = Math.max(0, o - 727);
    const { A, b, cnt } = sumsFor(D);
    let coef = null;
    if (cnt[o + 1] - cnt[lo] >= 300) {
      const scale = 2 ** (o / HALF); // ridge in the same units as the weights
      const M = Array.from({ length: P }, (_, a) => Array.from({ length: P }, (_, c) => (A[(o + 1) * P * P + a * P + c] - A[lo * P * P + a * P + c]) / scale));
      const v = Array.from({ length: P }, (_, a) => (b[(o + 1) * P + a] - b[lo * P + a]) / scale);
      coef = solve(M, v, 1);
    }
    memo.set(o, coef);
  }
  const coef = memo.get(o);
  if (!coef) return null;
  const x = feats(D, t);
  // Trend is damped beyond the fit: carry at most a quarter-year of it forward.
  x[1] = Math.min(t, o + 91) / 365.25;
  return Math.exp(x.reduce((s, v, k) => s + v * coef[k], 0));
}

/* ------------------------------------------- gradient-boosted trees */

const GBM_FITS = new WeakMap();
/** Features for day t as known at origin o, against the 8-week same-weekday base (null without one). */
function gbmRow(D, o, t) {
  const same = sameWeekday(D, o, t, 8);
  if (same.length < 3) return null;
  const base = mean(same);
  if (!(base > 0)) return null;
  const last7 = [], last28 = [];
  for (let i = o; i > o - 28 && i >= 0; i--) if (D[i].v != null && !D[i].skip) { last28.push(D[i].v); if (i > o - 7) last7.push(D[i].v); }
  const ya = t - 364 >= 0 && t - 364 <= o && D[t - 364].v != null && !D[t - 364].skip ? D[t - 364].v / base : NaN;
  const doy = (Date.parse(`${D[t].iso}T12:00:00Z`) / 864e5) % 365.25;
  return {
    base,
    x: [t - o, D[t].wd, mean(same.slice(0, 4)) / base, same[0] / base, median(same) / base,
      last7.length >= 4 && last28.length >= 14 ? mean(last7) / mean(last28) : NaN, ya,
      Math.sin((2 * Math.PI * doy) / 365.25), Math.cos((2 * Math.PI * doy) / 365.25)],
  };
}
/**
 * Gradient-boosted trees on the log of each day against its 8-week
 * same-weekday base, from the room's last two years. Refit once a week, on
 * days up to that week's start only (no lookahead).
 */
function gbmDay(D, o, t) {
  if (!GBM_FITS.has(D)) GBM_FITS.set(D, new Map());
  const memo = GBM_FITS.get(D);
  const fo = o - (((o % 7) + 7) % 7);
  if (!memo.has(fo)) {
    const X = [], y = [];
    for (let tt = Math.max(30, fo - 727); tt <= fo; tt++) {
      if (D[tt].v == null || D[tt].skip) continue;
      const r = gbmRow(D, tt - 1 - (tt % 7), tt);
      if (!r) continue;
      X.push(r.x); y.push(Math.log(D[tt].v / r.base));
    }
    memo.set(fo, X.length >= 120 ? fitGBM(X, y) : null);
  }
  const model = memo.get(fo);
  if (!model) return null;
  const r = gbmRow(D, o, t);
  return r ? r.base * Math.exp(predictGBM(model, r.x)) : null;
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
  season: { label: 'Trend, weekday and yearly season', fn: harmonic },
  gbm: { label: 'Gradient-boosted trees (LightGBM-style)', fn: gbmDay },
};
export const METHOD_KEYS = Object.keys(METHODS);
/** Covercast V1: the seven original methods. V2 adds the gradient-boosted trees to the blend. */
export const V1_KEYS = METHOD_KEYS.filter((k) => k !== 'gbm');
export const V2_KEYS = METHOD_KEYS;
export const keysFor = (version) => (version === 'v2' ? V2_KEYS : V1_KEYS);

/** Every method's forecast for day t from origin o (V1's methods unless told otherwise). */
export function methodForecasts(D, o, t, keys = V1_KEYS) {
  const out = {};
  for (const k of keys) {
    const v = METHODS[k].fn(D, o, t);
    out[k] = v != null && Number.isFinite(v) ? v : null;
  }
  return out;
}
