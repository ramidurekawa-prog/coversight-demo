/**
 * What Sous's agents recommend, remember and have earned. Pure.
 *
 * A *move* is one thing to do, with what it is worth and the way to do it
 * (draft an email, open an approval, go to a screen). An agent never acts on
 * its own: every move ends at a person's approval or a draft they send.
 * Every figure in a move comes from the derived room, like every fact.
 */
import { findingBlocked } from '../data/findings.js';
import { money, tmpl } from '../data/model.js';
import { cardTrust } from '../data/page/today-brief.js';
import { LINE_CHECK_PAGES, lineCheck } from './playbook.js';
import { sousHash, sousRole } from './sous.js';

const $ = (n) => money(Math.round(n));
const pct = (x) => `${(x * 100).toFixed(1)}%`;

/** The area a lever belongs to, as the fact topic and the page that owns it. */
const LEVER = {
  Labour: ['labor', 'labour'], Menu: ['menu', 'menu'], Purchasing: ['purchasing', 'purchasing'], Inventory: ['stock', 'inventory'],
  Controls: ['comps', 'controls'], Throughput: ['seats', 'throughput'], Kitchen: ['kitchen', 'kitchen'], Channels: ['delivery', 'channels'],
};
/** Topics each role's agents may recommend in. An accountant is never asked to run the floor. */
const ROLE_MOVES = { floor: ['today', 'stock', 'kitchen', 'data'], accountant: ['data', 'saved', 'tests'] };

/** The credit-request email for one vendor's increase: the numbers from the invoices, ready to send. */
export function vendorDraft(inv, d) {
  const room = d.profile?.name || 'our restaurant';
  return {
    to: inv.vendor,
    subject: `${inv.item}: price increase on our last invoices`,
    body: `Hi ${inv.vendor} team,\n\nOn our recent invoices for ${room}, ${inv.item} went from $${inv.p0.toFixed(2)} to $${inv.p1.toFixed(2)} per ${inv.unit} (up ${inv.pct.toFixed(1)}%). We buy about ${Math.round(inv.q1)} ${inv.unit} a month.\n\nCan you take us back toward the earlier price, or tell us what changed and what volume would get it there? We'd like to keep ordering from you.\n\nThanks,\n${d.profile?.gm || 'Purchasing'}, ${room}`,
  };
}

/* ------------------------------------------------------------------ memory */

/** How long "handled" keeps something quiet before Sous checks back, and how long "not for us" does. */
export const REMEMBER = { handledDays: 14, dismissedDays: 28 };

/** What a noticed thing looked like when the person answered it: if the numbers move, it is news again. */
export const noticedSig = (n) => sousHash([{ id: n.id, label: '', text: n.text }]);

/**
 * Apply what the room has told Sous. Something marked handled stays quiet for
 * two weeks, then comes back saying so if it is still there; something
 * dismissed stays quiet until its numbers change. Anything handled that is no
 * longer noticed is reported as resolved.
 * @param {any[]} noticed from sousNoticed()
 * @param {Record<string, { at: string, how: 'handled' | 'dismissed', sig: string, title?: string }>} [mem] the room's saved 'sous' decisions
 * @returns {{ active: any[], quiet: number, quietIds: string[], resolved: { id: string, title: string, at: string }[] }}
 */
export function sousRemember(noticed, mem = {}, now = Date.now()) {
  const m = mem && typeof mem === 'object' ? mem : {};
  const active = [];
  const quietIds = [];
  for (const n of noticed) {
    const r = m[n.id];
    const at = r ? Date.parse(r.at) : NaN;
    if (!r || !Number.isFinite(at)) { active.push(n); continue; }
    const days = (now - at) / 864e5;
    const on = new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    if (r.how === 'handled') {
      if (days < REMEMBER.handledDays) quietIds.push(n.id);
      else active.push({ ...n, back: true, text: `${n.text} You marked this handled on ${on}, and it is still showing.` });
    } else if (r.sig === noticedSig(n) && days < REMEMBER.dismissedDays) quietIds.push(n.id);
    else active.push(r.sig === noticedSig(n) ? n : { ...n, back: true, text: `${n.text} This has changed since you set it aside on ${on}.` });
  }
  const here = new Set(noticed.map((n) => n.id));
  const resolved = Object.entries(m)
    .filter(([id, r]) => r?.how === 'handled' && !here.has(id) && r.title)
    .map(([id, r]) => ({ id, title: String(r.title), at: r.at }));
  return { active, quiet: quietIds.length, quietIds, resolved };
}

/* ------------------------------------------------------------------ moves */

/**
 * Every move worth making in a room right now, most pressing first: what was
 * noticed, then Today's first card, then this week's plan.
 * @param {any} d a derived room
 * @param {{ noticed?: any[], card?: any, role?: string, quietIds?: string[] }} [ctx] `noticed` and `quietIds` after sousRemember(); `card` from sousToday()
 * @returns {{ id: string, topic: string, also: string[], go: string, goId?: string, title: string, why: string, value: string | null, unit: string, claim: string | null, act: any, source: string, noticedId?: string }[]}
 */
