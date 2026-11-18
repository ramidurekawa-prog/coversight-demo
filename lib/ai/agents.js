/**
 * Sous's page agents. Every page has its own named agent: a specialist with
 * its own job, its own focus within the restaurant's facts, its own read of
 * the page and its own questions. They are all Sous: each one works from the
 * same facts (lib/ai/sous.js), so an agent on one page can connect what it
 * sees to what another page knows. That shared set of facts is the brain.
 *
 * Pure. An agent never holds a number: its read is picked from the facts.
 */
import { sousAnswer, sousRelevant } from './sous.js';

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
/** Pages that share another page's agent. */
const SAME = { finding: 'plan', levers: 'plan', start: 'plan', packet: 'proof', windows: 'proof', fences: 'proof', comparison: 'portfolio', team: 'portfolio', accountant: 'ledger', billing: 'ledger', connect: 'sources', data: 'sources', inputs: 'sources' };
/** Where there is no specialist: Sous itself, across the whole restaurant. */
const GENERAL = { name: 'Sous', job: 'Knows the whole restaurant and what to do next.', topics: ['week', 'today', 'plan', 'noticed'], ask: ['How did last week go?', 'What should we do first?', 'What needs me today?'] };

/** Every page id that has its own or a shared agent. */
export const AGENT_PAGES = [...Object.keys(AGENTS), ...Object.keys(SAME)];

/** The agent for a page. */
export function agentFor(page) {
  const id = AGENTS[page] ? page : SAME[page];
  return id ? { id, page, ...AGENTS[id] } : { id: 'sous', page, ...GENERAL };
}

const firstSentence = (text) => `${String(text).split(/(?<=[a-z)%\d])\.\s+(?=[A-Z])/)[0].replace(/\.$/, '')}.`;

/**
 * What this page's agent sees right now: one line to lead with, what it
 * noticed in its own area, and the questions it can answer. Falls back to
 * Sous's general read when the viewer's facts hold nothing in its area (a
 * floor manager on a P&L page).
 * @param {string} page
 * @param {any[]} facts from sousFacts()
 * @param {any[]} noticed from sousNoticed()
 */
export function agentRead(page, facts, noticed = []) {
  let agent = agentFor(page);
  const inFocus = (a) => facts.filter((f) => a.topics.includes(f.topic));
  if (!inFocus(agent).length) agent = { ...agent, topics: GENERAL.topics, ask: GENERAL.ask };
  const rank = (f) => agent.topics.indexOf(f.topic);
  const mine = inFocus(agent).filter((f) => f.id !== 'kept').sort((a, b) => rank(a) - rank(b));
  // Something noticed on this very page leads; otherwise the agent's own opening record, then the first in its area.
  const here = noticed.filter((n) => n.go === page || n.go === agent.id || (n.topic === agent.topics[0] && n.topic !== 'noticed'));
  const hereFact = here[0] && facts.find((f) => f.id === `noticed:${here[0].id}`);
  const lead = hereFact || mine.find((f) => f.id === agent.lead) || mine.find((f) => !f.id.startsWith('noticed:')) || mine[0] || facts[0] || null;
  const more = mine.filter((f) => f !== lead && !f.id.startsWith('noticed:')).slice(0, 3);
  return {
    agent: { id: agent.id, name: agent.name, job: agent.job, page },
    lead: lead ? { id: lead.id, text: firstSentence(lead.text), full: lead.text, claim: lead.claim || null, go: lead.go, noticed: !!hereFact } : null,
    more: more.map((f) => ({ id: f.id, label: f.label, text: f.text, claim: f.claim || null, go: f.go })),
    noticed: here.map(({ weight, ...n }) => n),
    elsewhere: noticed.filter((n) => !here.includes(n)).map(({ weight, ...n }) => n),
    ask: agent.ask.filter((q) => sousRelevant(q, facts, 3, agent.topics).length > 0).slice(0, 3),
    topics: agent.topics,
  };
}

/** Answer as a page's agent: its own area first, the rest of the restaurant when the question goes there. */
export function agentAnswer(page, question, facts, opts = {}) {
  const agent = agentFor(page);
  return sousAnswer(question, facts, { ...opts, focus: agent.topics });
}

/** The line that tells the AI which agent it is right now. Kept out of the cached prefix. */
export function agentBrief(page, pageTitle) {
  const a = agentFor(page);
  if (a.id === 'sous') return '';
  return `Right now you are working as ${a.name}, Sous's specialist on the ${pageTitle || page} page. Your job there: ${a.job} Lead with what matters for that job, and when another part of the restaurant explains it or is affected by it, say so: you know all of the records, not only this page's.`;
}

/**
 * The whole team at a glance: every specialist, the page it works on and how
 * many things it has noticed there. One set of facts, read by each in turn.
 */
export function agentTeam(facts, noticed = []) {
  return Object.keys(AGENTS).map((page) => {
    const r = agentRead(page, facts, noticed);
    const own = facts.some((f) => AGENTS[page].topics.includes(f.topic));
    return own ? { page, name: r.agent.name, job: r.agent.job, noticed: r.noticed.filter((n) => n.tone === 'warn').length, lead: r.lead?.text || '' } : null;
  }).filter(Boolean);
}
