// Data inputs page: the pure parts the browser and the server share, so an
// import is mapped, checked, previewed, confirmed and summarised by exactly
// the same rules on both sides (the preview and the commit can't disagree).
import { applyInputs } from '../apply.js';
import { SCHEMAS, KINDS, preview, validate } from '../ingest.js';
import { deriveRoom, money } from '../model.js';
import { findingBlocked, findingStatus } from '../findings.js';

/* ------------------------------------------------------------------ kinds */
/** The order that gives a sensible room fastest when trying Coversight on your own restaurant. */
export const STEP_ORDER = ['profile', 'recipes', 'exceptions', 'channels', 'counts', 'invoices', 'waste'];
/** The first five are the "try it on your own restaurant" steps. */
export const OWN_STEPS = {
  profile: 'Renames the room everywhere.',
  recipes: 'Earned, food cost and the menu moves come from here.',
  exceptions: 'Labour and every control limit come from here.',
  channels: 'Delivery share, refunds and the markup range.',
  counts: 'Add what came in, unit cost and expected use, and usage gaps appear.',
};

/** Per kind: why Coversight needs it, what it unlocks, how long it takes, and how best to bring it in. */
export const NEEDS = {
  profile: { why: 'Seats and covers set margin per cover and every per-seat figure.', unlocks: 'Per-cover and per-seat figures for this room.', minutes: 1, method: 'type' },
  recipes: { why: 'Plate costs decide food cost and whether a price move is worth making.', unlocks: 'Menu price moves, food cost and dish margins.', minutes: 15, method: 'link' },
  exceptions: { why: 'Voids, comps, discounts and hours per person set every control limit and the labour line.', unlocks: 'Control limits, labour and overtime moves.', minutes: 10, method: 'toast' },
  channels: { why: 'Sales, orders and refunds per channel show what delivery really keeps.', unlocks: 'Channel contribution and the delivery markup range.', minutes: 3, method: 'photo' },
  counts: { why: 'A shelf count against what the menu should have used is the only way to see usage gaps.', unlocks: 'Usage gaps by item and the spot-count moves.', minutes: 10, method: 'link' },
  invoices: { why: 'Unit prices per item split vendor price rises from your own buying mix.', unlocks: 'Vendor price moves and the renegotiation finding.', minutes: 10, method: 'photo' },
  waste: { why: 'Logged waste explains part of a usage gap, so it isn’t counted as unexplained.', unlocks: 'Explained versus unexplained usage gaps.', minutes: 2, method: 'type' },
};
export const METHODS = {
  toast: { label: 'Comes from Toast', icon: 'PlugZap', how: 'Connect Toast once and this keeps itself current.' },
  link: { label: 'Link the sheet you keep', icon: 'Link2', how: 'Paste a Google Sheets or Dropbox link; it’s read again every morning.' },
  photo: { label: 'Snap the statement', icon: 'Camera', how: 'A photo or PDF is read into rows for you to check.' },
  upload: { label: 'Upload a file', icon: 'Upload', how: 'Drop a CSV or Excel file; columns are matched for you.' },
  type: { label: 'Type it in', icon: 'PencilLine', how: 'A short form, pre-filled with what’s there now.' },
};

/** Which findings (plan candidates) rest on which kind of input. */
export function dependsOn(kind, c) {
  switch (kind) {
    case 'recipes': return c.kind === 'price' || c.needs === 'recipes' || c.lever === 'Menu';
    case 'invoices': return c.kind === 'vendor';
    case 'counts': case 'waste': return c.kind === 'usage';
    case 'channels': return c.kind === 'markup';
    case 'exceptions': return c.kind === 'voids' || c.kind === 'comps' || c.lever === 'Labour' || c.lever === 'Controls';
    case 'profile': return c.lever === 'Throughput';
    default: return false;
  }
}
/** Which test levers read which kind, so a running test on them is flagged when the data under it changes. */
export const KIND_LEVERS = { recipes: ['menu_margin', 'mix'], exceptions: ['void_comp', 'labour', 'overtime'], profile: ['turns', 'labour'], channels: [], counts: [], invoices: [], waste: [] };
/** Kinds a Toast feed already supplies for a room on Toast data: a hand entry over it needs an explicit yes. */
export const TOAST_SUPPLIES = ['exceptions', 'channels'];

