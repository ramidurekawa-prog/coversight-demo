/**
 * The casebook: how each consultant agent learns from its own calls.
 *
 * Every lever has a consultant (Roster Coach for labor, Price Watch for
 * supplier prices, and so on: the names live in lib/ai/agents.js). Each one
 * keeps a casebook, one *case* per call it made, in the shape of the master
 * spec's outcome record (System 16): the restaurant, the problem, what it
 * suggested and what it estimated, who carried it out, how it was measured
 * and how it ended. From the casebook it learns four things, and nothing is
 * learned any other way (the model is never retrained):
 *
 *  1. its record: how often its calls held up when they were measured
 *     (the spec's P(E), P(M|E) and P(P|M), shown as counts, never as one score)
 *  2. its aim: how its estimates compared with what was measured, so its next
 *     estimate can be read against its own history
 *  3. its lessons: what each ending taught it, in one sentence a person can read
 *  4. its authority: the level it has earned (A0 observes ... A4 holds the
 *     line), computed from evidence, dropped after a guardrail breaks, and
 *     only ever *used* at the level a person grants (the `autonomy` key).
 *
 * Learning crosses rooms inside one group (a change that held at Walnut Creek
 * makes the Oakland consultant more confident). It never crosses groups: the
 * benchmark network (System 17) needs 20 comparable restaurants from 5
 * groups, and until then this says so instead of borrowing anyone's data.
 *
 * Pure. Every count comes from the room's proofs, test windows and saved
 * decisions. Nothing here invents a figure.
 */
import { money } from '../data/model.js';
import { NOW } from '../data/seed.js';

export const CASEBOOK_VERSION = 'casebook-1';

/** The lever consultants: the proof lever, the page that owns it, the fact topic it speaks for and its name (the page agent's, lib/ai/agents.js; tests/casebook.test.js keeps them in step). */
export const CONSULTANTS = [
  { lever: 'Labour', page: 'labour', topic: 'labor', area: 'labor', name: 'Roster Coach' },
  { lever: 'Menu', page: 'menu', topic: 'menu', area: 'menu prices', name: 'Menu Maker' },
  { lever: 'Purchasing', page: 'purchasing', topic: 'purchasing', area: 'supplier prices', name: 'Price Watch' },
  { lever: 'Inventory', page: 'inventory', topic: 'stock', area: 'food and drink used', name: 'Stock Sleuth' },
  { lever: 'Controls', page: 'controls', topic: 'comps', area: 'comps and voids', name: 'Register Guard' },
  { lever: 'Throughput', page: 'throughput', topic: 'seats', area: 'tables', name: 'Seat Finder' },
  { lever: 'Kitchen', page: 'kitchen', topic: 'kitchen', area: 'kitchen speed', name: 'Line Coach' },
  { lever: 'Channels', page: 'channels', topic: 'delivery', area: 'delivery', name: 'Delivery Desk' },
];
const BY_LEVER = Object.fromEntries(CONSULTANTS.map((c) => [c.lever, c]));
/** Lever names as test windows and older records spell them. */
const LEVER_ALIAS = { labor: 'Labour', labour: 'Labour', menu: 'Menu', menu_margin: 'Menu', purchasing: 'Purchasing', inventory: 'Inventory', stock: 'Inventory', controls: 'Controls', comps: 'Controls', void_comp: 'Controls', throughput: 'Throughput', seats: 'Throughput', kitchen: 'Kitchen', channels: 'Channels', delivery: 'Channels', overtime: 'Labour' };
export const leverOf = (raw) => BY_LEVER[raw] ? raw : LEVER_ALIAS[String(raw || '').toLowerCase().replace(/\s+/g, '_')] || null;

/**
 * Below these counts a rate is not shown, only the counts behind it: with a
 * handful of outcomes the interval is wider than any difference worth acting
 * on (the spec's precision discipline).
 */
