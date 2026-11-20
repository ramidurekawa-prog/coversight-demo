/**
 * How Sous learns a restaurant and the person it is talking to. The model
 * itself is never retrained: learning here is memory that Sous reads every
 * time it answers.
 *
 *  - the notebook: what people told it ("we close Mondays"), kept per room,
 *    visible and editable, and read as records like everything else
 *  - what works here: which kinds of change this room has proven, reversed,
 *    acted on or keeps skipping, used to order what Sous suggests
 *  - the person: what they ask about, used to offer their questions first
 *
 * Pure. Nothing here invents a figure: a note is the person's own words, and
 * every count comes from the room's proofs and saved decisions.
 */
import { money } from '../data/model.js';

export const NOTES = { max: 50, chars: 240 };
/** How many times a kind of advice has to be turned down, with nothing proven, before it goes to the back. */
export const SKIP_LIMIT = 2;

const $ = (n) => money(Math.round(n));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const AREA = { labor: 'labor', menu: 'the menu', purchasing: 'purchasing', stock: 'inventory', comps: 'the register', seats: 'tables', kitchen: 'the kitchen', delivery: 'delivery', today: 'today’s decisions', data: 'data', plan: 'the plan' };
const LEVER_TOPIC = { Labour: 'labor', Menu: 'menu', Purchasing: 'purchasing', Inventory: 'stock', Controls: 'comps', Throughput: 'seats', Kitchen: 'kitchen', Channels: 'delivery' };
const STOP = new Set(['about', 'after', 'again', 'always', 'before', 'being', 'could', 'does', 'dont', 'from', 'have', 'into', 'just', 'like', 'make', 'more', 'most', 'much', 'must', 'need', 'never', 'only', 'other', 'over', 'please', 'should', 'some', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'until', 'very', 'want', 'week', 'weeks', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'email', 'send']);
export const noteWords = (s) => words(s);
const words = (s) => [...new Set((String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w)))];

/* ------------------------------------------------------------------ the notebook */

