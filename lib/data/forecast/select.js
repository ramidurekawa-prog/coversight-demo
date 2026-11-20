/**
 * Covercast picks its model by task. Each task is scored on the room's own
 * past with every candidate, on the same days:
 *
 *   day      covers per day: V1 (the original seven-method blend), V2 (V1 plus
 *            gradient-boosted trees in the blend) and each method alone
 *   service  lunch and dinner totals: V1 and V2 split by the weekday's shape,
 *            and the old rule (mean of 4 recent same weekdays)
 *   slot     covers per 15 minutes (per hour when order times aren't kept):
 *            V1's shape, the old rule, and gradient-boosted trees on the slot
 *   prep     units per item: the covers forecast × each item's recent share,
 *            against the item's own recent average and last week
 *
 * The pick is made on the first half of the scored window and then checked
 * on the second half, which played no part in choosing it. A candidate
 * replaces V1 only when it beats V1 by at least MARGIN on the first half, so
 * noise doesn't swap models back and forth. Every candidate's error is
 * reported for both halves.
 *
 * It also reports accuracy by kind of night (busy, special, ordinary): the
 * error, how often the actual landed above the range's top (the costly miss)
 * and how often the range held, so an average can't hide the nights that
 * matter.
 */
import { addDays, wdOf } from './calendar.js';
import { buildDays, byDay, dayContext, normalizeSignals, quantile, score, shapeFor, TUNING, usualSlots, walk } from './engine.js';
import { fitGBM, predictGBM } from './gbm.js';
import { METHOD_KEYS, METHODS, V1_KEYS, V2_KEYS } from './methods.js';

/** How much better (relative error) a challenger must be on the first half to replace V1. */
export const MARGIN = 0.05;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const LABELS = { v1: 'Covercast V1 (seven-method blend)', v2: 'Covercast V2 (blend + gradient-boosted trees)', old: 'Old rule (mean of 4 same weekdays)', gbm: 'Gradient-boosted trees', share: 'Covers forecast × item share', lastWeek: 'Same as last week', pick: 'The day pick, split down' };
export const labelOf = (k) => LABELS[k] ?? METHODS[k]?.label ?? k;

/**
 * Choose among candidates scored on two halves. rows: [{ half: 0|1, actual, [cand]: number }]
 * @param {any[]} rows @param {string[]} cands
 */
export function choose(rows, cands, { base = 'v1' } = {}) {
  const half = (h) => rows.filter((r) => r.half === h);
  const sc = (rs, k) => score(rs.filter((r) => r[k] != null), (r) => r[k]);
  const table = Object.fromEntries(cands.map((k) => [k, { label: labelOf(k), pick: sc(half(0), k), check: sc(half(1), k) }]));
  const ok = cands.filter((k) => table[k].pick && table[k].check && table[k].pick.n >= Math.max(10, 0.8 * (table[base]?.pick?.n ?? 0)));
  // A challenger must beat the base by MARGIN over the first half and also in each of its
  // two quarters (a model that won one lucky stretch doesn't count).
  const steady = (k) => [0, 1].every((qq) => {
    const rs = rows.filter((r) => r.half === 0 && r.quarter === qq);
    const a = sc(rs, k), b = sc(rs, base);
    return !a || !b || a.wape < b.wape;
  });
  let pick = table[base]?.pick ? base : ok[0] ?? null;
  for (const k of ok) {
    if (k === base || !table[pick]?.pick) continue;
    const bar = pick === base ? table[base].pick.wape * (1 - MARGIN) : table[pick].pick.wape;
    if (table[k].pick.wape < bar && steady(k)) pick = k;
  }
  const p = pick ? table[pick] : null, b = table[base];
  // On the half that played no part in the pick: did it hold up? Only then is it used.
  const heldUp = !!(p && b?.check && p.check.wape <= b.check.wape);
  const use = pick === base || heldUp ? pick : base;
  return {
    pick, label: pick ? labelOf(pick) : null, use, useLabel: use ? labelOf(use) : null, candidates: table,
    check: p && b?.check ? { pick: p.check.wape, base: b.check.wape, heldUp } : null,
  };
}