export const MIN_RATE_N = 5;
/** An estimate is "on target" when what was measured lands within this share of it. */
export const AIM_BAND = 0.25;
/** A guardrail breach drops a consultant back to Recommends in that room for this long. */
export const BREACH_DAYS = 90;
/** Weeks a verified change has to hold before its consultant can be trusted to hold the line. */
export const HOLD_WEEKS = 13;
/** Closed results needed before anyone may say the learning beats plain rules (spec System 16). */
export const LIFT_RESULTS = 30;
/** The benchmark network's floor (spec System 17). */
export const NETWORK = { locations: 20, groups: 5 };

export const LEVELS = [
  { n: 0, name: 'Observes', may: 'Reads your data and tells you what it sees.' },
  { n: 1, name: 'Recommends', may: 'Suggests a change. You decide everything.' },
  { n: 2, name: 'Drafts', may: 'Writes the change out for you: the schedule edit, the email, the price. You approve and send.' },
  { n: 3, name: 'Acts inside your limits', may: 'Makes reversible changes inside the limits you set, and tells you. Anything outside them still waits for you.' },
  { n: 4, name: 'Holds the line', may: 'Keeps a proven change in place and puts it back if it slips. Money, staff and suppliers always wait for you.' },
];

/** How a case ended, in the spec's words, and what it counts as. */
const ENDING = {
  verified: { label: 'Held up', result: true, held: true },
  limited: { label: 'Held up, with a caveat', result: true, held: true },
  directional: { label: 'Pointed the right way, not proven', result: true },
  reversed: { label: 'Broke a guardrail', result: true, breach: true },
  inconclusive: { label: 'Test too small to tell', result: true, noRead: true },
  testing: { label: 'Being tested', open: true },
  data: { label: 'Waiting on data', open: true, blocked: true },
};
export const endingOf = (outcome) => ENDING[outcome] || { label: 'Open', open: true };

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** "Aug 24" in the year of `today` (or the year before, when that would be in the future). */
function dayOf(label, today) {
  const m = String(label || '').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/);
  if (!m) return null;
  const t = Date.parse(`${today}T00:00:00Z`);
  const y = new Date(t).getUTCFullYear();
  let at = Date.UTC(y, MON[m[1]], Number(m[2]));
  if (at > t + 864e5) at = Date.UTC(y - 1, MON[m[1]], Number(m[2]));
  return new Date(at).toISOString().slice(0, 10);
}
/** The day the casebook is read on: given, else today for a real group (it has test windows), else the sample's own today. */
const todayFor = (windows, today) => today || (Array.isArray(windows) ? new Date().toISOString().slice(0, 10) : NOW.iso);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const $ = (n) => money(Math.round(n));
const firstSentence = (s) => (String(s || '').match(/^.*?[.!?](\s|$)/)?.[0] || String(s || '')).trim();

/* ------------------------------------------------------------------ cases */

/**
 * Every call the group's consultants made that reached a test, as outcome
 * records. A sample group reads its proof history; a real group reads its own
 * test windows (stopped tests were never a call that ran, so they are left out).
 * @param {any} d a derived room (its `allProof` is the whole group's)
 *   `windows`: a real group's test windows (an empty array means none yet); leave it out for the sample.
 * @param {{ windows?: any[], rooms?: Record<string, string>, today?: string }} [ctx]
 */
