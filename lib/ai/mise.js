/**
 * Mise: the restaurant's brain. Mise en place is how a kitchen gets
 * everything it needs in its place before service; Mise does that for the
 * whole restaurant. It brings together three things Coversight already
 * computes, so every page, consultant and answer reads one understanding:
 *
 *  1. what it knows, level by level (lib/ai/understanding.js): the industry,
 *     the group, this location, the managers and the team, with what it does
 *     not know yet and what would teach it most
 *  2. what it has learned from every call (lib/ai/casebook.js): each
 *     consultant's record, aim, lessons and the authority it has earned
 *  3. the decision loop, before, during and after every change:
 *       before  the calls on offer now: what to do, how, why, what it should
 *               be worth (read against the consultant's own record), what
 *               went wrong last time something like it was tried, and how
 *               much the consultant may do about it
 *       during  the tests running: how far along, and whether the result so
 *               far points the way the consultant expected
 *       after   the tests that closed: how each ended against the estimate,
 *               and what the consultant learned
 *
 * Pure. Every figure comes from the derived room, the casebook and the
 * room's saved decisions. Mise never acts: a call ends at a draft, an
 * approval or a screen, at the level a person granted.
 */
import { agentFor } from './agents.js';
import { LEVELS, aimSentence, adjustEstimate, endingOf } from './casebook.js';
import { lineCheck } from './playbook.js';
import { understand } from './understanding.js';

export const MISE = { name: 'Mise', what: 'Your restaurant’s brain', line: 'Everything it knows about your restaurant, everything it has learned, and every decision before, during and after.' };

/** Where a move opens, in words. */
const PAGE_WORD = { today: 'Today', service: 'Service', sources: 'Connections', inputs: 'Data', labour: 'Labor', menu: 'Menu prices', purchasing: 'Supplier prices', inventory: 'Food & drink used', controls: 'Giveaways', throughput: 'Tables', kitchen: 'Kitchen speed', channels: 'Delivery', plan: 'The plan', finding: 'The plan' };
const money0 = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sentences = (s) => String(s || '').split(/(?<=[.!?])\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean);

/** How a person carries out a call, in up to three steps. From the consultant's own fix when it has one. */
export function howTo(move, d) {
  const kind = move?.act?.kind;
  if (kind === 'email') return ['Open the email I drafted.', 'Check the numbers against your last invoice.', 'Send it from your own email. I never send it for you.'];
  if (kind === 'approve') return ['Read the change and what it should be worth.', 'Approve it. It becomes a task for the manager who makes it.', 'I check the data shows it was made, then a test measures it.'];
  // The consultant's own fix: the check this move came from, else the biggest thing its page's line check found.
  const checks = lineCheck(move?.go, d, {})?.checks || [];
  const c = checks.find((x) => x.id === move?.checkId) || checks.find((x) => x.status === 'found' && x.how);
  const steps = sentences(c?.how).slice(0, 3);
  if (steps.length) return steps;
  const page = PAGE_WORD[move?.go] || 'the page it is about';
  return [`Open ${page} and look at the detail first.`, 'Decide what to do. It is your call.'];
}

/** What the consultant does with this call at the level it works at, and what is still yours. */
export function levelFor(k, move) {
  const n = k ? k.working : 1;
  const draftable = move?.act?.kind === 'email' || move?.act?.kind === 'approve';
  const does = n >= 3 ? 'Could make this change inside your limits. Nothing writes to Toast or 7shifts yet, so it comes to you as a task.'
    : n >= 2 ? (draftable ? 'Has drafted it for you. You approve and send.' : 'Writes it out for you to approve.')
      : n >= 1 ? 'Recommends it. You decide everything.'
        : 'Watching only. It tells you what it sees.';
  return { n, name: LEVELS[n].name, does };
}

/**
 * The brief for one call: what, why, how, what it should be worth and the
 * risk the casebook knows about.
 * @param {any} move from sousMoves()
 * @param {any} d a derived room
 * @param {any} [k] the consultant for the move's area, from casebook()
 */
export function callBrief(move, d, k) {
  const worth = Number(String(move.value || '').replace(/[^0-9.]/g, ''));
  const adj = k ? adjustEstimate(worth, k.record.aim) : null;
  const burned = (k?.cases || []).filter((c) => c.outcome === 'reversed');
  return {
    id: move.id, topic: move.topic, go: move.go, act: move.act,
    who: k?.name || agentFor(move.go)?.name || 'Sous',
    what: move.title,
    why: sentences(move.why).slice(0, 2).join(' '),
    how: howTo(move, d),
    worth: move.value ? { value: move.value, unit: move.unit, claim: move.claim || 'est' } : null,
    // The consultant's own record on estimates like this one. A corrected figure only with enough history; otherwise the record in words.
    aim: adj ? { text: `My estimates in ${k.area} have come in at ${Math.round(adj.ratio * 100)}% of what I said, so expect nearer ${money0(adj.value)}.`, claim: 'est' } : k?.aim ? { text: k.aim } : null,
    risks: burned.slice(0, 2).map((c) => `Last time: “${c.title}” at ${c.roomName}. ${sentences(c.reason)[0] || 'It broke a guardrail.'}`),
    // Only a lever change is measured by a test; fixing a feed or checking a schedule is not a saving.
    measure: k ? 'Once it is made, a test compares it with matched services that did not change. Nothing counts as saved until that test verifies it.' : '',
    level: levelFor(k, move),
  };
}