/* ------------------------------------------------------------------ language */
/** Exact financial labels for the figures a preview shows (spec 2.4). */
const LABELS = {
  'Earned, this week': 'Contribution after food and labour, this week',
  'Earned per seat, this week': 'Contribution after food and labour per seat, this week',
  'Open exposure': 'Potential opportunity, per week',
  'Banked this week': 'Verified savings, this week',
  'Banked to date': 'Verified savings to date',
};
export const relabel = (l) => LABELS[l] || l;

/* ------------------------------------------------------------------ options */
/** Only `{ replace: true }` on a kind that can replace the sample list; anything else is dropped. */
export function cleanOpts(kind, opts) {
  return SCHEMAS[kind]?.replace && opts && typeof opts === 'object' && opts.replace === true ? { replace: true } : undefined;
}

/* ------------------------------------------------------------------ fingerprints */
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
/** A short content hash (FNV-1a, two lanes): the same rows always give the same print, in any key order. */
export function fingerprint(value) {
  const s = typeof value === 'string' ? value : stable(value);
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * The waste log grows; every other kind replaces what was there. A waste row
 * already in the log (same item, quantity, reason and date) is not added
 * again, so uploading the same sheet twice can't double the waste.
 */
export function mergeRows(kind, prior, rows) {
  if (kind !== 'waste') return { rows, duplicates: 0 };
  const seen = new Set((prior || []).map((r) => fingerprint(r)));
  const fresh = [];
  let duplicates = 0;
  for (const r of rows) {
    const k = fingerprint(r);
    if (seen.has(k)) { duplicates++; continue; }
    seen.add(k);
    fresh.push(r);
  }
  return { rows: [...(prior || []), ...fresh], duplicates, added: fresh.length };
}

/* ------------------------------------------------------------------ mapping */
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Aliases that can quietly swap money or unit meanings; matching one needs a person to confirm it. */
const RISKY = {
  recipes: { covers: 'Covers aren’t plates of one dish', cost: 'Is this plate cost, or a case price?' },
  invoices: { price: 'Per unit, or per case?', cost: 'Per unit, or per case?', cases: 'Cases, or units?', units: 'Units, or cases?' },
  counts: { cost: 'Cost per counted unit, or per case?', in: '“In” as received?' },
  channels: { gross: 'Gross sales were matched to net sales', revenue: 'Is revenue before or after refunds and commissions?' },
  exceptions: { voids: 'All voids, or only post-send voids?', void: 'All voids, or only post-send voids?' },
};

/**
 * How each header in a pasted or uploaded table was matched. Exact matches
 * (the column's key or label) are safe; an alias that can change a money or
 * unit meaning is flagged for confirmation, never silently assumed.
 * @returns {{ rows: { header: string, col: string|null, how: 'exact'|'alias'|'none', risk: string|null }[], needsConfirm: boolean }}
 */
export function mappingReview(headers, kind, map) {
  const cols = SCHEMAS[kind].columns;
  const rows = headers.map((h) => {
    const col = map[h] ?? null;
    if (!col) return { header: h, col: null, how: 'none', risk: null };
    const c = cols.find((x) => x.k === col);
    const exact = key(h) === key(c.k) || key(h) === key(c.label);
    const risk = exact ? null : (RISKY[kind]?.[key(h)] ?? ((c.type === 'money' || c.type === 'number') ? `“${h}” was read as ${c.label.toLowerCase()}` : null));
    return { header: h, col, how: exact ? 'exact' : 'alias', risk };
  });
  return { rows, needsConfirm: rows.some((r) => r.risk) };
}

/* ------------------------------------------------------------------ extra checks */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A waste-log date as written by hand: 2026-10-03, 10/3/2026, 10/3, Oct 3. Returns a UTC day, or null. */
export function parseDay(t, now = new Date()) {
  const s = String(t || '').trim();
  if (!s) return null;
  let y, m, d;
  let x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (x) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) [m, d, y] = [+x[1], +x[2], x[3] ? (+x[3] < 100 ? 2000 + +x[3] : +x[3]) : now.getUTCFullYear()];
  else if ((x = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/)) && MONTHS.includes(x[1].toLowerCase())) [m, d, y] = [MONTHS.indexOf(x[1].toLowerCase()) + 1, +x[2], x[3] ? +x[3] : now.getUTCFullYear()];
  else return null;
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCMonth() === m - 1 && day.getUTCDate() === d ? day : null;
}
const near = (a, b) => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length] <= 2;
};
/** An existing name that's probably the same thing spelled differently (never matched without a yes). */
function lookalike(name, names) {
  const k = key(name);
  if (k.length < 4 || names.some((n) => key(n) === k)) return null;
  return names.find((n) => { const nk = key(n); return nk.length >= 4 && (near(k, nk) || (k.length >= 5 && (nk.includes(k) || k.includes(nk)))); }) ?? null;
}

