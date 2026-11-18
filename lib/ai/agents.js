/**
 * Sous's page agents. Every page has its own named agent: a specialist with
 * its own job, its own focus within the restaurant's facts, its own read of
 * the page and its own questions. They are all Sous: each one works from the
 * same facts (lib/ai/sous.js), so an agent on one page can connect what it
 * sees to what another page knows. That shared set of facts is the brain.
 *
 * Pure. An agent never holds a number: its read is picked from the facts.
 */
import { moveFor } from './moves.js';
import { firstSentence, sousAnswer, sousHash, sousRelevant } from './sous.js';

/**
 * name: what the person sees. job: what it does for them, as an outcome.
 * topics: the fact topics it leads with, most important first.
 * ask: questions it is good at (only the ones the facts can answer are shown).
 * lead: the record it opens with when nothing unusual is on its page.
 */
const AGENTS = {
  today: { lead: 'today-first', name: 'Day Captain', job: 'Gets today’s decisions made in the right order.', topics: ['today', 'data', 'noticed'], ask: ['What needs me today?', 'What can wait until tomorrow?', 'Is my data up to date?'] },
  service: { lead: 'today-first', name: 'Shift Pulse', job: 'Keeps tonight’s floor staffed to the covers actually coming in.', topics: ['today', 'labor', 'kitchen', 'seats'], ask: ['Are we staffed right tonight?', 'What is slowing the kitchen down?', 'When is the room actually full?'] },
  week: { name: 'Week Coach', job: 'Explains how the week went and what to change next week.', topics: ['week', 'costs', 'plan', 'saved'], ask: ['How did last week go?', 'What should we do first?', 'Why is food cost where it is?'] },
  trends: { lead: 'rates', name: 'Trend Watch', job: 'Tells a real change from a normal wobble.', topics: ['noticed', 'week', 'costs'], ask: ['Is anything unusual in the numbers?', 'How did last week go?', 'Why is food cost where it is?'] },
  daily: { lead: 'week-change', name: 'Day Replay', job: 'Shows which days made or lost the week.', topics: ['week', 'costs', 'today'], ask: ['How did last week go?', 'What needs me today?'] },
  portfolio: { name: 'Room Scout', job: 'Compares your rooms and points at the one that needs you.', topics: ['group', 'week', 'saved'], ask: ['Which room needs me most?', 'How did last week go?', 'What have we actually saved?'] },
  meeting: { lead: 'top', name: 'Agenda Chief', job: 'Gets the weekly meeting to decisions, not discussion.', topics: ['plan', 'week', 'tests', 'today'], ask: ['What should we decide this week?', 'How did last week go?', 'What is being tested?'] },
  plan: { name: 'Playbook', job: 'Picks the moves worth a manager’s hour this week.', topics: ['plan', 'tests', 'saved'], ask: ['What should we do first?', 'What is being tested?', 'What have we actually saved?'] },
  menu: { name: 'Menu Maker', job: 'Finds the price and menu moves that earn more per plate.', topics: ['menu', 'plan', 'purchasing'], ask: ['Which dishes earn the most?', 'What price should we raise first?', 'Which supplier prices went up?'] },
  labour: { lead: 'labor-cost', name: 'Roster Coach', job: 'Matches the schedule to the covers you really get.', topics: ['labor', 'costs', 'today'], ask: ['Where are we overstaffed or short?', 'What is labor as a share of sales?', 'What needs me today?'] },
  throughput: { name: 'Seat Finder', job: 'Finds the hours when a full room is costing you covers.', topics: ['seats', 'kitchen'], ask: ['When is the room actually full?', 'What is slowing the kitchen down?'] },
  coverage: { lead: 'data-off', name: 'Coverage Guide', job: 'Shows which parts of the business are being watched, and which are blind.', topics: ['data', 'plan'], ask: ['What are we not measuring yet?', 'Is my data up to date?'] },
  purchasing: { name: 'Price Watch', job: 'Catches supplier price increases before they eat the margin.', topics: ['purchasing', 'stock', 'menu'], ask: ['Which supplier prices went up?', 'Where are we losing product?', 'Why is food cost where it is?'] },
  inventory: { name: 'Stock Sleuth', job: 'Finds product that is used but never sold.', topics: ['stock', 'purchasing'], ask: ['Where are we losing product?', 'Which supplier prices went up?'] },
  kitchen: { name: 'Line Coach', job: 'Finds the station that is holding tickets up.', topics: ['kitchen', 'seats'], ask: ['What is slowing the kitchen down?', 'When is the room actually full?'] },
  controls: { name: 'Register Guard', job: 'Watches comps, voids and discounts for patterns worth a conversation.', topics: ['comps'], ask: ['Are comps and voids normal?', 'Is anything unusual at the register?'] },
  channels: { name: 'Delivery Desk', job: 'Shows what each delivery order really leaves you.', topics: ['delivery'], ask: ['Is delivery worth it?', 'How much of our sales is delivery?'] },
  proof: { name: 'Proof Keeper', job: 'Separates savings that are verified from savings that are hoped for.', topics: ['saved', 'tests'], ask: ['What have we actually saved?', 'What is being tested?'] },
  ledger: { lead: 'saved', name: 'Books Keeper', job: 'Ties every verified saving to where it lands in the books.', topics: ['saved', 'tests', 'data'], ask: ['What have we actually saved?', 'What is being tested?', 'Is my data up to date?'] },
  sources: { name: 'Data Steward', job: 'Keeps the data fresh so every number can be trusted.', topics: ['data'], ask: ['Is my data up to date?', 'What are we not measuring yet?'] },
  system: { lead: 'windows', name: 'Crew Chief', job: 'Shows what the platform did overnight and what waits on a person.', topics: ['tests', 'data', 'plan'], ask: ['What is being tested?', 'Is my data up to date?', 'What should we do first?'] },
};
/**
 * Pages that share another page's agent. Each still says its own thing: its
 * own job on that page and the record it opens with, so the same agent on two
 * pages never repeats itself.
 */