/** Whether a running test is pointing the way its consultant expected, from its interval so far. */
export function duringRead(c) {
  if (c.outcome === 'data') return { tone: 'warn', text: `Stopped: ${sentences(c.reason)[0] || 'the data it needs is missing.'}` };
  if (!(Number.isFinite(c.lo) && Number.isFinite(c.hi))) return { tone: 'info', text: 'Too early to read. The first checkpoint has not come in.' };
  if (c.lo > 0) return { tone: 'good', text: `Pointing the right way: so far between ${money0(c.lo)} and ${money0(c.hi)} a week, all above zero.` };
  if (c.hi < 0) return { tone: 'bad', text: 'Pointing the wrong way so far. If it stays there, it will not count.' };
  return { tone: 'info', text: `Not clear yet: so far between ${c.lo < 0 ? `−${money0(-c.lo)}` : money0(c.lo)} and ${money0(c.hi)} a week. It needs more weeks to settle.` };
}

/** How a closed test came out against what its consultant estimated. */
export function afterRead(c) {
  const e = endingOf(c.outcome);
  const vs = c.est > 0 && Number.isFinite(c.point) && !e.noRead ? ` Estimated ${money0(c.est)} a week; measured ${money0(c.point)} (${Math.round((c.point / c.est) * 100)}% of the estimate).` : '';
  return { tone: e.held ? 'good' : c.outcome === 'reversed' ? 'bad' : 'info', text: `${e.label}.${vs}`, lesson: c.lesson };
}

/**
 * The decision loop for the room in view: before (calls on offer now),
 * during (tests running or stuck) and after (tests that closed, newest
 * first), each from one consultant.
 * @param {any} d a derived room
 * @param {any} book casebook()
 * @param {any[]} moves the moves on offer (roomMoves())
 */
export function decisionLoop(d, book, moves = []) {
  const byTopic = Object.fromEntries(book.consultants.map((k) => [k.topic, k]));
  const byLever = Object.fromEntries(book.consultants.map((k) => [k.lever, k]));
  const seen = new Set();
  const before = moves.filter((m) => { if (seen.has(m.topic)) return false; seen.add(m.topic); return true; }).slice(0, 6).map((m) => callBrief(m, d, byTopic[m.topic]));
  const here = book.cases.filter((c) => c.room === d.id);
  const during = here.filter((c) => endingOf(c.outcome).open).map((c) => ({ ...c, who: byLever[c.lever]?.name, read: duringRead(c) }));
  const after = here.filter((c) => endingOf(c.outcome).result).sort((a, b) => String(b.ended || b.since).localeCompare(String(a.ended || a.since)))
    .map((c) => ({ ...c, who: byLever[c.lever]?.name, read: afterRead(c) }));
  return { before, during, after };
}

/**
 * Everything Mise holds for the room in view.
 * @param {any} d a derived room
 * @param {{ book: any, moves?: any[], group?: any, tasks?: any[], notes?: any[], mem?: Record<string, any> }} ctx
 */
export function mise(d, ctx) {
  const u = understand(d, { group: ctx.group, book: ctx.book, tasks: ctx.tasks, notes: ctx.notes, mem: ctx.mem });
  const loop = decisionLoop(d, ctx.book, ctx.moves || []);
  const learning = ctx.book.consultants.filter((k) => k.record.results).map((k) => ({ page: k.page, name: k.name, area: k.area, aim: aimSentence(k.record.aim), lesson: k.cases.find((c) => endingOf(c.outcome).result)?.lesson || null }));
  return { ...MISE, room: u.room, understanding: u, loop, learning, record: ctx.book.record };
}

/**
 * Mise on every move the platform offers, wherever it is shown (the page's
 * agent strip, the Pass): the same brief the decision loop gives, so the why,
 * the how, the record and "last time" travel with the move.
 * @param {any} d a derived room
 * @param {any[]} moves
 * @param {any} book casebook()
 */
export function withMise(d, moves, book) {
  const byTopic = Object.fromEntries(book.consultants.map((k) => [k.topic, k]));
  return moves.map((m) => (m.mise ? m : { ...m, mise: callBrief(m, d, byTopic[m.topic]) }));
}

/** Mise's read of each of this room's tests, by test id: how a running one is pointing, how a closed one ended and what it taught. */
export function testReads(d, book) {
  /** @type {Record<string, { tone: string, text: string, lesson?: string }>} */
  const out = {};
  for (const c of book.cases.filter((x) => x.room === d.id)) {
    const e = endingOf(c.outcome);
    if (e.open) out[c.id] = duringRead(c);
    else if (e.result) out[c.id] = afterRead(c);
  }
  return out;
}

/**
 * One line for a move shown in a tight space: what went wrong last time
 * first, else the consultant's record on estimates like it.
 */
export function miseLine(b) {
  if (!b) return null;
  if (b.risks?.length) return { tone: 'warn', text: b.risks[0] };
  if (b.aim?.text) return { tone: 'info', text: b.aim.text };
  return null;
}
