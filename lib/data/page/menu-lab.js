/**
 * Price Lab: how guests react to each dish's price, learned from the
 * restaurant's own weeks, and the menu prices that keep the most money.
 * Pure: the browser and the server call the same code.
 *
 *   learn(d)          per dish: price reaction (elasticity) with its
 *                     uncertainty, fitted on log plates ~ log price + log
 *                     (every other dish's plates that week, for traffic), then
 *                     pooled across the menu (empirical Bayes): a dish with
 *                     little history leans on the rest of the menu, never on
 *                     a typed number.
 *   switching         the share of guests lost to a price rise who order
 *                     another dish in the same category instead, measured the
 *                     same way, and only ever counted inside its range.
 *   predict(...)      plates, sales and money kept after a price change, with
 *                     a good case and a bad case (80% range).
 *   trackRecord(d)    every past price change predicted from the other weeks
 *                     only, against what actually sold: how often the range
 *                     held, and the error against "same as last week".
 *   balance(d, opts)  the best price per dish for money kept, inside the
 *                     room's price fence, never with a bad case that loses
 *                     money, and never losing more than the order limit.
 *
 * Weeks come from room.levers.priceHistory: the restaurant's own Toast weeks
 * (paid price and plates per dish, oldest first), or the sample's.
 */

const Z80 = 1.2816;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const sq = (x) => x * x;
/** A fitted reaction that says guests buy more when the price rises is noise. Cap it just below zero. */
const E_MAX = -0.05;
/** Never let one dish's spread fall below this: a menu of near-identical fits is still a guess. */
const TAU_FLOOR = 0.3;
/** Switching is a share of lost guests: between none and 80%. */
const D_MAX = 0.8;
const SE_FLOOR = 0.05;

/* ------------------------------------------------------------------ fitting */
/** OLS of y on [1, x1, x2]; returns slope on x1, its standard error, residual sd. */
function ols2(y, x1, x2) {
  const n = y.length;
  const m1 = mean(x1), m2 = mean(x2), my = mean(y);
  const a = x1.map((v) => v - m1), b = x2.map((v) => v - m2), c = y.map((v) => v - my);
  const s11 = sum(a.map(sq)), s22 = sum(b.map(sq)), s12 = sum(a.map((v, i) => v * b[i]));
  const s1y = sum(a.map((v, i) => v * c[i])), s2y = sum(b.map((v, i) => v * c[i]));
  const useControl = s22 > 1e-9 && n >= 6;
  const det = useControl ? s11 * s22 - sq(s12) : s11;
  if (!(s11 > 1e-9) || !(det > 1e-12)) return null;
  const k = useControl ? 3 : 2;
  const b1 = useControl ? (s1y * s22 - s2y * s12) / det : s1y / s11;
  const b2 = useControl ? (s2y * s11 - s1y * s12) / det : 0;
  const res = c.map((v, i) => v - b1 * a[i] - b2 * b[i]);
  const df = Math.max(1, n - k);
  const s2 = sum(res.map(sq)) / df;
  const var1 = useControl ? s2 * s22 / det : s2 / s11;
  /* A near-perfect fit on a few weeks isn't certainty: floor the error. */
  return { e: b1, se: Math.max(SE_FLOOR, Math.sqrt(var1)), sd: Math.sqrt(s2), n };
}

/**
 * The weeks one dish can learn from: paid price, plates, and the room's guests
 * that week (traffic, which a menu price doesn't move). Price weeks are the
 * room's latest weeks, oldest first, so they line up with its last weeks of covers.
 */
function weeksOf(ph, key, covers) {
  const rows = ph[key] || [];
  const c = covers.slice(-rows.length);
  return rows.map((r, i) => ({ price: r.price, units: r.units, rest: c[i] ?? 0 }))
    .filter((w) => w.price > 0 && w.units > 0 && w.rest > 0);
}
const coversOf = (d) => (d.hist?.rows || []).map((r) => r.covers);
const changesIn = (ws) => ws.reduce((n, w, i) => n + (i > 0 && w.price !== ws[i - 1].price ? 1 : 0), 0);

function fitWeeks(ws) {
  if (ws.length < 4 || new Set(ws.map((w) => w.price)).size < 2) return null;
  return ols2(ws.map((w) => Math.log(w.units)), ws.map((w) => Math.log(w.price)), ws.map((w) => Math.log(w.rest)));
}