const SAME = {
  finding: { as: 'plan', lead: 'top', job: 'Shows why this move is worth making and what it needs.' },
  levers: { as: 'plan', lead: 'plan', job: 'Shows every lever you can pull and which are in play.' },
  start: { as: 'plan', lead: 'top', job: 'Gets you from your data to your first verified saving.' },
  packet: { as: 'proof', lead: 'saved', job: 'Walks you through the evidence behind one verified saving.' },
  windows: { as: 'proof', lead: 'windows', job: 'Tracks every test that is running and when it reports.' },
  fences: { as: 'proof', lead: 'tests', job: 'Keeps every change inside the limits you set.' },
  comparison: { as: 'portfolio', lead: 'group', job: 'Puts your rooms side by side on the same measures.' },
  team: { as: 'portfolio', lead: 'group-needs', job: 'Shows who can see and do what across your rooms.' },
  accountant: { as: 'ledger', lead: 'saved', job: 'Hands your accountant only what is verified and ready to book.' },
  billing: { as: 'ledger', lead: 'saved', job: 'Shows what you are billed for: verified savings only.' },
  connect: { as: 'sources', lead: 'data-off', job: 'Gets the systems you already use feeding Coversight.' },
  data: { as: 'sources', lead: 'data', job: 'Lets you take your data out whenever you want it.' },
  inputs: { as: 'sources', lead: 'data', job: 'Takes anything you drop in and turns it into numbers you can trust.' },
};
/** Where there is no specialist: Sous itself, across the whole restaurant. */
const GENERAL = { name: 'Sous', job: 'Knows the whole restaurant and what to do next.', topics: ['week', 'today', 'plan', 'noticed'], ask: ['How did last week go?', 'What should we do first?', 'What needs me today?'] };

