// Data inputs page: the pure parts the browser and the server share, so a
// commit is checked and summarised the same way on both sides.
import { applyInputs } from '../apply.js';
import { SCHEMAS, KINDS, preview, validate } from '../ingest.js';

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

/** Only `{ replace: true }` on a kind that can replace the sample list; anything else is dropped. */
export function cleanOpts(kind, opts) {
  return SCHEMAS[kind]?.replace && opts && typeof opts === 'object' && opts.replace === true ? { replace: true } : undefined;
}

/** The waste log grows; every other kind replaces what was there. */
export function mergeRows(kind, prior, rows) {
  return kind === 'waste' ? [...(prior || []), ...rows] : rows;
}

/**
 * Re-check rows that are about to be committed, exactly as the review panel
 * checked them. Rows already carry the schema's keys, so no column mapping.
 * @returns {{ ok: boolean, rows: object[], error: string | null, errors: number, warnings: number }}
 */
export function recheck(kind, rows, room, opts) {
  if (!SCHEMAS[kind]) return { ok: false, rows: [], error: `unknown kind '${kind}'`, errors: 1, warnings: 0 };
  if (!room) return { ok: false, rows: [], error: 'That room has no data to check against.', errors: 1, warnings: 0 };
  const v = validate(kind, rows, room, null, cleanOpts(kind, opts) || {});
  const first = v.issues.find((x) => x.level === 'error');
  const error = first ? `${first.row ? `Row ${first.row}${first.col ? ` (${first.col})` : ''}: ` : ''}${first.msg}` : null;
  // A rule can drop a row without an error; refuse that too, so nothing is silently lost.
  const dropped = !first && v.rows.length !== rows.length ? `${rows.length - v.rows.length} row${rows.length - v.rows.length === 1 ? ' was' : 's were'} not accepted` : null;
  return { ok: !first && !dropped, rows: v.rows, error: error || dropped, errors: v.errors, warnings: v.warnings };
}

/** The audit line for a commit: which figures moved, from the same preview the screen shows. */
export function commitSummary(base, inputs, roomId, kind, rows, opts) {
  const o = cleanOpts(kind, opts);
  const pv = preview(base, inputs, roomId, kind, rows, o);
  const changed = pv.moves.filter((m) => m.changed).map((m) => `${m.label}: ${m.before} → ${m.after}`);
  return `${o?.replace ? 'Replaced the sample list. ' : ''}${changed.length ? changed.join('; ') : 'No figure moved'}`.slice(0, 400);
}

/** The room as the review panel sees it: base data with every live input applied. */
export function roomFor(base, inputs, roomId) {
  return applyInputs(base, inputs).rooms[roomId] || null;
}

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

export { KINDS, SCHEMAS };