export function casesFrom(d, { windows, rooms = {}, today } = {}) {
  const t = todayFor(windows, today);
  const room = (id) => rooms[id] || id;
  const fromProof = (d.allProof || d.proofs || []).map((p) => ({
    id: p.id, room: p.loc, roomName: room(p.loc), lever: leverOf(p.lever), title: p.title,
    outcome: p.outcome, est: Number.isFinite(p.est) ? p.est : null,
    point: Number.isFinite(p.point) && endingOf(p.outcome).result ? p.point : null,
    lo: Number.isFinite(p.lo) ? p.lo : null, hi: Number.isFinite(p.hi) ? p.hi : null,
    bookable: p.bookable || 0, paused: !!p.paused, removed: p.removed || 0,
    since: dayOf(p.since, t), ended: /Reversed|Closed/.test(p.held || '') ? dayOf(p.held, t) : null,
    heldWeeks: Number(String(p.held || '').match(/(\d+)\s+weeks?/)?.[1]) || 0,
    method: p.method || '', reason: p.reason || p.limitation || '', owner: p.owner || '',
    checkpoint: p.checkpoint || '', progress: Number.isFinite(p.progress) ? p.progress : null, closes: p.closes || '',
  }));
  const STATUS = { running: 'testing', waiting: 'data', verified: 'verified', rejected: 'inconclusive', reversed: 'reversed' };
  const fromWindows = (windows || []).filter((w) => w && w.status !== 'stopped' && STATUS[w.status]).map((w) => ({
    id: String(w.id), room: w.roomId, roomName: room(w.roomId), lever: leverOf(w.lever), title: w.title,
    outcome: STATUS[w.status], est: Number.isFinite(w.estCents) ? w.estCents / 100 : null,
    point: w.pointCents != null && w.status !== 'running' && w.status !== 'waiting' ? w.pointCents / 100 : null,
    lo: w.lowCents != null ? w.lowCents / 100 : null, hi: w.pointCents != null ? w.pointCents / 100 : null,
    bookable: w.status === 'verified' ? (w.bookedCents || 0) / 100 : 0, paused: false, removed: 0,
    since: String(w.startedAt || w.createdAt || '').slice(0, 10) || null,
    ended: String(w.reversedAt || w.closedAt || '').slice(0, 10) || null,
    heldWeeks: w.status === 'verified' && w.closedAt ? Math.max(0, Math.floor(daysBetween(String(w.closedAt).slice(0, 10), t) / 7)) : 0,
    method: w.method || '', reason: '', owner: '',
    checkpoint: w.status === 'running' ? `${w.checkpoints?.length ?? 0} of 4 checkpoints` : '', progress: w.status === 'running' && Number.isFinite(w.day) ? Math.round((w.day / 28) * 100) : null, closes: '',
  }));
  // A real group's record is its own test windows, even when it has none yet; the sample reads its proof history.
  const all = Array.isArray(windows) ? fromWindows : fromProof;
  return all.filter((c) => c.lever).map((c) => ({ ...c, ending: endingOf(c.outcome).label, lesson: lessonOf(c) }));
}

/** What one ending taught the consultant, in one sentence. */
export function lessonOf(c) {
  const where = c.roomName;
  switch (c.outcome) {
    case 'verified': case 'limited':
      return `Held up at ${where}${c.heldWeeks ? ` for ${plural(c.heldWeeks, 'week')}` : ''}. I lead with changes like this here and at your other rooms.`;
    case 'reversed':
      return `Broke a guardrail at ${where}. ${firstSentence(c.reason)} I now suggest changes like this only as a test, with that guardrail watched.`.replace(/\s+/g, ' ');
    case 'directional':
      return `Moved the right way at ${where} but did not clear the bar. It makes me more confident in changes like it; it counts for nothing in dollars.`;
    case 'inconclusive':
      return `The test at ${where} was too small to tell. Next time I size the test before suggesting it.`;
    case 'data':
      return `Could not be measured at ${where}: ${firstSentence(c.reason).replace(/\.$/, '')}. I check that data before suggesting this again.`;
    default:
      return `Being tested at ${where}. Nothing counts until the test closes.`;
  }
}

/* ------------------------------------------------------------------ the record */

/**
 * A consultant's record from its cases. Rates are null below MIN_RATE_N: the
 * counts are always there, so a screen can say "2 of 3" instead of "67%".
 */