/** How each role's agents speak and what they put first. */
export const ROLE_VOICE = {
  owner: { word: 'For you as owner', first: [], say: 'Speak to the owner: money first, then the decision only they can make.' },
  gm: { word: 'For your room', first: ['today'], say: 'Speak to the general manager of this one room: what to do in the building this week, and who should do it.' },
  floor: { word: 'For tonight', first: ['today', 'kitchen', 'stock'], ask: ['What needs me today?', 'What is slowing the kitchen down?', 'Where are we losing product?'], say: 'Speak to a floor manager mid-shift: tonight only, as a short instruction. No profit figures.' },
  accountant: { word: 'For the books', first: ['saved', 'tests'], ask: ['What have we actually saved?', 'What is being tested?', 'Is my data up to date?'], say: 'Speak to the accountant: only what is verified and ready to book, and say plainly what is still an estimate.' },
};

/** Every page id that has its own or a shared agent. */
export const AGENT_PAGES = [...Object.keys(AGENTS), ...Object.keys(SAME)];

/** The agent for a page. */
export function agentFor(page) {
  if (AGENTS[page]) return { id: page, page, ...AGENTS[page] };
  const same = SAME[page];
  return same ? { id: same.as, page, ...AGENTS[same.as], lead: same.lead, job: same.job } : { id: 'sous', page, ...GENERAL };
}

const inArea = (f, topics) => topics.includes(f.topic) || !!f.also?.some((t) => topics.includes(t));

/**
 * What this page's agent sees right now: the move it recommends (or, when
 * nothing needs doing, the record it opens with), what it noticed in its own
 * area, how its area connects to others, and the questions it can answer.
 * Falls back to Sous's general read when the viewer's facts hold nothing in
 * its area (a floor manager on a P&L page).
 * @param {string} page
 * @param {any[]} facts from sousFacts()
 * @param {any[]} noticed from sousNoticed(), after sousRemember()
 * @param {{ role?: string, moves?: any[] }} [opts] `moves` from sousMoves()
 */
export function agentRead(page, facts, noticed = [], { role = 'owner', moves = [] } = {}) {
  let agent = agentFor(page);
  const voice = ROLE_VOICE[role] || ROLE_VOICE.owner;
  if (!facts.some((f) => inArea(f, agent.topics))) agent = { ...agent, topics: GENERAL.topics, ask: GENERAL.ask };
  const rank = (f) => { const i = agent.topics.indexOf(f.topic); return i < 0 ? agent.topics.length : i; };
  const mine = facts.filter((f) => inArea(f, agent.topics) && f.id !== 'kept').sort((a, b) => rank(a) - rank(b));
  // Something noticed on this very page leads; otherwise the agent's own opening record, then the first in its area.
  const here = noticed.filter((n) => n.go === page || n.go === agent.id || (n.topic === agent.topics[0] && n.topic !== 'noticed'));
  // On a page that shares its agent, the page's own record leads unless the thing was noticed on that very page.
  const own = agent.id === page || here[0]?.go === page || !mine.some((f) => f.id === agent.lead);
  const hereFact = own && here[0] ? facts.find((f) => f.id === `noticed:${here[0].id}`) : null;
  // A role's own priorities come first: a floor manager's agent leads with tonight wherever they are.
  const roleFact = voice.first.length && !hereFact ? facts.find((f) => f.id === 'today-first' && voice.first.includes('today')) || facts.find((f) => voice.first.includes(f.topic) && f.id !== 'kept') : null;
  const lead = hereFact || (role === 'owner' ? null : roleFact) || mine.find((f) => f.id === agent.lead) || mine.find((f) => !f.id.startsWith('noticed:') && f.topic !== 'link') || mine[0] || facts[0] || null;
  const move = moveFor({ ...agent, topics: [...voice.first, ...agent.topics] }, moves);
  const link = mine.find((f) => f.topic === 'link') || null;
  const more = mine.filter((f) => f !== lead && f !== link && !f.id.startsWith('noticed:')).slice(0, 3);
  const ask = [...new Set([...(voice.ask || []), ...agent.ask])].filter((q) => sousRelevant(q, facts, 3, agent.topics).length > 0).slice(0, 3);
  return {
    agent: { id: agent.id, name: agent.name, job: agent.job, page },
    voice: voice.word,
    move,
    lead: lead ? { id: lead.id, text: firstSentence(lead.text), full: lead.text, claim: lead.claim || null, go: lead.go, noticed: !!hereFact } : null,
    link: link ? { id: link.id, short: link.short || firstSentence(link.text), text: link.text, go: link.go } : null,
    more: more.map((f) => ({ id: f.id, label: f.label, text: f.text, claim: f.claim || null, go: f.go })),
    noticed: here.map(({ weight, ...n }) => n),
    elsewhere: noticed.filter((n) => !here.includes(n)).map(({ weight, ...n }) => n),
    ask,
    topics: agent.topics,
    // What this agent is saying, as a fingerprint: when it changes, the page has news.
    sig: sousHash([{ id: move?.id || lead?.id || '', label: '', text: `${move?.title || ''}|${move?.value || ''}|${lead?.full || ''}` }]),
  };
}