export function sousMoves(d, ctx = {}) {
  const role = sousRole(ctx.role);
  const fill = (s) => tmpl(String(s ?? ''), d.tokens || {});
  const out = [];
  const go = (page, goId) => ({ kind: 'go', page, ...(goId ? { goId } : {}) });

  for (const n of (ctx.noticed || []).filter((x) => x.tone === 'warn')) {
    const base = { id: `do:${n.id}`, topic: n.topic, also: [], go: n.go, why: n.text, claim: n.claim, source: 'noticed', noticedId: n.id, value: null, unit: '' };
    if (n.id === 'vendor:price') {
      const inv = [...(d.inv?.invoices || [])].filter((i) => i.pct >= 10 && i.priceLeg > 0).sort((a, b) => b.priceLeg - a.priceLeg)[0];
      if (inv) out.push({ ...base, title: `Ask ${inv.vendor} to take ${inv.item.toLowerCase()} back toward ${money(inv.p0, { cents: true })}`, value: $(inv.priceLeg), unit: 'added over the invoice period', act: { kind: 'email', ...vendorDraft(inv, d) } });
    } else if (n.id === 'stock:usage') {
      const top = [...(d.usage?.flagged || [])].sort((a, b) => b.dollars - a.dollars)[0];
      if (top) out.push({ ...base, title: `Spot-count ${top.label.toLowerCase()} before the next order`, value: $(top.dollars), unit: 'unexplained since the last count', act: go('inventory') });
    } else if (n.id.startsWith('register:')) {
      out.push({ ...base, title: 'Look at one person’s register pattern before talking to them', act: go('controls') });
    } else if (n.id === 'data:stale') {
      out.push({ ...base, title: `Bring ${(d.feeds || []).filter((f) => f.state === 'stale').map((f) => f.name).join(' and ')} up to date`, act: go('sources') });
    } else if (n.id.startsWith('week:')) {
      out.push({ ...base, title: `See what moved: ${n.title.charAt(0).toLowerCase()}${n.title.slice(1)}`, act: go(n.go) });
    }
  }

  const card = ctx.card;
  if (card) {
    const late = cardTrust(card, d, null).delayed;
    const title = fill(card.title).replace(/^Approve:\s*/i, '');
    out.push({
      id: `do:today:${card.id}`, topic: 'today', also: [], go: 'today', source: 'today',
      title: late ? `Check who is on, then decide: ${title.charAt(0).toLowerCase()}${title.slice(1)}` : title.charAt(0).toUpperCase() + title.slice(1),
      why: late ? `${late.name} was last updated ${late.last}, so confirm who is on before acting. ${fill(card.body)}` : fill(card.body),
      value: card.value && card.claim && card.claim !== 'none' ? fill(card.value) : null, unit: card.value ? fill(card.unit || card.means || 'potential') : '', claim: card.claim && card.claim !== 'none' ? card.claim : null,
      act: !late && card.approval ? { kind: 'approve', id: card.approval } : go('today'),
    });
  }

  // Each specialist's own line check: the biggest thing it found, with the fix a consultant would reach for.
  // Something the room said is handled stays quiet here too.
  const quietTopics = new Set((ctx.quietIds || []).map((id) => (id === 'vendor:price' ? 'purchasing' : id === 'stock:usage' ? 'stock' : id.startsWith('register:') ? 'comps' : '')));
  for (const page of LINE_CHECK_PAGES) {
    const book = lineCheck(page, d);
    const c = book?.checks.find((x) => x.status === 'found' && x.how);
    const topic = c && [...Object.values(LEVER)].find(([, p]) => p === page)?.[0];
    if (!c || !topic || quietTopics.has(topic) || out.some((m) => m.topic === topic)) continue;
    out.push({ id: `do:check:${c.id}`, topic, also: [], go: page, source: 'check', checkId: c.id, title: c.do || c.name, say: c.say || '', why: `${c.text} ${c.how}`, value: c.value, unit: c.unit, claim: c.claim, act: { kind: 'check', page, id: c.id } });
  }

  const chosen = d.plan?.chosen;
  // What the room said is handled stays handled on the plan side too: the same thing is not suggested under another name.
  const hushed = new Set((ctx.quietIds || []).map((id) => (id === 'vendor:price' ? 'vendor' : id === 'stock:usage' ? 'usage' : id.startsWith('register:') ? id.split(':')[1] === 'comps' ? 'comps' : 'voids' : '')));
  for (const c of (d.plan?.sorted || []).filter((x) => (!chosen || chosen.has?.(x.id)) && !hushed.has(x.kind))) {
    const [topic, page] = LEVER[c.lever] || ['plan', 'plan'];
    const blocked = findingBlocked(c, d.room || {});
    out.push({
      id: `do:plan:${c.id}`, topic, also: ['plan'], go: page, goId: c.id, source: 'plan',
      title: fill(c.title), why: blocked || fill(c.why || ''),
      value: c.value > 0 ? $(c.value) : null, unit: 'potential a week', claim: c.claim || 'est',
      act: !blocked && c.kind === 'price' && c.item && c.to ? { kind: 'approve', id: `price:${c.item}:${c.to}` } : go('finding', c.id),
    });
  }
  const may = ROLE_MOVES[role];
  return may ? out.filter((m) => may.includes(m.topic)) : out;
}