/** "Remember that we close Mondays" → "We close Mondays". Null when the message is a question, not something to keep. */
export function asNote(message) {
  const m = String(message || '').trim().match(/^(?:please\s+)?(?:remember|note|keep in mind|don['’]?t forget|fyi|for the record)[\s,:-]+(?:that\s+)?(.{3,})$/i);
  if (!m) return null;
  const text = m[1].trim().replace(/\s+/g, ' ').slice(0, NOTES.chars);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Add a note to the notebook, newest first, never the same thing twice, capped. */
export function addNote(notes, text, { by = '', now = Date.now() } = {}) {
  const t = String(text || '').trim().replace(/\s+/g, ' ').slice(0, NOTES.chars);
  const list = Array.isArray(notes) ? notes : [];
  if (t.length < 3 || list.some((n) => n.text.toLowerCase() === t.toLowerCase())) return list;
  return [{ id: `n${now.toString(36)}`, text: t, at: new Date(now).toISOString(), ...(by ? { by } : {}) }, ...list].slice(0, NOTES.max);
}

/** The notebook as records: Sous answers from them and the AI reads them with everything else. */
export function noteFacts(notes) {
  return (Array.isArray(notes) ? notes : []).filter((n) => n?.text).map((n) => ({
    id: `note:${n.id}`, topic: 'notes', label: 'You told me', go: '', text: `You told me: ${n.text}`, say: `You told me: ${n.text.replace(/[.!?]$/, '')}.`,
  }));
}

/** The notes that bear on a move or a question: ones that share a real word with it (a name, a supplier, a dish, a day). */
export function notesFor(text, notes, max = 2) {
  const mine = new Set(words(text));
  return (Array.isArray(notes) ? notes : []).filter((n) => n?.text && words(n.text).some((w) => mine.has(w))).slice(0, max);
}

/**
 * A note that says not to email someone wins over a move that would draft that email: the move stays,
 * but it opens the page instead, and the card shows the note that changed it.
 */
export function respectNotes(moves, notes) {
  return moves.map((m) => {
    if (m.act?.kind !== 'email') return m;
    const no = notesFor(`${m.title} ${m.act.to || ''}`, notes, 5).find((n) => /\b(never|don['’]?t|do not|no)\b[^.]*\bemail/i.test(n.text));
    return no ? { ...m, act: { kind: 'go', page: m.go }, held: no.id } : m;
  });
}

/* ------------------------------------------------------------------ what works here */

/**
 * What this room has taught Sous about each kind of advice: changes that were
 * proven in a test, ones that were reversed, ones being tested, times the
 * person acted on a suggestion, and times they turned one down.
 * @param {any} d a derived room
 * @param {{ mem?: Record<string, any>, acts?: { topic: string, at: string }[] }} [ctx] `mem` the saved 'sous' decisions; `acts` the saved 'sous.learn' log
 * @returns {Record<string, { worked: number, week: number, reversed: number, testing: number, taken: number, skipped: number }>}
 */
export function sousLearned(d, { mem = {}, acts = [] } = {}) {
  const out = {};
  const at = (topic) => (out[topic] ??= { worked: 0, week: 0, reversed: 0, testing: 0, taken: 0, skipped: 0 });
  for (const p of d.banked?.live || []) { const r = at(LEVER_TOPIC[p.lever] || 'plan'); r.worked += 1; r.week += p.bookable || 0; }
  for (const p of d.banked?.reversed || []) at(LEVER_TOPIC[p.lever] || 'plan').reversed += 1;
  for (const p of (d.proofs || []).filter((x) => x.outcome === 'testing')) at(LEVER_TOPIC[p.lever] || 'plan').testing += 1;
  for (const a of Array.isArray(acts) ? acts : []) if (a?.topic) at(a.topic).taken += 1;
  for (const [id, r] of Object.entries(mem && typeof mem === 'object' ? mem : {})) {
    if (r?.how !== 'dismissed') continue;
    at(id === 'vendor:price' ? 'purchasing' : id === 'stock:usage' ? 'stock' : id.startsWith('register:') ? 'comps' : id === 'data:stale' ? 'data' : 'noticed').skipped += 1;
  }
  return out;
}

/**
 * Order moves by what this room has shown: nothing urgent moves, but among
 * suggestions a kind that has been proven here comes first and a kind the room
 * keeps turning down (with nothing proven) goes last. Each move is tagged so
 * the person can see why.
 */
export function rankMoves(moves, learned = {}) {
  const tag = (m) => {
    const l = learned[m.topic];
    if (!l) return m;
    if (l.worked > 0) return { ...m, learned: { kind: 'worked', text: `${plural(l.worked, 'change')} like this ${l.worked === 1 ? 'is' : 'are'} proven here, worth ${$(l.week)} a week.` } };
    if (l.reversed > 0) return { ...m, learned: { kind: 'reversed', text: 'A change like this was reversed here once. Test it before you count on it.' } };
    if (l.skipped >= SKIP_LIMIT) return { ...m, learned: { kind: 'skipped', text: 'You have set this kind of thing aside before, so I moved it down.' } };
    return m;
  };
  const score = (m) => (m.source === 'noticed' || m.source === 'today' ? 0 : m.learned?.kind === 'worked' ? -1 : m.learned?.kind === 'skipped' ? 1 : 0);
  return moves.map(tag).map((m, i) => ({ m, i })).sort((a, b) => score(a.m) - score(b.m) || a.i - b.i).map((x) => x.m);
}

/** What works here, as a record Sous can answer from. Null until the room has taught it something. */
export function learnedFact(d, learned) {
  const name = d.profile?.short || d.profile?.name || 'this room';
  const rows = Object.entries(learned).filter(([t]) => AREA[t]);
  const worked = rows.filter(([, l]) => l.worked > 0);
  const reversed = rows.filter(([, l]) => l.reversed > 0);
  const skipped = rows.filter(([, l]) => l.skipped >= SKIP_LIMIT && !l.worked);
  if (!worked.length && !reversed.length && !skipped.length) return null;
  const parts = [
    worked.length && `Proven at ${name}: ${worked.map(([t, l]) => `${plural(l.worked, 'change')} in ${AREA[t]} (${$(l.week)} a week)`).join('; ')}.`,
    reversed.length && `Reversed after a test: ${reversed.map(([t, l]) => `${plural(l.reversed, 'change')} in ${AREA[t]}`).join('; ')}.`,
    skipped.length && `Set aside more than once: ${skipped.map(([t]) => AREA[t]).join('; ')}.`,
  ].filter(Boolean);
  const best = [...worked].sort((a, b) => b[1].week - a[1].week)[0];
  return {
    id: 'learned', topic: 'saved', label: 'What works here', go: 'proof', claim: worked.length ? 'book' : undefined,
    text: `What ${name} has taught me. ${parts.join(' ')} I put proven kinds of change first and the ones you set aside last.`,
    say: best ? `Changes in ${AREA[best[0]]} have worked best here. They are proven at ${$(best[1].week)} a week.` : reversed.length ? `Nothing is proven yet. One change in ${AREA[reversed[0][0]]} was reversed.` : 'Nothing is proven here yet.',
    todo: best ? 'I put that kind of move first.' : '',
  };
}

/* ------------------------------------------------------------------ the person */

/** Count a question against the area it was about. Capped so one habit never grows without end. */
export function learnAsk(me, topic) {
  const asked = { ...(me?.asked || {}) };
  if (topic) asked[topic] = Math.min(999, (asked[topic] || 0) + 1);
  return { ...(me || {}), asked };
}

/** The area this person asks about most, once there is enough to go on. */
export function favoriteTopic(me) {
  const top = Object.entries(me?.asked || {}).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 3 ? top[0] : null;
}

/**
 * The questions to offer, this person's usual areas first. `topicOf` says
 * which area a question is about (from the facts it would be answered with).
 */
export function rankQuestions(questions, me, topicOf) {
  const asked = me?.asked || {};
  return questions.map((q, i) => ({ q, i, n: asked[topicOf(q)] || 0 })).sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.q);
}