/**
 * Checks on top of the schema's own rules: dates, look-alike names, unit
 * changes. Issues with `confirm` set don't block, but need an explicit yes.
 * Rows are already validated (schema keys, parsed values).
 */
export function extraChecks(kind, rows, room, { now = new Date() } = {}) {
  const out = [];
  const add = (row, col, level, msg, confirm = false) => out.push({ row, col, level, msg, ...(confirm ? { confirm: true } : {}) });
  if (!room) return out;
  rows.forEach((r, i) => {
    const n = i + 1;
    if (kind === 'waste') {
      if (!r.date) add(n, 'date', 'warn', 'No date: a repeat upload of the same row can’t be told apart, so identical rows are logged once');
      else {
        const day = parseDay(r.date, now);
        if (!day) add(n, 'date', 'error', `“${r.date}” isn’t a date (use 2026-10-03, 10/3 or Oct 3)`);
        else if (day.getTime() > now.getTime() + 864e5) add(n, 'date', 'error', 'Dated in the future');
        else if (day.getTime() < now.getTime() - 35 * 864e5) add(n, 'date', 'warn', 'Older than the 28-day window; it won’t explain this period’s gap');
      }
    }
    if (kind === 'recipes') {
      const like = lookalike(r.dish, (room.menu || []).map((m) => m.name));
      if (like) add(n, 'dish', 'warn', `Looks like “${like}”. If it’s the same dish, use that name; otherwise it’s added as a new dish`, true);
    }
    if (kind === 'invoices') {
      const hit = (room.invoices || []).find((s) => key(s.item) === key(r.item));
      if (!r.unit) add(n, 'unit', 'warn', 'No unit: a pack-size change can’t be told from a price change');
      else if (hit?.unit && key(hit.unit) !== key(r.unit)) add(n, 'unit', 'warn', `Unit changed from ${hit.unit} to ${r.unit}; the price is compared per ${r.unit} from now on`, true);
      if (!hit) { const like = lookalike(r.item, (room.invoices || []).map((s) => s.item)); if (like) add(n, 'item', 'warn', `Looks like “${like}”. Same item?`, true); }
    }
    if (kind === 'counts') {
      const hit = (room.counts || []).find((c) => key(c.item) === key(r.item) || key(c.label) === key(r.item));
      if (hit?.unit && r.unit && key(hit.unit) !== key(r.unit)) add(n, 'unit', 'warn', `Counted in ${r.unit}, but this item is tracked in ${hit.unit}`, true);
      if (!hit) { const like = lookalike(r.item, (room.counts || []).map((c) => c.label || c.item)); if (like) add(n, 'item', 'warn', `Looks like “${like}”. Same item?`, true); }
    }
    if (kind === 'exceptions') {
      if (!(room.staff || []).some((s) => key(s.name) === key(r.employee))) {
        const like = lookalike(r.employee, (room.staff || []).map((s) => s.name));
        if (like) add(n, 'employee', 'warn', `Looks like “${like}”. Same person?`, true);
      }
    }
  });
  return out;
}

