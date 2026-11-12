/**
 * The two copilots, deterministic: route a question to what the crew knows
 * and answer from those facts only, with where each fact comes from. The
 * server may ask Claude to phrase the same facts (server/agents/ask.ts), but
 * the facts, and the refusal to guess, are decided here.
 */
import { LEVER_ACCOUNT, TEST_TO_DIAL } from './crew.js';
import { findingStatus } from '../data/findings.js';

const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
const cents = (c) => money((c || 0) / 100);
const has = (q, ...w) => w.some((x) => new RegExp(`\\b${x}`, 'i').test(q));

const STATUS = { running: 'running', waiting: 'waiting for the next week of data', verified: 'verified', rejected: 'ended without a result it could book', reversed: 'reversed by a guardrail', stopped: 'stopped by a person' };

/**
 * @param {'operator'|'accountant'} who
 * @param {string} question
 * @param {any} facts the crew's facts (see cycle.js / stores)
 * @param {{ roomId?: string }} [opts]
 * @returns {{ topic: string, text: string, cites: { label: string, href?: string }[] }}
 */
export function answer(who, question, facts, { roomId } = {}) {
  const q = String(question || '').slice(0, 500);
  const rooms = facts.rooms.filter((r) => !roomId || r.id === roomId);
  const named = facts.rooms.find((r) => new RegExp(`\\b${r.name}\\b`, 'i').test(q));
  const scope = named ? [named] : rooms;
  const where = scope.length === 1 ? scope[0].name : 'the group';
  const wins = facts.windows.filter((w) => scope.some((r) => r.id === w.roomId));

  if (has(q, 'stuck', 'test', 'window', 'measur', 'waiting')) {
    const open = wins.filter((w) => ['running', 'waiting'].includes(w.status));
    if (!wins.length) return { topic: 'tests', text: `No tests in ${where} yet. A test starts when someone approves a plan in System or on Today.`, cites: [{ label: 'Test windows', href: '/windows' }] };
    const lines = wins.slice(0, 6).map((w) => {
      const r = facts.rooms.find((x) => x.id === w.roomId);
      const why = w.status === 'waiting' ? ` It needs data after ${r?.dataEnd}; ${r?.own ? 'the next Toast sync or export' : 'the next upload'} lets it carry on.` : '';
      return `${w.title} (${r?.name}): ${STATUS[w.status] ?? w.status}, day ${w.day} of 28.${w.status === 'verified' ? ` Booked ${cents(w.bookedCents)} a week at the lower bound.` : ''}${why}`;
    });
    return { topic: 'tests', text: `${open.length} of ${wins.length} test${wins.length === 1 ? '' : 's'} in ${where} still open.\n${lines.join('\n')}`, cites: [{ label: 'Test windows', href: '/windows' }, { label: 'Proof loop (Measurement agent)' }] };
  }
  if (has(q, 'data', 'fresh', 'stale', 'sync', 'toast', 'upload')) {
    const lines = scope.map((r) => `${r.name}: data to ${r.dataEnd} (${r.own ? 'your Toast data' : 'sample data'})${r.staleDays > 9 ? `, ${r.staleDays} days old: findings and tests wait for the next week` : ''}.`);
    const conn = facts.conn ? `Toast sync: ${facts.conn.state}${facts.conn.lastError ? ` (${facts.conn.lastError})` : ''}.` : 'No Toast API connection; data arrives by upload or linked sheet.';
    return { topic: 'data', text: `${lines.join('\n')}\n${conn}`, cites: [{ label: 'Data inputs', href: '/inputs' }, { label: 'Connect', href: '/connect' }] };
  }
  if (who === 'accountant' || has(q, 'ledger', 'account', 'mapping', 'invoice', 'package', 'book', 'gl\\b', 'lineage')) {
    const verified = wins.filter((w) => w.status === 'verified');
    const total = verified.reduce((s, w) => s + w.bookedCents, 0);
    const maps = facts.proposals.filter((p) => p.kind === 'mapping');
    const lines = verified.map((w) => {
      const dial = TEST_TO_DIAL[w.lever];
      const m = maps.find((p) => p.key === `mapping:${w.roomId}:${dial}`);
      const acct = m?.status === 'accepted' ? `${m.payload.account} (confirmed${m.decidedBy ? ` by ${m.decidedBy}` : ''})` : `${LEVER_ACCOUNT[dial]?.account ?? 'unmapped'} (proposed, not confirmed)`;
      return `${w.title}: ${cents(w.bookedCents)}/wk, ${w.method === 'diff_in_diff' ? 'difference-in-differences against control rooms' : 'before/after against a frozen 4-week baseline'}, lower bound of a 90% interval, 4 weekly checkpoints → ${acct}.`;
    });
    const inv = facts.invoices.slice(0, 2).map((i) => `${i.period}: ${i.status}`).join('; ');
    return { topic: 'ledger', text: verified.length ? `${where}: ${verified.length} verified test${verified.length === 1 ? '' : 's'}, ${cents(total)} a week booked.\n${lines.join('\n')}${inv ? `\nInvoices: ${inv}.` : ''}` : `Nothing verified in ${where} yet, so nothing is booked and nothing is invoiced. Estimates never reach the ledger.`, cites: [{ label: 'Ledger', href: '/ledger' }, { label: 'Accountant', href: '/accountant' }] };
  }
  if (has(q, 'saved', 'saving', 'bank', 'verified', 'earned', 'proof')) {
    const v = wins.filter((w) => w.status === 'verified');
    return { topic: 'savings', text: v.length ? `${where} has ${v.length} verified change${v.length === 1 ? '' : 's'} worth ${cents(v.reduce((s, w) => s + w.bookedCents, 0))} a week, each booked at the lower bound of its measured effect: ${v.map((w) => w.title).join('; ')}.` : `Nothing in ${where} is verified yet. Findings are estimates until a 28-day test measures them.`, cites: [{ label: 'Proof', href: '/proof' }] };
  }
  const lever = ['labour', 'menu', 'price', 'void', 'comp', 'purchas', 'vendor', 'throughput', 'turn'].find((w) => has(q, w));
  if (lever || has(q, 'next', 'first', 'priority', 'top', 'should', 'do')) {
    const lines = scope.map((r) => {
      // The ranking is from the crew's last run; anything a test has picked up since isn't advice any more.
      const inTest = (id) => { const c = r.d?.candidates?.find((x) => x.id === id); return c ? ['testing', 'verified'].includes(findingStatus(c, facts.windows, r.id).state) : false; };
      const rk = (facts.proposals.find((p) => p.key === `ranking:${r.id}`)?.payload?.items ?? []).filter((x) => !inTest(x.id) && !facts.proposals.some((p) => p.key === `plan:${r.id}:${x.id}` && ['accepted', 'rejected'].includes(p.status)));
      const items = lever ? rk.filter((x) => new RegExp(lever, 'i').test(`${x.lever} ${x.title}`)) : rk.filter((x) => x.chosen);
      return items.length ? `${r.name}: ${items.slice(0, 3).map((x) => `${x.title} (~${money(x.value)}/wk, ${money(x.perHour)} per manager-hour${x.blocked ? `; blocked: ${x.blocked}` : ''})`).join('; ')}.` : `${r.name}: nothing ${lever ? `on ${lever}` : 'ranked'} right now.`;
    });
    return { topic: 'priorities', text: `${lines.join('\n')}\nThese are estimates until tested.`, cites: [{ label: 'Recommendation agent' }, { label: 'Plan', href: '/plan' }] };
  }
  return { topic: 'help', text: `I answer from ${where}'s data and the crew's last run. Try: “what should we do first?”, “why is a test stuck?”, “is our data fresh?”, “what have we saved?”${who === 'accountant' ? ', “where does each saving land in the ledger?”' : ''}. I won't guess beyond that.`, cites: [] };
}