/** Mark rows' halves (and the first half's two quarters) by their own dates. */
function split(rows) {
  const ts = [...new Set(rows.map((r) => r.t))].sort((a, b) => a - b);
  if (!ts.length) return rows;
  const cut = (f) => ts[Math.min(ts.length - 1, Math.floor(ts.length * f))];
  const m = cut(0.5), q = cut(0.25);
  for (const r of rows) { r.half = r.t < m ? 0 : 1; r.quarter = r.t < q ? 0 : r.t < m ? 1 : 2; }
  return rows;
}

/**
 * Accuracy by kind of night. Busy is decided before the night: the usual
 * night's forecast in the top fifth of the room's last 13 weeks.
 * @param {any[]} rows walk rows (h=1) with f, final, q, special, censored
 * @param {any[]} D
 */
export function segments(rows, D, pick = (r) => r.final) {
  const seg = { busy: [], special: [], ordinary: [] };
  let censored = 0;
  for (const r of rows) {
    if (r.censored) { censored++; continue; }
    if (r.actual == null) continue;
    if (D[r.t].special || D[r.t].closed) { if (!D[r.t].closed) seg.special.push(r); continue; }
    const past = [];
    for (let i = r.t - 1; i >= 0 && i >= r.t - 91; i--) if (D[i].v != null && !D[i].skip) past.push(D[i].v);
    const busy = past.length >= 28 && r.f.current != null && r.f.current >= quantile(past, 0.8);
    (busy ? seg.busy : seg.ordinary).push(r);
  }
  const one = (rs) => {
    const s = score(rs, pick);
    if (!s) return { n: 0 };
    const cal = rs.filter((r) => r.calibrated);
    const high = (r) => pick(r) * r.q[1], low = (r) => pick(r) * r.q[0];
    return {
      ...s,
      oldWape: score(rs, (r) => r.f.current)?.wape ?? null,
      // Nights that came in above the range's top: under-prepped, under-staffed.
      aboveRange: cal.length ? Math.round((cal.filter((r) => r.actual > high(r)).length / cal.length) * 100) : null,
      coverage: cal.length ? Math.round((cal.filter((r) => r.actual >= low(r) && r.actual <= high(r)).length / cal.length) * 100) : null,
      enough: rs.length >= 10,
    };
  };
  return { busy: one(seg.busy), special: one(seg.special), ordinary: one(seg.ordinary), censored, note: 'Busy = the usual-night forecast in the top fifth of the last 13 weeks, decided before the night.' };
}

/* ----------------------------------------------------------- slot GBM */

/** Gradient-boosted trees correcting V1's slot forecast, refit every 4 weeks on the slots before. */
function slotGbm(tests) {
  const out = new Map();
  const row = (t, sl) => {
    const b = t.fc.get(sl) ?? 0;
    const u = t.old.get(sl) ?? 0, lw = t.lw?.get(sl) ?? NaN;
    return [wdOf(t.iso), sl, b, Math.log((u + 1) / (b + 1)), Number.isFinite(lw) ? Math.log((lw + 1) / (b + 1)) : NaN, t.day];
  };
  let model = null, fitAt = -1;
  for (let i = 0; i < tests.length; i++) {
    if (i >= 28 && (fitAt < 0 || i - fitAt >= 28)) {
      const X = [], y = [];
      for (const t of tests.slice(Math.max(0, i - 182), i)) for (const sl of t.slots) { X.push(row(t, sl)); y.push(Math.log(((t.act.get(sl) ?? 0) + 1) / ((t.fc.get(sl) ?? 0) + 1))); }
      model = fitGBM(X, y, { minLeaf: 20 });
      fitAt = i;
    }
    if (!model) continue;
    const t = tests[i];
    out.set(t.iso, new Map(t.slots.map((sl) => [sl, Math.max(0, ((t.fc.get(sl) ?? 0) + 1) * Math.exp(predictGBM(model, row(t, sl))) - 1)])));
  }
  return out;
}