/* ------------------------------------------------------------------ check */
/**
 * Check rows exactly as the review panel does: the schema's rules plus the
 * extra checks. Rows already carry the schema's keys unless `mapping` is given.
 * @param {string} kind
 * @param {object[]} rawRows
 * @param {any} room
 * @param {any} [opts]
 * @param {{ mapping?: Record<string, string> | null, now?: Date }} [o]
 * @returns {{ ok: boolean, rows: any[], issues: any[], errors: number, warnings: number, error: string|null }}
 */
export function checkRows(kind, rawRows, room, opts, { mapping = null, now } = {}) {
  if (!SCHEMAS[kind]) return { ok: false, rows: [], issues: [], errors: 1, warnings: 0, error: `unknown kind '${kind}'` };
  if (!room) return { ok: false, rows: [], issues: [], errors: 1, warnings: 0, error: 'That room has no data to check against.' };
  const v = validate(kind, rawRows, room, mapping, cleanOpts(kind, opts) || {});
  // Extra checks number rows like the table does, so they run once every row passed the schema.
  const aligned = !v.errors && v.rows.length === rawRows.length;
  const issues = [...v.issues, ...(aligned ? extraChecks(kind, v.rows, room, { now }) : [])];
  const errors = issues.filter((x) => x.level === 'error').length;
  const first = issues.find((x) => x.level === 'error');
  // A rule can drop a row without an error; refuse that too, so nothing is silently lost.
  const dropped = !first && v.rows.length !== rawRows.length ? `${rawRows.length - v.rows.length} row${rawRows.length - v.rows.length === 1 ? ' was' : 's were'} not accepted` : null;
  const error = first ? `${first.row ? `Row ${first.row}${first.col ? ` (${first.col})` : ''}: ` : ''}${first.msg}` : dropped;
  return { ok: !error, rows: v.rows, issues, errors: errors + (dropped ? 1 : 0), warnings: issues.length - errors, error };
}
/** @deprecated name kept for the first version of this page. */
export const recheck = (kind, rows, room, opts) => checkRows(kind, rows, room, opts);

/* ------------------------------------------------------------------ preview */
const NAME = { recipes: 'dish', invoices: 'item', counts: 'item', channels: 'channel', exceptions: 'employee' };
const EXISTING = {
  recipes: (room) => room.menu.filter((m) => !m.balancing).map((m) => ({ name: m.name, keys: [m.name, m.key], vals: { price: m.price, cost: m.cost, units: m.units } })),
  invoices: (room) => room.invoices.map((s) => ({ name: s.item, keys: [s.item], vals: { unit_price: s.p1, qty: s.q1 } })),
  counts: (room) => room.counts.map((c) => ({ name: c.label || c.item, keys: [c.item, c.label], vals: { close: c.close, open: c.open, received: c.received, unit_cost: c.cost } })),
  channels: (room) => room.channels.map((c) => ({ name: c.name, keys: [c.name], vals: { sales: c.sales, refunds: c.refunds } })),
  exceptions: (room) => room.staff.map((s) => ({ name: s.name, keys: [s.name], vals: { sales: s.sales, post_send_voids: s.postVoid, comps: s.comps, discounts: s.disc, rate: s.rate } })),
};

/**
 * Which rows match what's there, which are new, which values they overwrite,
 * and (when replacing) which existing rows drop out.
 */
export function diffRows(kind, rows, room, opts) {
  if (kind === 'profile') {
    const r = rows[0] || {};
    const was = { name: room.profile.name, seats: room.profile.seats, covers: room.anchor?.covers };
    const overwrites = Object.entries(was).filter(([k, v]) => r[k] != null && v != null && String(r[k]) !== String(v)).map(([k, v]) => ({ name: 'Profile', field: k, from: v, to: r[k] }));
    return { matched: 1, added: 0, updated: overwrites.length ? 1 : 0, unchanged: overwrites.length ? 0 : 1, removed: [], overwrites };
  }
  if (kind === 'waste') return { matched: 0, added: rows.length, updated: 0, unchanged: 0, removed: [], overwrites: [] };
  const existing = EXISTING[kind]?.(room) || [];
  const nameKey = NAME[kind];
  let matched = 0, added = 0, updated = 0, unchanged = 0;
  const overwrites = [];
  const hitNames = new Set();
  for (const r of rows) {
    const e = existing.find((x) => x.keys.some((k) => key(k) === key(r[nameKey])));
    if (!e) { added++; continue; }
    matched++;
    hitNames.add(e.name);
    const changed = Object.entries(e.vals).filter(([k, v]) => r[k] != null && v != null && Math.abs(Number(r[k]) - Number(v)) > 1e-9);
    if (changed.length) { updated++; changed.forEach(([k, v]) => overwrites.push({ name: e.name, field: k, from: v, to: r[k] })); } else unchanged++;
  }
  const removed = cleanOpts(kind, opts)?.replace ? existing.filter((e) => !hitNames.has(e.name)).map((e) => e.name) : [];
  return { matched, added, updated, unchanged, removed, overwrites };
}