/** Pool raw fits into a menu-wide prior (mean, spread) by the method of moments. */
function poolOf(fits) {
  const ok = fits.filter((f) => f && Number.isFinite(f.se) && f.se > 0);
  if (!ok.length) return null;
  const w = ok.map((f) => 1 / sq(f.se));
  const mu = sum(ok.map((f, i) => f.e * w[i])) / sum(w);
  const between = ok.length > 1 ? mean(ok.map((f) => sq(f.e - mu))) - mean(ok.map((f) => sq(f.se))) : 0;
  return { mu: Math.min(E_MAX, mu), tau: Math.max(TAU_FLOOR, Math.sqrt(Math.max(0, between))), n: ok.length };
}
/**
 * The prior for one dish: its earlier measurement when it has one (a closed
 * test, or the sample's own history before these weeks), else the menu pool.
 * A dish added by hand has no measurement of its own.
 */
function priorOf(m, pool) {
  if (m && m.e != null && m.se != null && !m.added) return { mu: m.e, tau: Math.max(0.1, m.se), measured: true };
  return pool ? { ...pool, measured: false } : null;
}
function shrink(fit, pool) {
  if (!fit) return { e: pool.mu, se: pool.tau, own: 0 };
  const wf = 1 / sq(fit.se), wp = 1 / sq(pool.tau);
  const e = (fit.e * wf + pool.mu * wp) / (wf + wp);
  return { e: Math.min(E_MAX, e), se: Math.sqrt(1 / (wf + wp)), own: wf / (wf + wp) };
}

/* ------------------------------------------------------------------ switching */
/**
 * When a dish's plates drop in a week, do the other dishes in its category
 * pick some of them up? Pooled over every dish and week: the slope of the
 * category's other plates on this dish's plates, both as change from their
 * own average. −1 means every lost plate went to a neighbour; 0 means none did.
 */
function switchingOf(ph, menu) {
  const xs = [], ys = [];
  for (const m of menu) {
    const h = ph[m.key];
    if (!h || new Set(h.map((r) => r.price)).size < 2) continue;
    const peers = menu.filter((o) => o.key !== m.key && o.cat === m.cat && ph[o.key]);
    if (!peers.length) continue;
    const mu = mean(h.map((r) => r.units));
    const peerWeek = h.map((_, i) => sum(peers.map((o) => ph[o.key][i]?.units ?? 0)));
    const pmu = mean(peerWeek);
    h.forEach((r, i) => { xs.push(r.units - mu); ys.push(peerWeek[i] - pmu); });
  }
  if (xs.length < 8) return { share: 0, lo: 0, hi: 0.5, measured: false };
  const sxx = sum(xs.map(sq));
  if (!(sxx > 0)) return { share: 0, lo: 0, hi: 0.5, measured: false };
  const slope = sum(xs.map((x, i) => x * ys[i])) / sxx;
  const res = ys.map((y, i) => y - slope * xs[i]);
  const se = Math.sqrt(sum(res.map(sq)) / Math.max(1, xs.length - 1) / sxx);
  const share = Math.max(0, Math.min(D_MAX, -slope));
  return { share, lo: Math.max(0, Math.min(D_MAX, -slope - Z80 * se)), hi: Math.max(0, Math.min(D_MAX, -slope + Z80 * se)), measured: true };
}

/* ------------------------------------------------------------------ learn */
/**
 * @param {any} d deriveRoom(ds, roomId)
 * @returns {{ dishes: Record<string, any>, pool: any, switching: any, weeks: number, own: boolean }}
 */
export function learn(d) {
  const ph = d.room.levers?.priceHistory || {};
  const menu = d.menu.menu.filter((m) => !m.balancing);
  const covers = coversOf(d);
  const raw = Object.fromEntries(menu.map((m) => { const ws = weeksOf(ph, m.key, covers); return [m.key, { ws, fit: fitWeeks(ws), changes: changesIn(ws) }]; }));
  const pool = poolOf(Object.values(raw).map((r) => r.fit));
  const switching = switchingOf(ph, menu);
  const dishes = {};
  for (const m of menu) {
    const r = raw[m.key];
    const prior = priorOf(m, pool);
    if (!prior) { dishes[m.key] = { key: m.key, e: null, se: null, weeks: r.ws.length, changes: r.changes, own: 0 }; continue; }
    const post = shrink(r.fit, prior);
    dishes[m.key] = { key: m.key, ...post, weeks: r.ws.length, changes: r.changes, raw: r.fit ? r.fit.e : null, sd: r.fit?.sd ?? null, priorMeasured: prior.measured };
  }
  /* Peer margin: what a guest who switches earns, on average, in the same category. */
  for (const m of menu) {
    const peers = menu.filter((o) => o.key !== m.key && o.cat === m.cat);
    const units = sum(peers.map((o) => o.units));
    if (dishes[m.key]) {
      dishes[m.key].peerCm = units ? sum(peers.map((o) => (o.price - o.cost) * o.units)) / units : 0;
      dishes[m.key].peerPrice = units ? sum(peers.map((o) => o.price * o.units)) / units : 0;
    }
  }
  return { dishes, pool, switching, weeks: Math.max(0, ...Object.values(raw).map((r) => r.ws.length)), own: !!d.room.fromToast };
}