/* -------------------------------------------------------------- tasks */

/**
 * Every task's pick for one room.
 * @param {{ days: any[], hours?: any[], quarters?: any[], items?: any[], itemWeeks?: any[] }} series
 * @param {{ signals?: any, evalDays?: number }} [opt]
 */
export function pickModels(series, { signals = {}, evalDays = TUNING.evalDays } = {}) {
  const ctx = dayContext(normalizeSignals(signals));
  const { D, last } = buildDays(series.days, 'covers', ctx);
  if (last < TUNING.minHistory + 60) return { ready: false, why: `Picking a model needs about ${TUNING.minHistory + 60} days of history; ${last + 1} on file.`, tasks: {} };
  const evalFrom = Math.max(TUNING.minHistory + 14, last - evalDays + 1);
  const from = Math.max(0, evalFrom - TUNING.warmDays);
  const mid = evalFrom + Math.floor((last - evalFrom + 1) / 2);
  const w1 = walk(D, 1, from, last, V1_KEYS), w2 = walk(D, 1, from, last, V2_KEYS);
  const w7a = walk(D, 7, from, last, V1_KEYS), w7b = walk(D, 7, from, last, V2_KEYS);
  const at = (w) => new Map(w.map((r) => [r.t, r]));
  const m1 = at(w1), m2 = at(w2), m7a = at(w7a), m7b = at(w7b);
  const tasks = {};

  // Day: a day ahead and a week ahead together, normal days only.
  const dayRows = [];
  for (const [m1x, m2x] of [[m1, m2], [m7a, m7b]]) {
    for (let t = evalFrom; t <= last; t++) {
      const a = m1x.get(t), b = m2x.get(t);
      if (!a || !b || a.special || a.actual == null) continue;
      const row = { t, actual: a.actual, v1: a.final, v2: b.final };
      for (const k of METHOD_KEYS) row[k] = b.f[k];
      dayRows.push(row);
    }
  }
  tasks.day = { unit: 'covers per day', ...choose(split(dayRows), ['v1', 'v2', ...METHOD_KEYS]) };
  const dayPick = tasks.day.use ?? 'v1';
  const pickOf = (t) => {
    const r = dayPick === 'v1' ? m1.get(t) : m2.get(t);
    if (!r) return null;
    return dayPick === 'v1' || dayPick === 'v2' ? r.final : r.f[dayPick] ?? null;
  };
  // Accuracy by kind of night, V1 and the pick, on the whole scored window.
  const scored = w1.filter((r) => r.t >= evalFrom);
  tasks.nights = {
    v1: segments(scored, D),
    pick: dayPick === 'v1' ? null : segments(scored.map((r) => ({ ...r, final: pickOf(r.t) ?? r.final })), D),
    soldOut: [...ctx.capacity.values()].filter((c) => c.soldOut).length,
    turnedAwayLogged: [...ctx.capacity.values()].filter((c) => c.turnedAway != null).length,
  };

  // Service and slot: from the hours (or quarters) on file.
  const quarters = (series.quarters?.length ?? 0) > 0 && new Set(series.quarters.map((q) => q.iso)).size >= 42;
  const detailH = byDay(series.hours, 'hour', 'covers');
  const detailS = quarters ? byDay(series.quarters, 'min', 'covers') : detailH;
  const skip = new Set(D.filter((d) => d.skip).map((d) => d.iso));
  const idx = new Map(D.map((d, i) => [d.iso, i]));
  const svcRows = [], slotTests = [];
  for (const iso of [...detailH.keys()].sort()) {
    const t = idx.get(iso);
    if (t == null || t < evalFrom - 56 || skip.has(iso)) continue;
    const a1 = m1.get(t), a2 = m2.get(t);
    const act = detailH.get(iso), shape = shapeFor(detailH, iso, { skip }), old = usualSlots(detailH, iso, 4);
    if (!a1 || !a2 || !act || !shape || !old) continue;
    for (const s of [{ key: 'lunch', from: 0, to: 16 }, { key: 'dinner', from: 16, to: 24 }]) {
      const inS = (h) => h >= s.from && h < s.to;
      const share = sum([...shape.shares].filter(([h]) => inS(h)).map(([, x]) => x));
      const actual = sum([...act].filter(([h]) => inS(h)).map(([, x]) => x));
      if (!(actual > 0) || t < evalFrom) continue;
      const pv = pickOf(t);
      svcRows.push({ t, service: s.key, actual, v1: a1.final * share, v2: a2.final * share, pick: pv == null ? null : pv * share, old: sum([...old].filter(([h]) => inS(h)).map(([, x]) => x)) });
    }
    const sAct = detailS.get(iso), sShape = shapeFor(detailS, iso, { skip }), sOld = usualSlots(detailS, iso, 4);
    if (!sAct || !sShape || !sOld) continue;
    const slots = [...new Set([...sAct.keys(), ...sShape.shares.keys()])].sort((x, y) => x - y);
    slotTests.push({ iso, t, slots, act: sAct, fc: new Map(slots.map((sl) => [sl, a1.final * (sShape.shares.get(sl) ?? 0)])), old: sOld, lw: detailS.get(addDays(iso, -7)) ?? null, day: a1.final });
  }
  if (svcRows.length >= 40) {
    const cands = ['v1', 'v2', 'old', ...(dayPick !== 'v1' && dayPick !== 'v2' ? ['pick'] : [])];
    tasks.service = { unit: 'covers per service', ...choose(split(svcRows), cands) };
    if (tasks.service.use === 'pick') tasks.service.useLabel = `${labelOf(dayPick)}, split by the weekday's shape`;
  } else tasks.service = { ready: false, why: 'Needs hour-by-hour history (Toast orders) to score lunch and dinner.' };
  if (slotTests.length >= 56) {
    const g = slotGbm(slotTests);
    const rows = [];
    for (const t of slotTests) {
      if (t.t < evalFrom) continue;
      const gm = g.get(t.iso);
      for (const sl of t.slots) {
        const actual = t.act.get(sl) ?? 0, v1 = t.fc.get(sl) ?? 0;
        if (!(actual > 0 || v1 > 0.5)) continue;
        rows.push({ t: t.t, actual, v1, old: t.old.get(sl) ?? 0, gbm: gm?.get(sl) ?? null });
      }
    }
    tasks.slot = { unit: quarters ? 'covers per 15 minutes' : 'covers per hour (order times by 15 minutes not on file)', ...choose(split(rows), ['v1', 'old', 'gbm']) };
  } else tasks.slot = { ready: false, why: 'Needs 8 weeks of hour-by-hour history to score the slots.' };

  tasks.prep = prepTask(series, { D, m1, pickOf, evalFrom, mid, last });
  return {
    ready: true, from: D[evalFrom].iso, through: D[last].iso, splitAt: D[mid].iso, margin: MARGIN, tasks,
    // What each task runs on: the pick when it held up on the second half, else V1.
    uses: Object.fromEntries(Object.entries(tasks).filter(([k, x]) => k !== 'nights' && typeof x?.use === 'string').map(([k, x]) => [k, x.use])),
  };
}