/**
 * Why a finding can't be acted on yet, given the room's live inputs. A finding
 * tagged `needs: 'recipes'` is no longer waiting once recipe costs have been
 * entered (findings.js alone can't see that; see the PR notes).
 */
export function blockedWhy(c, room, roomInputs = {}) {
  const why = findingBlocked(c, room);
  if (!why) return null;
  if (c.needs && roomInputs?.[c.needs] && !(c.kind === 'price' && (room.menu || []).find((m) => m.key === c.item)?.costEstimated)) return null;
  return why;
}

/** How the plan's findings change: value moves, ones a missing input no longer blocks, and new or dropped ones. */
export function findingsDiff(before, after, roomBefore, roomAfter, inputsBefore = {}, inputsAfter = {}) {
  const b = new Map(before.candidates.map((c) => [c.id, c]));
  const a = new Map(after.candidates.map((c) => [c.id, c]));
  const out = { changed: [], unblocked: [], blocked: [], added: [], gone: [] };
  for (const [id, c] of a) {
    const p = b.get(id);
    if (!p) { out.added.push({ id, title: c.title, value: c.value, claim: c.claim }); continue; }
    const wasBlocked = !!blockedWhy(p, roomBefore, inputsBefore), isBlocked = !!blockedWhy(c, roomAfter, inputsAfter);
    if (wasBlocked && !isBlocked) out.unblocked.push({ id, title: c.title, value: c.value, claim: c.claim });
    if (!wasBlocked && isBlocked) out.blocked.push({ id, title: c.title, value: c.value, claim: c.claim });
    if (Math.abs((c.value || 0) - (p.value || 0)) >= 1) out.changed.push({ id, title: c.title, from: p.value, to: c.value, claim: c.claim });
  }
  for (const [id, c] of b) if (!a.has(id)) out.gone.push({ id, title: c.title, value: c.value, claim: c.claim });
  return out;
}

/** Running or waiting tests in this room on a lever this kind feeds: their data changes under them. */
export function affectedWindows(kind, windows, roomId) {
  const levers = KIND_LEVERS[kind] || [];
  return (windows || []).filter((w) => w.roomId === roomId && levers.includes(w.lever) && (w.status === 'running' || w.status === 'waiting'))
    .map((w) => ({ id: w.id, title: w.title, lever: w.lever, status: w.status }));
}

/**
 * Why this commit needs an explicit yes before it lands (spec 8.4 "Confirm").
 * The server re-derives the same list and refuses without `confirm: true`.
 */
export function confirmReasons({ kind, opts, issues = [], diff, liveRoomInputs = {}, mappingNeedsConfirm = false }) {
  const out = [];
  if (cleanOpts(kind, opts)?.replace) out.push(`Replaces the sample ${kind === 'recipes' ? 'menu' : 'staff'}${diff?.removed?.length ? `: ${diff.removed.length} ${kind === 'recipes' ? 'dishes' : 'people'} drop out` : ''}.`);
  if (TOAST_SUPPLIES.includes(kind) && liveRoomInputs.toast) out.push('Toast already supplies this for this room. Your rows take its place until you undo them.');
  if (diff && diff.matched >= 4 && diff.updated / diff.matched > 0.5) out.push(`Overwrites values on ${diff.updated} of ${diff.matched} existing rows.`);
  const flagged = issues.filter((x) => x.confirm).length;
  if (flagged) out.push(`${flagged} row${flagged === 1 ? ' needs' : 's need'} a second look (look-alike names or a changed unit).`);
  if (mappingNeedsConfirm) out.push('Some columns were matched by a guess that can change a money or unit meaning.');
  return out;
}