export function recordOf(cases) {
  const results = cases.filter((c) => endingOf(c.outcome).result);
  const held = results.filter((c) => endingOf(c.outcome).held);
  const reads = results.filter((c) => !endingOf(c.outcome).noRead);
  // Aim is scored only on clear reads: a test too small to tell measured nothing worth comparing.
  const aimed = reads.filter((c) => c.est > 0 && Number.isFinite(c.point));
  const estSum = aimed.reduce((s, c) => s + c.est, 0);
  const ptSum = aimed.reduce((s, c) => s + c.point, 0);
  const onTarget = aimed.filter((c) => Math.abs(c.point - c.est) <= AIM_BAND * c.est).length;
  const rate = (k, n) => (n >= MIN_RATE_N ? k / n : null);
  return {
    calls: cases.length,
    open: cases.filter((c) => endingOf(c.outcome).open).length,
    blocked: cases.filter((c) => c.outcome === 'data').length,
    results: results.length,
    reads: reads.length,
    held: held.length,
    reversed: results.filter((c) => c.outcome === 'reversed').length,
    noRead: results.length - reads.length,
    // P(M|E): of the tests that closed, how many gave a clear read. P(P|M): of the clear reads, how many held up.
    readRate: rate(reads.length, results.length),
    heldRate: rate(held.length, reads.length),
    aim: aimed.length ? { n: aimed.length, ratio: estSum > 0 ? ptSum / estSum : null, onTarget } : { n: 0, ratio: null, onTarget: 0 },
    week: held.filter((c) => !c.paused).reduce((s, c) => s + c.bookable, 0),
  };
}

/** "I estimate high: what was measured came to 86% of what I said." Null until there is anything to compare. */
export function aimSentence(aim) {
  if (!aim?.n || !Number.isFinite(aim.ratio)) return null;
  const p = Math.round(aim.ratio * 100);
  const lean = Math.abs(aim.ratio - 1) <= 0.05 ? 'My estimates have been close' : aim.ratio < 1 ? 'I estimate high' : 'I estimate low';
  return `${lean}: across ${plural(aim.n, 'measured change')}, what was measured came to ${p}% of what I estimated.`;
}

/**
 * A new estimate read against the consultant's own history. Only once there
 * are MIN_RATE_N measured changes to go on, and labelled as an estimate: this
 * is the consultant correcting its own aim, never a measured figure.
 */
export function adjustEstimate(value, aim) {
  if (!(value > 0) || !aim || aim.n < MIN_RATE_N || !Number.isFinite(aim.ratio)) return null;
  return { value: value * aim.ratio, ratio: aim.ratio, n: aim.n, claim: 'est' };
}

/* ------------------------------------------------------------------ authority */

/**
 * The level a consultant has earned in one room, from evidence only, and what
 * the next level needs. A person still chooses the level it works at (up to
 * this), and no agent raises its own level (lib/agents/policy.js NEVER).
 * @returns {{ level: number, shown: string[], next: { level: number, needs: string[] } | null, capped: { why: string, until: string } | null }}
 */
export function earnedLevel(cases, roomId, today) {
  const t = today || NOW.iso;
  const here = cases.filter((c) => c.room === roomId);
  const rec = recordOf(cases);
  const heldHere = here.filter((c) => endingOf(c.outcome).held);
  const breach = here.filter((c) => c.outcome === 'reversed' && c.ended && daysBetween(c.ended, t) < BREACH_DAYS)
    .sort((a, b) => (a.ended < b.ended ? 1 : -1))[0] || null;
  const aimOk = rec.aim.n >= 2 && Number.isFinite(rec.aim.ratio) && Math.abs(rec.aim.ratio - 1) <= AIM_BAND;
  const longHold = heldHere.some((c) => c.heldWeeks >= HOLD_WEEKS && !c.paused);

  // Each rung: what it needs, and whether this consultant has shown it.
  const rungs = [
    { level: 1, needs: [['A test in your group that gave a clear read', rec.reads >= 1]] },
    { level: 2, needs: [['A change that held up in your group', rec.held >= 1]] },
    { level: 3, needs: [['Two changes that held up in your group', rec.held >= 2], ['A change that held up in this room', heldHere.length >= 1], [`Estimates within ${Math.round(AIM_BAND * 100)}% of what was measured`, aimOk]] },
    { level: 4, needs: [[`A change that held ${HOLD_WEEKS} weeks in this room`, longHold], ['Three changes that held up in your group', rec.held >= 3], ['No guardrail broken anywhere in your group', rec.reversed === 0]] },
  ];
  let level = 0;
  for (const r of rungs) { if (r.needs.every(([, ok]) => ok)) level = r.level; else break; }
  const shown = rungs.filter((r) => r.level <= level).flatMap((r) => r.needs.map(([s]) => s));
  let capped = null;
  if (breach && level > 1) {
    const until = new Date(Date.parse(`${breach.ended}T00:00:00Z`) + BREACH_DAYS * 864e5).toISOString().slice(0, 10);
    capped = { why: `“${breach.title}” broke a guardrail here on ${fmtDay(breach.ended)}`, until };
    level = 1;
  }
  const nextRung = rungs.find((r) => r.level === level + 1);
  const needs = nextRung ? nextRung.needs.filter(([, ok]) => !ok).map(([s]) => s) : [];
  if (capped && nextRung) needs.unshift(`No guardrail broken here until ${fmtDay(capped.until)}`);
  return { level, shown, next: nextRung ? { level: nextRung.level, needs } : null, capped };
}
const fmtDay = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/* ------------------------------------------------------------------ the call log */

