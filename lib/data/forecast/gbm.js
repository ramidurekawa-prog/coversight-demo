/**
 * A small gradient-boosted tree model (the LightGBM family, written out in
 * plain JavaScript so it runs in the browser, on the server and in tests with
 * nothing installed). Least squares, shallow trees grown best-first on
 * histogram bins, shrinkage, row subsampling with a fixed seed. Pure and
 * deterministic: the same rows always give the same model.
 */

const DEFAULTS = { rounds: 120, depth: 3, leaves: 8, lr: 0.06, minLeaf: 12, bins: 24, subsample: 0.8, lambda: 1, seed: 7 };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Bin edges per feature from the training rows (quantiles; few distinct values keep their own). */
function binEdges(X, f, bins) {
  const v = X.map((x) => x[f]).filter(Number.isFinite).sort((a, b) => a - b);
  const uniq = [...new Set(v)];
  if (uniq.length <= bins) return uniq.slice(0, -1).map((u, i) => (u + uniq[i + 1]) / 2);
  const out = [];
  for (let b = 1; b < bins; b++) { const e = v[Math.floor((b / bins) * (v.length - 1))]; if (out.at(-1) !== e) out.push(e); }
  return out;
}
const binOf = (edges, x) => { let lo = 0, hi = edges.length; while (lo < hi) { const m = (lo + hi) >> 1; if (x <= edges[m]) hi = m; else lo = m + 1; } return lo; };

/**
 * Fit on rows X (arrays of numbers) and targets y.
 * @param {number[][]} X @param {number[]} y @param {Partial<typeof DEFAULTS>} [opt]
 */
export function fitGBM(X, y, opt = {}) {
  const o = { ...DEFAULTS, ...opt };
  const n = X.length, F = n ? X[0].length : 0;
  if (n < o.minLeaf * 2) return null;
  const edges = Array.from({ length: F }, (_, f) => binEdges(X, f, o.bins));
  const B = X.map((x) => x.map((v, f) => binOf(edges[f], v)));
  const base = y.reduce((s, v) => s + v, 0) / n;
  const pred = new Float64Array(n).fill(base);
  const rand = rng(o.seed);
  const trees = [];
  for (let r = 0; r < o.rounds; r++) {
    const g = y.map((v, i) => v - pred[i]);
    const rows = [];
    for (let i = 0; i < n; i++) if (rand() < o.subsample) rows.push(i);
    const tree = growTree(rows, g, B, edges, o);
    trees.push(tree);
    for (let i = 0; i < n; i++) pred[i] += o.lr * walkTree(tree, X[i]);
  }
  return { base, lr: o.lr, trees, features: F };
}

/** One tree, best split first, up to `leaves` leaves and `depth` levels. */
function growTree(rows, g, B, edges, o) {
  const leafValue = (rs) => rs.reduce((s, i) => s + g[i], 0) / (rs.length + o.lambda);
  const best = (rs) => {
    const F = edges.length;
    let top = null;
    const G = rs.reduce((s, i) => s + g[i], 0), N = rs.length;
    for (let f = 0; f < F; f++) {
      const nb = edges[f].length + 1;
      if (nb < 2) continue;
      const gs = new Float64Array(nb), cs = new Int32Array(nb);
      for (const i of rs) { gs[B[i][f]] += g[i]; cs[B[i][f]]++; }
      let gl = 0, cl = 0;
      for (let b = 0; b < nb - 1; b++) {
        gl += gs[b]; cl += cs[b];
        const cr = N - cl;
        if (cl < o.minLeaf || cr < o.minLeaf) continue;
        const gr = G - gl;
        const gain = (gl * gl) / (cl + o.lambda) + (gr * gr) / (cr + o.lambda) - (G * G) / (N + o.lambda);
        if (!top || gain > top.gain) top = { f, b, gain };
      }
    }
    return top && top.gain > 1e-9 ? top : null;
  };
  const root = { rows, depth: 0 };
  const open = [root];
  let leaves = 1;
  while (leaves < o.leaves) {
    let pick = null, pickI = -1;
    for (let k = 0; k < open.length; k++) {
      const nd = open[k];
      if (nd.depth >= o.depth) continue;
      if (nd.split === undefined) nd.split = best(nd.rows);
      if (nd.split && (!pick || nd.split.gain > pick.split.gain)) { pick = nd; pickI = k; }
    }
    if (!pick) break;
    const { f, b } = pick.split;
    const L = [], R = [];
    for (const i of pick.rows) (B[i][f] <= b ? L : R).push(i);
    pick.feature = f; pick.threshold = edges[f][b];
    pick.left = { rows: L, depth: pick.depth + 1 }; pick.right = { rows: R, depth: pick.depth + 1 };
    open.splice(pickI, 1, pick.left, pick.right);
    leaves++;
  }
  const finish = (nd) => {
    if (nd.left) return { f: nd.feature, t: nd.threshold, l: finish(nd.left), r: finish(nd.right) };
    return { v: leafValue(nd.rows) };
  };
  return finish(root);
}

function walkTree(t, x) {
  while (t.v === undefined) t = x[t.f] <= t.t || !Number.isFinite(x[t.f]) ? t.l : t.r;
  return t.v;
}

/** Predict one row. */
export function predictGBM(model, x) {
  if (!model) return null;
  let s = model.base;
  for (const t of model.trees) s += model.lr * walkTree(t, x);
  return s;
}