/**
 * Everything the preview shows, computed the way the commit computes it.
 * `base` is the group's own data (no inputs), `inputs` the live inputs.
 * @param {{ base: any, inputs: any, roomId: string, kind: string, rows: any[], opts?: any, windows?: any[], issues?: any[], mappingNeedsConfirm?: boolean }} a
 * @returns {any}
 */
export function analyze({ base, inputs, roomId, kind, rows, opts, windows = [], issues = [], mappingNeedsConfirm = false }) {
  const o = cleanOpts(kind, opts);
  const prior = inputs?.[roomId]?.[kind]?.rows || [];
  const merged = mergeRows(kind, kind === 'waste' ? prior : [], rows);
  const dsBefore = applyInputs(base, inputs);
  const roomBefore = dsBefore.rooms[roomId];
  const nextInputs = { ...inputs, [roomId]: { ...(inputs?.[roomId] || {}), [kind]: { rows: merged.rows, date: 'preview', label: SCHEMAS[kind].title, n: merged.rows.length, ...(o ? { opts: o } : {}) } } };
  const dsAfter = applyInputs(base, nextInputs);
  const pv = preview(base, inputs, roomId, kind, merged.rows, o);
  const diff = diffRows(kind, kind === 'waste' ? merged.rows.slice(prior.length) : rows, roomBefore, o);
  const findings = findingsDiff(deriveRoom(dsBefore, roomId), deriveRoom(dsAfter, roomId), roomBefore, dsAfter.rooms[roomId], inputs?.[roomId] || {}, nextInputs[roomId]);
  const tests = affectedWindows(kind, windows, roomId);
  const live = inputs?.[roomId]?.[kind];
  const same = !!live && fingerprint(live.rows) === fingerprint(merged.rows) && !!live.opts?.replace === !!o?.replace;
  return {
    rows: merged.rows,
    duplicates: merged.duplicates,
    unchanged: same || (kind === 'waste' && merged.added === 0),
    fingerprint: fingerprint(merged.rows),
    moves: pv.moves.map((m) => ({ ...m, label: relabel(m.label) })),
    frozen: pv.frozen.map((m) => ({ ...m, label: relabel(m.label) })),
    diff,
    findings,
    tests,
    confirm: confirmReasons({ kind, opts: o, issues, diff, liveRoomInputs: inputs?.[roomId] || {}, mappingNeedsConfirm }),
  };
}

/** The audit line for a commit: which figures moved, from the same preview the screen shows. */
export function commitSummary(base, inputs, roomId, kind, rows, opts) {
  const o = cleanOpts(kind, opts);
  const pv = preview(base, inputs, roomId, kind, rows, o);
  const changed = pv.moves.filter((m) => m.changed).map((m) => `${relabel(m.label)}: ${m.before} → ${m.after}`);
  return `${o?.replace ? 'Replaced the sample list. ' : ''}${changed.length ? changed.join('; ') : 'No figure moved'}`.slice(0, 400);
}

/** The room as the review panel sees it: base data with every live input applied. */
export function roomFor(base, inputs, roomId) {
  return applyInputs(base, inputs).rooms[roomId] || null;
}

/* ------------------------------------------------------------------ history */
/**
 * Which log entries are what a room holds now: the newest live entry per room
 * and kind. Only those can be undone (undoing an older one would bring back
 * data that a later entry already replaced). `log` is newest first.
 */