/** The most calls a room keeps in its log (newest first). */
export const CALLS_MAX = 100;

/**
 * Add the moves on offer now to the room's call log: every call a consultant
 * made, once, with what it estimated at the time. Moves already logged keep
 * their first date and estimate (a call is what was said then, not now).
 * Returns the same array when nothing is new, so callers can skip a save.
 * @param {any[]} log the saved 'sous.calls'
 * @param {any[]} moves from sousMoves()
 */
export function recordCalls(log, moves, now = Date.now()) {
  const prev = Array.isArray(log) ? log : [];
  const have = new Set(prev.map((c) => c.id));
  const at = new Date(now).toISOString();
  const fresh = (moves || []).filter((m) => m?.id && m.topic && !have.has(m.id) && CONSULTANTS.some((c) => c.topic === m.topic)).map((m) => ({
    id: String(m.id).slice(0, 120), topic: m.topic, title: String(m.title || '').slice(0, 200),
    ...(m.value ? { value: String(m.value).slice(0, 40) } : {}), ...(m.claim ? { claim: String(m.claim).slice(0, 10) } : {}), at,
  }));
  return fresh.length ? [...fresh, ...prev].slice(0, CALLS_MAX) : prev;
}

/**
 * Where each logged call stands: acted on (the person took it), set aside, or
 * still on offer. A call that is no longer offered and was never acted on has
 * "passed": the problem went away or the room moved on; it is not counted
 * either way.
 */
export function callStates(log, { acts = [], mem = {}, offered = [] } = {}) {
  const took = new Set((Array.isArray(acts) ? acts : []).map((a) => a?.id));
  const on = new Set((offered || []).map((m) => m.id));
  return (Array.isArray(log) ? log : []).map((c) => {
    const noticed = String(c.id).replace(/^do:/, '');
    const state = took.has(c.id) ? 'taken' : mem?.[noticed]?.how === 'dismissed' ? 'aside' : on.has(c.id) ? 'open' : 'passed';
    return { ...c, state };
  });
}

/* ------------------------------------------------------------------ the casebook */

/**
 * Everything the consultants have learned, for one room in view.
 * @param {any} d a derived room
 * @param {{ windows?: any[], rooms?: Record<string, string>, today?: string, calls?: any[], acts?: any[], mem?: Record<string, any>, offered?: any[], levels?: Record<string, number>, network?: { locations: number, groups: number } }} [ctx]
 *   `levels` the room's saved `autonomy` (what a person granted)
 */