/* ------------------------------------------------------------------ predict */
function outcome(item, p1, e, share, L) {
  const q1 = item.units * Math.pow(p1 / item.price, e);
  const lost = item.units - q1;
  const switched = lost > 0 ? lost * share : 0;
  const kept = (p1 - item.cost) * q1 - (item.price - item.cost) * item.units + switched * (L.peerCm ?? 0);
  const sales = p1 * q1 - item.price * item.units + switched * (L.peerPrice ?? 0);
  return { q1, lost, switched, kept, sales };
}

/**
 * Money kept, sales and plates a week after moving `item` to `p1`, with the
 * good and bad case: reaction ±1.28 se and switching at the edges of its range.
 */
export function predict(lab, item, p1) {
  const L = lab.dishes[item.key];
  if (!L || L.e == null || !(p1 > 0)) return null;
  const sw = lab.switching;
  const pt = outcome(item, p1, L.e, sw.share, L);
  const corners = [L.e - Z80 * L.se, Math.min(E_MAX, L.e + Z80 * L.se)].flatMap((e) => [sw.lo, sw.hi].map((s) => outcome(item, p1, e, s, L)));
  const ks = corners.map((c) => c.kept);
  const plates = corners.map((c) => c.q1);
  return {
    price: p1, e: L.e, se: L.se,
    kept: pt.kept, good: Math.max(...ks), bad: Math.min(...ks),
    sales: pt.sales, plates: pt.q1, platesLo: Math.min(...plates), platesHi: Math.max(...plates),
    lost: pt.lost, switched: pt.switched,
  };
}

/* ------------------------------------------------------------------ track record */
/**
 * Every past week whose price differed from the week before, predicted from
 * the dish's other weeks only (and the menu's pool), against what sold.
 * Compared with "same plates as last week", the way most owners guess.
 */
export function trackRecord(d) {
  const ph = d.room.levers?.priceHistory || {};
  const menu = d.menu.menu.filter((m) => !m.balancing);
  const covers = coversOf(d);
  const fits = menu.map((m) => fitWeeks(weeksOf(ph, m.key, covers)));
  const pool = poolOf(fits);
  if (!pool && !menu.some((m) => priorOf(m, null))) return { n: 0 };
  const rows = [];
  for (const m of menu) {
    const ws = weeksOf(ph, m.key, covers);
    ws.forEach((w, t) => {
      if (t === 0 || w.price === ws[t - 1].price) return;
      const rest = ws.filter((_, i) => i !== t);
      const post = shrink(fitWeeks(rest), priorOf(m, pool));
      const f = fitWeeks(rest);
      const base = rest.filter((r) => r.price === ws[t - 1].price);
      if (!base.length) return;
      const bu = mean(base.map((r) => Math.log(r.units))), bp = Math.log(ws[t - 1].price), br = mean(base.map((r) => Math.log(r.rest)));
      // The traffic slope from the same fit (0 when the fit couldn't estimate it).
      const g = f ? trafficSlope(rest) : 0;
      const guess = bu + post.e * (Math.log(w.price) - bp) + g * (Math.log(w.rest) - br);
      const actual = Math.log(w.units);
      rows.push({ dish: m.key, from: ws[t - 1].price, to: w.price, predicted: Math.exp(guess), actual: w.units, naive: ws[t - 1].units, logErr: actual - guess, dx: Math.log(w.price) - bp, se: post.se,
        err: Math.abs(Math.exp(guess) - w.units) / w.units, naiveErr: Math.abs(ws[t - 1].units - w.units) / w.units });
    });
  }
  if (!rows.length) return { n: 0 };
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const err = med(rows.map((r) => r.err)), naive = med(rows.map((r) => r.naiveErr));
  /* Week-to-week noise, from the held-out misses themselves, so the range is sized by what really happened. */
  const noise = Math.sqrt(mean(rows.map((r) => sq(r.logErr))));
  rows.forEach((r) => { r.inside = Math.abs(r.logErr) <= Z80 * Math.sqrt(sq(r.se * r.dx) + sq(noise)); });
  return { n: rows.length, dishes: new Set(rows.map((r) => r.dish)).size, err, naiveErr: naive, inside: rows.filter((r) => r.inside).length / rows.length, noise, beatNaive: rows.filter((r) => r.err < r.naiveErr).length, rows };
}
function trafficSlope(ws) {
  const y = ws.map((w) => Math.log(w.units)), x1 = ws.map((w) => Math.log(w.price)), x2 = ws.map((w) => Math.log(w.rest));
  const m1 = mean(x1), m2 = mean(x2), my = mean(y);
  const a = x1.map((v) => v - m1), b = x2.map((v) => v - m2), c = y.map((v) => v - my);
  const s11 = sum(a.map(sq)), s22 = sum(b.map(sq)), s12 = sum(a.map((v, i) => v * b[i]));
  const s1y = sum(a.map((v, i) => v * c[i])), s2y = sum(b.map((v, i) => v * c[i]));
  const det = s11 * s22 - sq(s12);
  if (ws.length < 5 || !(det > 1e-12)) return 0;
  return (s2y * s11 - s1y * s12) / det;
}