export function currentIds(log) {
  const seen = new Set();
  const ids = new Set();
  for (const e of log || []) {
    if (e.undone) continue;
    const k = `${e.room}/${e.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    ids.add(e.id);
  }
  return ids;
}

/* ------------------------------------------------------------------ status */
/**
 * Where each kind of a room's data comes from now, for the status board.
 * `entry` is the room's live hand entry (engine shape), `feed` the room's feed
 * for that kind, `linked` whether a linked sheet feeds it.
 */
export function sourceOf({ entry, feed, linked }) {
  if (linked && entry) return { key: 'linked', label: 'Linked sheet', tone: 'info', icon: 'Link2' };
  if (entry) return { key: 'hand', label: 'Your data', tone: 'good', icon: 'CircleCheck' };
  if (linked) return { key: 'linked', label: 'Linked, not loaded', tone: 'warn', icon: 'Link2' };
  if (feed && feed.state === 'off') return { key: 'none', label: 'Nothing yet', tone: 'neutral', icon: 'CircleDashed' };
  if (feed && feed.state !== 'healthy') return { key: 'stale', label: `Sample · feed ${feed.state}`, tone: 'warn', icon: 'TriangleAlert' };
  return { key: 'sample', label: 'Sample data', tone: 'neutral', icon: 'CircleDashed' };
}

const FEED_OF = { recipes: 'Recipe costs', invoices: 'Invoices', counts: 'Inventory counts', waste: 'Waste log', channels: 'Delivery statements', exceptions: 'Toast' };

/**
 * What needs attention, most important first (spec 8.2): kinds whose data is
 * missing or stale, ranked by the findings they block, the opportunity that
 * can't be evaluated without them, how stale they are, and how quick the fix
 * is. Each item says what's missing, why, what it unlocks, and the best way in.
 * @param {object} d deriveRoom() of the room
 * @param {object} room the applied room
 * @param {{ windows?: object[], linkedKinds?: Set<string>, server?: boolean }} ctx
 */
export function attention(d, room, { windows = [], linkedKinds = new Set(), server = false } = {}) {
  const toast = !!d.inputs?.toast;
  const items = [];
  for (const kind of STEP_ORDER) {
    const entry = d.inputs?.[kind];
    const feed = FEED_OF[kind] ? d.feeds.find((f) => f.name === FEED_OF[kind]) : null;
    const deps = d.candidates.filter((c) => dependsOn(kind, c) && !c.prevent);
    const blocked = deps.filter((c) => { const why = blockedWhy(c, room, d.inputs || {}); return why && (kind === 'recipes' ? true : c.needs === kind); });
    const stale = feed && feed.state !== 'healthy' && !feed.manual;
    if (!blocked.length && !stale) continue;
    const exposure = blocked.reduce((s, c) => s + (c.value || 0), 0);
    const testing = deps.filter((c) => findingStatus(c, windows, d.id).state === 'testing').length;
    const urgency = !feed ? 0 : feed.state === 'off' ? 3 : feed.state === 'stale' ? 2 : feed.state === 'partial' ? 1 : 0;
    const auto = kind === 'exceptions' && !toast;
    const score = blocked.length * 100 + exposure / 5 + urgency * 20 + deps.length * 5 + testing * 10 - NEEDS[kind].minutes + (auto ? 5 : 0);
    const method = NEEDS[kind].method === 'toast' && toast ? 'upload' : NEEDS[kind].method === 'link' && !server ? 'upload' : NEEDS[kind].method;
    const missing = blocked.length
      ? `${blocked.length === 1 ? `“${blocked[0].title}”` : `${blocked.length} findings`} can’t be acted on until this is current.`
      : feed.state === 'off' ? 'Nothing has come in yet.'
        : `${feed.state === 'stale' ? 'Out of date' : 'Incomplete'}: last ${feed.last}.${feed.note ? ` ${feed.note}` : ''}`;
    items.push({
      kind, score, entry: entry || null, feed: feed ? { state: feed.state, last: feed.last } : null,
      title: SCHEMAS[kind].title, missing, why: NEEDS[kind].why, unlocks: NEEDS[kind].unlocks,
      blocked: blocked.map((c) => ({ id: c.id, title: c.title, value: c.value, claim: c.claim })),
      exposure, findings: deps.length, minutes: NEEDS[kind].minutes, method, linked: linkedKinds.has(kind),
      last: entry ? `${entry.date} · entered here` : feed ? feed.last : 'Never',
    });
  }
  return items.sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ exports */
/** CSV with spreadsheet-formula cells neutralised (=, +, -, @, tab, CR lead a cell → prefixed with '). */
export function safeCSV(columns, rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

export { KINDS, SCHEMAS, money };