/**
 * Prep: units per item. With daily item counts (Toast), each day; with only
 * weekly units (the sample), each week (Monday to Sunday, forecast the Sunday
 * before is not possible from a day-ahead walk, so each day's day-ahead
 * forecast is summed, and the shares come from weeks before).
 */
function prepTask(series, { D, m1, pickOf, evalFrom, mid, last }) {
  const daily = (series.items?.length ?? 0) > 0;
  const rows = [];
  if (daily) {
    const byIso = new Map();
    for (const it of series.items) { if (!byIso.has(it.iso)) byIso.set(it.iso, new Map()); byIso.get(it.iso).set(it.item, it.qty); }
    const idx = new Map(D.map((d, i) => [d.iso, i]));
    for (const [iso, m] of byIso) {
      const t = idx.get(iso);
      if (t == null || t < evalFrom || t > last || D[t].skip) continue;
      const r = m1.get(t);
      if (!r) continue;
      // Each item's share of covers over the 4 same weekdays before.
      const back = [1, 2, 3, 4].map((k) => addDays(iso, -7 * k));
      for (const [item, qty] of m) {
        const pastQ = back.map((b) => byIso.get(b)?.get(item) ?? 0), pastC = back.map((b) => D[idx.get(b)]?.v ?? 0);
        const C = sum(pastC);
        if (!(C > 0)) continue;
        const share = sum(pastQ) / C;
        const pv = pickOf(t);
        rows.push({ t, actual: qty, v1: r.final * share, pick: pv == null ? null : pv * share, old: mean(pastQ), lastWeek: pastQ[0] });
      }
    }
  } else if (series.itemWeeks?.length) {
    const weeks = [...new Set(series.itemWeeks.map((w) => w.week))].sort();
    const cov = new Map(), f1 = new Map(), fp = new Map();
    const idx = new Map(D.map((d, i) => [d.iso, i]));
    for (const wk of weeks) {
      const t0 = idx.get(wk);
      if (t0 == null) continue;
      let c = 0, a = 0, b = 0, ok = true;
      for (let d = 0; d < 7; d++) {
        const t = t0 + d;
        if (t > last) { ok = false; break; }
        c += D[t].v ?? 0;
        if (t >= evalFrom) { const r = m1.get(t); if (!r) { ok = false; continue; } a += r.final; b += pickOf(t) ?? r.final; }
      }
      cov.set(wk, ok ? c : null);
      if (ok && t0 >= evalFrom) { f1.set(wk, a); fp.set(wk, b); }
    }
    const byItem = new Map();
    for (const w of series.itemWeeks) { if (!byItem.has(w.item)) byItem.set(w.item, new Map()); byItem.get(w.item).set(w.week, w.qty); }
    for (const [, m] of byItem) {
      weeks.forEach((wk, i) => {
        if (!f1.has(wk) || i < 4) return;
        const prev = weeks.slice(i - 4, i);
        const C = sum(prev.map((p) => cov.get(p) ?? 0));
        if (!(C > 0)) return;
        const pq = prev.map((p) => m.get(p) ?? 0);
        const share = sum(pq) / C;
        rows.push({ t: idx.get(wk), actual: m.get(wk) ?? 0, v1: f1.get(wk) * share, pick: fp.get(wk) * share, old: mean(pq), lastWeek: pq.at(-1) });
      });
    }
  }
  const real = rows.filter((r) => r.actual > 0);
  if (real.length < 40) return { ready: false, why: daily ? 'Needs about 4 more weeks of item sales to score prep.' : 'Needs item sales by day or by week to score prep.' };
  const res = choose(split(real), ['v1', 'pick', 'old', 'lastWeek'].filter((k) => k !== 'pick' || real.some((r) => r.pick !== r.v1)));
  if (res.use === 'v1') res.useLabel = 'Covercast covers × each item’s recent share';
  // The misses prep is sized from (first half only), at most 200 of them.
  const misses = real.filter((r) => r.half === 0 && r.v1 > 0).map((r) => Math.round((r.actual / r.v1) * 1000) / 1000).sort((a, b) => a - b);
  res.misses = misses.length > 200 ? Array.from({ length: 200 }, (_, i) => misses[Math.floor((i / 199) * (misses.length - 1))]) : misses;
  return { unit: daily ? 'units per item per day' : 'units per item per week (the sample keeps weekly counts only)', ...res };
}