/* ------------------------------------------------------------------ balanced menu */
/** Price steps a guest reads easily: quarters under $10, halves above. */
/** A move worth less than this a week isn't worth a reprint or a guest noticing. */
export const MIN_KEPT = 15;
const stepOf = (p) => (p < 10 ? 0.25 : 0.5);
const roundTo = (p, s) => Math.round(p / s) * s;

/**
 * The best price per dish for money kept.
 * @param {any} d deriveRoom
 * @param {{ lab?: any, maxPrice?: number, keepOrders?: number, skip?: (m: any) => string | null }} [opts]
 *   maxPrice: the fence on one price move, in percent (default 8, the room's fence).
 *   keepOrders: the least share of a dish's orders a move may keep (default 0.9).
 *   minKept: the least a move must keep a week to be listed.
 *   skip: why a dish can't move now (estimated cost, repriced recently), or null.
 */
export function balance(d, { lab = learn(d), maxPrice = 8, keepOrders = 0.9, minKept = MIN_KEPT, skip = () => null } = {}) {
  const menu = d.menu.menu.filter((m) => !m.balancing);
  const moves = [], held = [];
  for (const m of menu) {
    const L = lab.dishes[m.key];
    if (!L || L.e == null) continue;
    const why = skip(m);
    const step = stepOf(m.price);
    const lo = m.price * (1 - maxPrice / 100), hi = m.price * (1 + maxPrice / 100);
    let best = null;
    for (let p = roundTo(lo, step); p <= hi + 1e-9; p = +(p + step).toFixed(2)) {
      if (p < lo - 1e-9 || Math.abs(p - m.price) < 1e-9 || p <= m.cost) continue;
      const r = predict(lab, m, p);
      if (!r || r.bad < 0 || r.plates < m.units * keepOrders) continue;
      if (!best || r.kept > best.kept) best = r;
    }
    if (!best || best.kept < minKept) continue;
    const move = { key: m.key, name: m.name, cat: m.cat, from: m.price, to: best.price, units: m.units, ...best };
    if (why) held.push({ ...move, why }); else moves.push(move);
  }
  moves.sort((a, b) => b.kept - a.kept);
  held.sort((a, b) => b.kept - a.kept);
  return {
    moves, held,
    kept: sum(moves.map((m) => m.kept)), good: sum(moves.map((m) => m.good)), bad: sum(moves.map((m) => m.bad)),
    sales: sum(moves.map((m) => m.sales)), plates: sum(moves.map((m) => m.plates - m.units)),
    heldKept: sum(held.map((m) => m.kept)),
    maxPrice, keepOrders,
  };
}

/* ------------------------------------------------------------------ Menu Maker, in one sentence */
const money0 = (n) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
/** How strongly guests react, in words a guest would use. */
export function reactionWord(e) {
  if (e == null) return 'not known yet';
  const a = Math.abs(e);
  return a < 0.5 ? 'barely notice its price' : a < 1 ? 'notice its price a little' : a < 1.5 ? 'notice its price' : 'are very price-sensitive on it';
}
/** Menu Maker's one-sentence read of a prediction: what guests do, the likely result and the worst case. */
export function explain(lab, item, r) {
  const L = lab.dishes[item.key];
  if (!L || !r) return null;
  const up = r.price > item.price;
  const base = L.changes >= 2 ? `From ${L.changes} price changes in your last ${L.weeks} weeks, guests ${reactionWord(L.e)}.` : `This dish hasn’t changed price much, so we lean on how your whole menu reacts: guests ${reactionWord(L.e)}.`;
  const sw = r.switched >= 1 ? ` About ${Math.round(r.switched)} of the guests who skip it pick another ${item.cat === 'Alcohol' ? 'drink' : 'dish'} instead.` : '';
  const res = r.bad >= 0
    ? ` ${up ? 'Raising' : 'Lowering'} it most likely keeps ${money0(r.kept)} more a week; even the bad case keeps ${money0(r.bad)}.`
    : r.kept > 0 ? ` Most likely ${money0(r.kept)} more a week, but the bad case loses ${money0(r.bad)}, so test it first.` : ` This price most likely loses ${money0(r.kept)} a week.`;
  return base + sw + res;
}