export function casebook(d, ctx = {}) {
  const today = todayFor(ctx.windows, ctx.today);
  const cases = casesFrom(d, ctx);
  const logged = callStates(ctx.calls, ctx);
  const seeded = d.room?.autonomy || {};
  const consultants = CONSULTANTS.map((c) => {
    const mine = cases.filter((x) => x.lever === c.lever);
    const calls = logged.filter((x) => x.topic === c.topic);
    const earned = earnedLevel(mine, d.id, today);
    const granted = Number.isInteger(ctx.levels?.[c.lever]) ? ctx.levels[c.lever] : Array.isArray(seeded[c.lever]) ? seeded[c.lever][0] : 0;
    const rec = recordOf(mine);
    const here = mine.filter((x) => x.room === d.id);
    return {
      ...c,
      cases: mine, here, elsewhere: mine.filter((x) => x.room !== d.id && endingOf(x.outcome).result),
      record: rec, hereRecord: recordOf(here), aim: aimSentence(rec.aim),
      calls: { taken: calls.filter((x) => x.state === 'taken').length, aside: calls.filter((x) => x.state === 'aside').length, open: calls.filter((x) => x.state === 'open').length, passed: calls.filter((x) => x.state === 'passed').length, list: calls },
      earned, granted, working: Math.max(0, Math.min(Math.trunc(granted) || 0, earned.level)),
      over: granted > earned.level,
    };
  });
  const all = recordOf(cases);
  const network = ctx.network || { locations: 0, groups: 0 };
  return {
    version: CASEBOOK_VERSION, today, consultants, record: all, cases,
    // The learning has to beat plain rules on results that come in after it was switched on, not on its own history.
    lift: { results: logged.filter((x) => x.state === 'taken').length, need: LIFT_RESULTS },
    network: { ...network, need: NETWORK, on: network.locations >= NETWORK.locations && network.groups >= NETWORK.groups },
  };
}

/** One sentence on the consultant, for a person who will not read more. */
export function consultantSay(k) {
  const r = k.record;
  if (!r.results) return r.open ? `${plural(r.open, 'call')} being tested. No results yet.` : 'No calls tested yet.';
  if (!r.reads) return `${plural(r.results, 'test')} closed, all too small to tell. No clear result yet.`;
  const held = `${r.held} of ${plural(r.reads, 'clear result')} held up`;
  const rev = r.reversed ? `, ${r.reversed} broke a guardrail` : '';
  return `${held}${rev}.${r.week > 0 ? ` ${$(r.week)} a week verified across your rooms.` : ''}`;
}

/**
 * The casebook as records Sous answers from: one per consultant with results,
 * plus the room's total. Each says only counts and figures already in the casebook.
 */
export function casebookFacts(book, roomName = 'this room') {
  const out = [];
  const r = book.record;
  if (!r.calls) return out;
  out.push({
    id: 'track', topic: 'track', label: 'Consultants', go: 'consultants',
    text: `Coversight's consultants have ${plural(r.calls, 'call')} on record across your rooms that went to a test. ${r.reads} gave a clear result: ${r.held} held up, ${r.reversed} broke a guardrail and ${r.reads - r.held - r.reversed} pointed the right way without clearing the bar. ${r.noRead} were too small to tell and ${r.open} are still open. They learn from every one; nothing counts as saved until it is verified.`,
    say: `${r.held} of ${plural(r.reads, 'clear result')} held up. ${r.reversed ? `${r.reversed} broke a guardrail, and the consultants learned from it.` : 'None broke a guardrail.'}`,
    todo: 'See what each consultant learned on Consultants.',
  });
  for (const k of book.consultants.filter((x) => x.record.results)) {
    const level = LEVELS[k.working];
    const need = k.earned.next?.needs?.[0];
    const todo = need ? `To earn ${LEVELS[k.earned.next.level].name}: ${need.charAt(0).toLowerCase()}${need.slice(1)}.` : '';
    out.push({
      // By area, not by name: the shared records never name a page agent, so the one answering stays itself.
      id: `track:${k.page}`, topic: 'track', also: [k.topic], label: `${k.area.charAt(0).toUpperCase()}${k.area.slice(1)} consultant`, go: 'consultants',
      text: `The ${k.area} consultant: ${consultantSay(k)} ${k.aim || ''} At ${roomName} it works at ${level.name} and has earned ${LEVELS[k.earned.level].name}.${k.earned.capped ? ` It dropped back because ${k.earned.capped.why}.` : ''} ${todo}`.replace(/\s+/g, ' ').trim(),
      say: consultantSay(k),
      todo,
      ...(k.record.week > 0 ? { claim: 'book' } : {}),
    });
  }
  return out;
}