/**
 * Answer as a page's agent: its own area first, the rest of the restaurant
 * when the question goes there. "What should I do here?" is answered with the
 * agent's move, not a list of records.
 */
export function agentAnswer(page, question, facts, opts = {}) {
  const agent = agentFor(page);
  const q = String(question || '').toLowerCase();
  const move = opts.move || null;
  if (move && /\b(what (should|do|can) (i|we) do|what now|what next|do here|next step)\b/.test(q) && /\b(here|this (page|screen)|now|next)\b/.test(q)) {
    const used = facts.filter((f) => f.id === `noticed:${move.noticedId}` || (f.topic === 'link' && f.also?.includes(move.topic)) || (move.source === 'today' && f.id === 'today-first') || (move.source === 'plan' && (f.id === 'top' || f.id === 'plan'))).slice(0, 2);
    const at = move.go === 'finding' ? 'plan' : move.go;
    const cites = [{ label: facts.find((f) => f.go === at && f.topic !== 'link')?.label || '', go: at }, ...used.filter((f) => f.go !== at).map((f) => ({ label: f.label, go: f.go }))].filter((c, i, xs) => xs.findIndex((x) => x.go === c.go) === i);
    return { text: [`${move.title}.`, move.why, ...used.filter((f) => f.topic === 'link').map((f) => f.text)].filter(Boolean).join('\n\n'), short: `${move.title}.`, move, used: used.map((f) => f.id), cites, claim: move.claim, grounded: true, suggest: [] };
  }
  return sousAnswer(question, facts, { ...opts, focus: agent.topics });
}

/** The lines that tell the AI which agent it is right now and who it is talking to. Kept out of the cached prefix. */
export function agentBrief(page, pageTitle, role = 'owner') {
  const a = agentFor(page);
  const voice = (ROLE_VOICE[role] || ROLE_VOICE.owner).say;
  if (a.id === 'sous') return voice;
  return `Right now you are working as ${a.name}, Sous's specialist on the ${pageTitle || page} page. Your job there: ${a.job} Lead with what to do, then why, and when another part of the restaurant explains it or is affected by it, say so: you know all of the records, not only this page's. ${voice}`;
}

/**
 * The whole team at a glance: every specialist, the page it works on, how
 * many things it has noticed there and what its area has earned. One set of
 * facts, read by each in turn.
 * @param {Record<string, { wins: number, week: number, testing: number }>} [record] from agentRecord()
 */
export function agentTeam(facts, noticed = [], record = {}) {
  return Object.keys(AGENTS).map((page) => {
    if (!facts.some((f) => inArea(f, AGENTS[page].topics))) return null;
    const r = agentRead(page, facts, noticed);
    return { page, name: r.agent.name, job: r.agent.job, noticed: r.noticed.filter((n) => n.tone === 'warn').length, lead: r.lead?.text || '', record: record[page] || null };
  }).filter(Boolean);
}