/** The move a page's agent leads with: one on its own page first, then the first in its area. */
export function moveFor(agent, moves) {
  const own = moves.find((m) => (m.go === agent.page || m.go === agent.id) && m.source !== 'plan');
  if (own) return own;
  for (const t of agent.topics) {
    const m = moves.find((x) => x.topic === t || (t === 'plan' && x.also.includes('plan')));
    if (m) return m;
  }
  return null;
}

/* ------------------------------------------------------------------ track record */

/**
 * What each area has earned so far: changes verified in a test and the
 * dollars a week they hold (bookable, the low end), plus tests still running.
 * @returns {Record<string, { wins: number, week: number, testing: number }>} by page id; `all` is the room's total
 */
export function agentRecord(d) {
  const out = { all: { wins: 0, week: 0, testing: 0 } };
  const at = (lever) => (out[LEVER[lever]?.[1] || 'plan'] ??= { wins: 0, week: 0, testing: 0 });
  for (const p of d.banked?.live || []) {
    for (const r of [at(p.lever), out.all]) { r.wins += 1; r.week += p.bookable || 0; }
  }
  for (const p of (d.proofs || d.allProof || []).filter((x) => x.outcome === 'testing' && (!x.loc || x.loc === d.id))) {
    for (const r of [at(p.lever), out.all]) r.testing += 1;
  }
  return out;
}

export { pct as movePct };

/* ------------------------------------------------------------------ the Pass */

/**
 * The Pass: everything Sous has for a room, laid out the way a kitchen lays
 * out tickets, in three lanes. "Do now" holds the moves, the page's own first;
 * "Keeping an eye on" holds tests that are running and what the room said is
 * handled; "Proven" holds verified changes at their bookable rate. Nothing is
 * in two lanes, and nothing here is typed: every ticket is a move, a test or a
 * verified change from the derived room.
 * @param {any} d a derived room
 * @param {{ moves?: any[], memory?: { resolved?: any[] }, mem?: Record<string, any>, page?: string, max?: number }} [ctx] `moves` from sousMoves(); `memory` from sousRemember(); `mem` the saved 'sous' decisions
 */
export function sousBoard(d, { moves = [], memory = {}, mem = {}, page = '', max = 4 } = {}) {
  const here = (m) => m.go === page;
  const seen = new Set();
  // One ticket per thing: the plan's version of something already noticed is the same ticket.
  const now = [...moves].sort((a, b) => Number(here(b)) - Number(here(a)))
    .filter((m) => { const k = `${m.topic}:${m.source === 'plan' ? 'plan' : 'live'}`; if (m.source === 'plan' && seen.has(`${m.topic}:live`)) return false; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max);
  const day = (iso) => new Date(Date.parse(iso)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const watching = [
    ...(d.proofs || []).filter((p) => p.outcome === 'testing').map((p) => ({ id: `test:${p.id}`, kind: 'test', go: 'packet', goId: p.id, page: LEVER[p.lever]?.[1] || 'proof', title: p.title, note: [p.checkpoint, p.held].filter(Boolean).join(' · '), progress: Number.isFinite(p.progress) ? p.progress : null })),
    ...Object.entries(mem && typeof mem === 'object' ? mem : {}).filter(([id, r]) => r?.title && Number.isFinite(Date.parse(r.at)) && !(memory.resolved || []).some((x) => x.id === id))
      .map(([id, r]) => ({ id: `mem:${id}`, kind: r.how === 'handled' ? 'handled' : 'aside', memId: id, go: '', page: '', title: r.title, note: r.how === 'handled' ? `You handled this on ${day(r.at)}. Checking back ${day(new Date(Date.parse(r.at) + REMEMBER.handledDays * 864e5).toISOString())}.` : `Set aside on ${day(r.at)}. Back only if the numbers change.`, progress: null })),
  ];
  const proven = [
    ...(d.banked?.live || []).map((p) => ({ id: `win:${p.id}`, kind: 'win', go: 'packet', goId: p.id, page: LEVER[p.lever]?.[1] || 'proof', title: p.title, value: `${$(p.bookable)} a week`, claim: 'book', note: p.held ? `Held ${p.held}` : '' })),
    ...(memory.resolved || []).map((r) => ({ id: `ok:${r.id}`, kind: 'resolved', go: '', page: '', title: r.title, value: null, claim: null, note: 'No longer showing since you handled it.' })),
  ];
  return { now, watching, proven, more: Math.max(0, moves.length - now.length) };
}
