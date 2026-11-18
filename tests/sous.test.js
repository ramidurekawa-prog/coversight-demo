import { describe, expect, it } from 'vitest';

import { numbersOk, sousAnswer, sousBrief, sousFacts, sousHash, sousNoticed, sousRelevant, sousSheet, sousSuggest, sousToday } from '../lib/ai/sous.js';
import { applyInputs } from '../lib/data/apply.js';
import { deriveRoom, money } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';

const rooms = Object.keys(SEED.rooms);
const room = (id) => deriveRoom(SEED, id);

describe('Sous reads a room into facts', () => {
  it('every room gets facts with no unfilled token, each tied to a screen', () => {
    for (const id of rooms) {
      const facts = sousFacts(room(id));
      expect(facts.length, id).toBeGreaterThan(10);
      for (const f of facts) {
        expect(f.text, f.id).not.toMatch(/\{[a-zA-Z]+\}|undefined|NaN/);
        expect(f.go, f.id).toBeTruthy();
      }
      expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length);
    }
  });

  it('the figures are the model’s own, not typed', () => {
    const d = room('oakland');
    const by = Object.fromEntries(sousFacts(d).map((f) => [f.id, f.text]));
    expect(by.week).toContain(money(Math.round(d.week.net)));
    expect(by.week).toContain(money(Math.round(d.hist.rows.at(-1).earned)));
    expect(by.saved).toContain(money(Math.round(d.banked.week)));
    expect(by.delivery).toContain(`${(d.chan.deliveryShare * 100).toFixed(1)}%`);
    // Change the data and the facts follow.
    const moved = deriveRoom(applyInputs(SEED, { oakland: { channels: { rows: [{ channel: 'DoorDash', sales: 9000, fee_pct: 25, refunds: 96 }], date: 'Oct 27' } } }), 'oakland');
    expect(sousFacts(moved).find((f) => f.id === 'delivery').text).not.toBe(by.delivery);
  });

  it('an estimate never reads as money saved', () => {
    for (const id of rooms) {
      const facts = sousFacts(room(id));
      expect(facts.find((f) => f.id === 'plan')?.text ?? 'potential, not saved').toMatch(/potential, not saved/);
      const top = facts.find((f) => f.id === 'top');
      if (top) expect(top.text).toMatch(/modeled|estimated|observed/);
    }
  });

  it('a floor manager’s Sous has no P&L', () => {
    const facts = sousFacts(room('oakland'), { role: 'floor' });
    expect(facts.map((f) => f.topic)).not.toContain('week');
    expect(facts.map((f) => f.topic)).not.toContain('saved');
    expect(sousSheet(facts)).not.toMatch(/net sales|kept \$/);
    expect(sousBrief(room('oakland'), { role: 'floor' }).noticed.every((n) => ['stock', 'data'].includes(n.topic))).toBe(true);
  });
});

describe('Sous noticed', () => {
  it('flags only what the data shows, with the range it is judged against', () => {
    const n = sousNoticed(room('oakland'));
    expect(n.map((x) => x.id)).toEqual(expect.arrayContaining(['vendor:price', 'stock:usage', 'data:stale']));
    const reg = n.find((x) => x.topic === 'comps');
    expect(reg.text).toMatch(/2\.9% of their sales.*2\.2% is normal/);
    // A pattern, not a person: nobody is named.
    for (const p of room('oakland').staff.people) expect(reg.text).not.toContain(p.name);
  });

  it('a week outside the room’s own range is noticed; a normal week is not', () => {
    const d = room('oakland');
    expect(sousNoticed(d).some((x) => x.id.startsWith('week:'))).toBe(false);
    const rows = d.hist.rows.map((r, i, all) => (i === all.length - 1 ? { ...r, foodRate: r.foodRate + 0.08 } : r));
    const spiked = sousNoticed({ ...d, hist: { ...d.hist, rows } });
    const food = spiked.find((x) => x.id === 'week:foodRate');
    expect(food).toMatchObject({ tone: 'warn', go: 'purchasing' });
    expect(food.text).toMatch(/usually sat between/);
  });

  it('says so when nothing stands out', () => {
    const d = room('oakland');
    const calm = { ...d, feeds: d.feeds.map((f) => ({ ...f, state: 'healthy' })), usage: { ...d.usage, flagged: [] }, inv: { ...d.inv, invoices: [] }, staff: { ...d.staff, types: {} } };
    expect(sousNoticed(calm)).toEqual([]);
    expect(sousFacts(calm).find((f) => f.id === 'noticed:none').text).toMatch(/Nothing unusual/);
  });
});

describe('the brief', () => {
  it('one headline, at most three lines and one action, ordered for the reader', () => {
    const d = room('oakland');
    const owner = sousBrief(d, { role: 'owner' });
    expect(owner.headline).toMatch(/^Oakland kept \$18,940/);
    expect(owner.lines.map((l) => l.label)).toEqual(['What changed', 'Sous noticed', 'Biggest opportunity']);
    expect(owner.action).toMatchObject({ go: 'today' });
    expect(sousBrief(d, { role: 'gm' }).lines[0].label).toBe('On Today');
    expect(sousBrief(d, { role: 'accountant' }).action.go).toBe('proof');
    expect(sousBrief(d, { role: 'admin' }).lines).toEqual(owner.lines);
  });

  it('holds back advice that rests on a feed that is behind, like Today does', () => {
    const b = sousBrief(room('oakland'), { role: 'gm' });
    expect(b.action.title).toMatch(/^Check first: cut one server/);
    expect(b.action.why).toMatch(/7shifts was last updated/);
  });

  it('leads with the first card still open on Today, never one already decided', () => {
    const d = room('oakland');
    const t0 = sousToday(d, {});
    expect(t0.card.id).toBe('cut');
    const now = Date.now();
    const t1 = sousToday(d, { stored: { done: { cut: new Date(now).toISOString() }, refused: {} }, now });
    expect(t1.card.id).not.toBe('cut');
    expect(sousBrief(d, { card: t1.card, open: t1.open }).action.title).not.toMatch(/cut one server/);
    expect(sousFacts(d, { card: null, open: [] }).find((f) => f.id === 'today').text).toMatch(/Nothing is waiting/);
  });
});

describe('answers', () => {
  const facts = sousFacts(room('oakland'));
  it('answers from the facts and shows which screens they come from', () => {
    const a = sousAnswer('What should we do first?', facts, { room: 'Oakland' });
    expect(a).toMatchObject({ grounded: true, used: ['top'], claim: 'mod', cites: [{ go: 'plan' }] });
    expect(sousAnswer('Is delivery worth it?', facts).used).toEqual(['delivery']);
    expect(sousAnswer('How did last week go?', facts).used).toEqual(['week', 'week-change']);
    expect(sousRelevant('anything unusual I should worry about?', facts).every((f) => f.id.startsWith('noticed:'))).toBe(true);
  });

  it('says it doesn’t know instead of guessing', () => {
    const a = sousAnswer('What will the weather be on Saturday?', facts, { room: 'Oakland' });
    expect(a.grounded).toBe(false);
    expect(a.text).toMatch(/don't have that in Oakland's records/);
    expect(a.text).not.toMatch(/\d/);
    expect(a.suggest.length).toBeGreaterThan(0);
  });

  it('every suggested question has an answer', () => {
    for (const role of ['owner', 'gm', 'floor', 'accountant']) {
      const f = sousFacts(room('oakland'), { role });
      const qs = sousSuggest(f, role);
      expect(qs.length).toBeGreaterThan(1);
      for (const q of qs) expect(sousAnswer(q, f).grounded, `${role}: ${q}`).toBe(true);
    }
  });
});

describe('the figure check on AI-written text', () => {
  const sheet = sousSheet(sousFacts(room('oakland')));
  it('passes text that only repeats the records’ figures', () => {
    expect(numbersOk('Oakland kept $18,940 after food and labor, from 1,412 covers.', sheet)).toBe(true);
    expect(numbersOk('Food cost was 29.1% of sales.', sheet)).toBe(true);
    expect(numbersOk('Your 3 rooms? I only have Oakland.', sheet, 'How are my 3 rooms doing?')).toBe(true);
  });
  it('rejects a figure the records don’t contain: invented, computed or annualized', () => {
    expect(numbersOk('Raise the salmon and make $9,999 a week.', sheet)).toBe(false);
    expect(numbersOk('That is about $7,592 a year.', sheet)).toBe(false);
    expect(numbersOk('Food cost was 29.2% of sales.', sheet)).toBe(false);
  });
  it('the fingerprint changes when a fact does', () => {
    const facts = sousFacts(room('oakland'));
    expect(sousHash(facts)).toBe(sousHash(sousFacts(room('oakland'))));
    expect(sousHash(facts)).not.toBe(sousHash(sousFacts(room('berkeley'))));
  });
});

// ---- page agents -----------------------------------------------------------
import { AGENT_PAGES, agentAnswer, agentBrief, agentFor, agentRead, agentTeam } from '../lib/ai/agents.js';
import { deriveGroup } from '../lib/data/model.js';
import { CV_PAGES } from '../lib/pages.js';

describe('page agents', () => {
  const rooms = Object.keys(SEED.rooms);
  const factsFor = (roomId, role = 'owner') => {
    const d = deriveRoom(SEED, roomId);
    const noticed = sousNoticed(d);
    return { d, noticed, facts: sousFacts(d, { role, noticed, group: deriveGroup(SEED) }) };
  };

  it('every page has an agent, and no agent is left without a page', () => {
    for (const page of Object.keys(CV_PAGES)) expect(agentFor(page).id, page).not.toBe('sous');
    for (const page of AGENT_PAGES) expect(CV_PAGES[page], page).toBeTruthy();
  });

  it('agents have unique names', () => {
    const names = AGENT_PAGES.map((p) => agentFor(p)).filter((a) => a.id === a.page).map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('on every page in every room the agent opens with a record, word for word, and only offers questions it can answer', () => {
    for (const roomId of rooms) {
      const { facts, noticed } = factsFor(roomId);
      const sheet = sousSheet(facts);
      for (const page of Object.keys(CV_PAGES)) {
        const r = agentRead(page, facts, noticed);
        expect(r.lead, `${roomId}/${page}`).toBeTruthy();
        expect(facts.find((f) => f.id === r.lead.id).text.startsWith(r.lead.text.replace(/\.$/, ''))).toBe(true);
        expect(numbersOk(r.lead.text, sheet)).toBe(true);
        for (const q of r.ask) expect(agentAnswer(page, q, facts).grounded, `${roomId}/${page}: ${q}`).toBe(true);
      }
    }
  });

  it('different pages lead with different things from the same facts', () => {
    const { facts, noticed } = factsFor(rooms[0]);
    const leads = ['today', 'week', 'purchasing', 'controls', 'proof', 'sources', 'portfolio'].map((p) => agentRead(p, facts, noticed).lead.id);
    expect(new Set(leads).size).toBe(leads.length);
  });

  it('what was noticed on a page leads that page and is not repeated under "other pages"', () => {
    const { facts, noticed } = factsFor(rooms[0]);
    const price = noticed.find((n) => n.go === 'purchasing');
    expect(price).toBeTruthy();
    const r = agentRead('purchasing', facts, noticed);
    expect(r.lead.id).toBe(`noticed:${price.id}`);
    expect(r.elsewhere.some((n) => n.id === price.id)).toBe(false);
    expect(r.noticed.length + r.elsewhere.length).toBe(noticed.length);
  });

  it('"what should I do here?" is answered from the page\'s own area', () => {
    const { facts } = factsFor(rooms[0]);
    const a = agentAnswer('purchasing', 'What should I do here?', facts);
    expect(a.grounded).toBe(true);
    expect(a.cites[0].go).toBe('purchasing');
    expect(agentAnswer('controls', 'What should I do here?', facts).cites[0].go).toBe('controls');
  });

  it('one brain: any agent can answer about another area, and about the other rooms', () => {
    const { facts } = factsFor(rooms[0]);
    expect(agentAnswer('kitchen', 'What have we actually saved?', facts).cites.some((c) => c.go === 'proof')).toBe(true);
    const group = agentAnswer('menu', 'Which room needs me most?', facts);
    expect(group.grounded).toBe(true);
    for (const id of rooms) expect(facts.find((f) => f.id === 'group').text).toContain(deriveRoom(SEED, id).profile.short);
  });

  it('a manager of one room is told nothing about the other rooms', () => {
    for (const role of ['gm', 'floor']) expect(factsFor(rooms[0], role).facts.some((f) => f.topic === 'group')).toBe(false);
  });

  it('a floor manager on a page outside their area gets a read from what they may see', () => {
    const { facts, noticed } = factsFor(rooms[0], 'floor');
    const r = agentRead('ledger', facts, noticed);
    expect(r.lead).toBeTruthy();
    expect(facts.some((f) => f.id === r.lead.id)).toBe(true);
  });

  it('the team lists each specialist once with its page', () => {
    const { facts, noticed } = factsFor(rooms[0]);
    const team = agentTeam(facts, noticed);
    expect(team.length).toBeGreaterThan(15);
    expect(new Set(team.map((a) => a.name)).size).toBe(team.length);
    expect(team.reduce((s, a) => s + a.noticed, 0)).toBeGreaterThan(0);
  });

  it('the line that tells the AI which agent it is holds no figures', () => {
    for (const page of Object.keys(CV_PAGES)) expect(agentBrief(page, CV_PAGES[page].title)).not.toMatch(/\d/);
  });

  it('holds back a Today recommendation built on a delayed feed', () => {
    const { facts } = factsFor('oakland');
    expect(facts.find((f) => f.id === 'today-first').text).toMatch(/check before you act/);
  });
});

// ---- moves, memory, links, track record -------------------------------------
import { REMEMBER, agentRecord, moveFor, noticedSig, sousMoves, sousRemember, vendorDraft } from '../lib/ai/moves.js';
import { ROLE_VOICE } from '../lib/ai/agents.js';
import { sousLinks } from '../lib/ai/sous.js';

describe('what the agents recommend', () => {
  const rooms = Object.keys(SEED.rooms);
  const world = (roomId, role = 'owner', mem = {}, now = Date.now()) => {
    const d = deriveRoom(SEED, roomId);
    const today = sousToday(d);
    const memory = sousRemember(sousNoticed(d), mem, now);
    const facts = sousFacts(d, { role, noticed: memory.active, card: today.card, open: today.open, group: deriveGroup(SEED) });
    const moves = sousMoves(d, { noticed: memory.active, card: today.card, role, quietIds: memory.quietIds });
    return { d, memory, facts, moves, read: (page) => agentRead(page, facts, memory.active, { role, moves }) };
  };

  it('every move says what to do, and every figure in it is in the records or the room', () => {
    for (const roomId of rooms) {
      const { d, facts, moves } = world(roomId);
      expect(moves.length).toBeGreaterThan(3);
      const known = `${sousSheet(facts)} ${JSON.stringify(d.plan.sorted)} ${JSON.stringify(d.queue)} ${JSON.stringify(d.inv.invoices)} ${JSON.stringify(d.tokens)}`;
      for (const m of moves) {
        expect(m.title.length, m.id).toBeGreaterThan(8);
        expect(['email', 'approve', 'go']).toContain(m.act.kind);
        if (m.value) expect(m.claim, `${m.id} has a figure with no claim`).toBeTruthy();
        expect(numbersOk(`${m.title} ${m.value || ''}`, known), `${roomId}/${m.id}: ${m.title} ${m.value}`).toBe(true);
      }
    }
  });

  it('a supplier increase becomes an email draft with the invoice figures, never a send', () => {
    const { d, read } = world('oakland');
    const m = read('purchasing').move;
    expect(m).toMatchObject({ source: 'noticed', noticedId: 'vendor:price', claim: 'obs', value: '$873' });
    expect(m.act.kind).toBe('email');
    expect(m.act.body).toContain('$11.40 to $13.65');
    expect(m.act).toEqual({ kind: 'email', ...vendorDraft(d.inv.invoices[0], d) });
  });

  it('a potential gain is never called saved', () => {
    for (const roomId of rooms) for (const m of world(roomId).moves.filter((x) => x.source === 'plan')) {
      expect(m.unit).toBe('potential a week');
      expect(`${m.title} ${m.why}`).not.toMatch(/\bsaved\b/i);
    }
  });

  it('a price change is only offered for approval when nothing blocks it', () => {
    const { moves, d } = world('oakland');
    const salmon = moves.find((m) => m.id === 'do:plan:salmon');
    const ribeye = moves.find((m) => m.id === 'do:plan:ribeye');
    expect(salmon.act.kind).toBe('go'); // rests on recipe costs that are out of date
    expect(ribeye.act).toEqual({ kind: 'approve', id: `price:ribeye:${d.plan.sorted.find((c) => c.id === 'ribeye').to}` });
  });

  it('holds back tonight’s cut while the schedule feed is stale: go and check, no approval', () => {
    const m = world('oakland').read('service').move;
    expect(m.title).toMatch(/^Check who is on/);
    expect(m.act).toEqual({ kind: 'go', page: 'today' });
  });

  it('each role gets its own voice and only moves that are theirs to make', () => {
    expect(world('oakland', 'accountant').moves.every((m) => ROLE_MOVES_OK.accountant.includes(m.topic))).toBe(true);
    expect(world('oakland', 'floor').moves.some((m) => m.source === 'plan')).toBe(false);
    expect(world('oakland', 'floor').read('ledger').voice).toBe(ROLE_VOICE.floor.word);
    expect(world('oakland', 'floor').read('menu').lead.id).toBe('today-first');
    expect(world('oakland', 'accountant').read('accountant').move?.source).not.toBe('today');
    for (const role of Object.keys(ROLE_VOICE)) expect(agentBrief('menu', 'Menu', role)).toContain(ROLE_VOICE[role].say);
  });
  const ROLE_MOVES_OK = { accountant: ['data', 'saved', 'tests'] };

  it('pages that share an agent still open with their own record and job', () => {
    const { read } = world('oakland');
    const pages = ['sources', 'connect', 'inputs', 'data'];
    expect(new Set(pages.map((p) => read(p).agent.job)).size).toBe(pages.length);
    expect(read('connect').lead.id).toBe('data-off');
    expect(read('fences').lead.id).not.toBe(read('proof').lead.id);
  });

  it('"what should I do here?" answers with the move itself: one sentence, its figure, its button', () => {
    const { facts, read } = world('oakland');
    const move = read('purchasing').move;
    const a = agentAnswer('purchasing', 'What should I do here?', facts, { move });
    expect(a.short).toBe(`${move.title}.`);
    expect(a.move).toBe(move);
    expect(a.cites[0].go).toBe('purchasing');
    // Any other question gets one sentence first and the records behind it.
    const b = agentAnswer('purchasing', 'How did last week go?', facts, { move });
    expect(b.short.length).toBeLessThan(b.text.length);
    expect(b.text.startsWith(b.short.replace(/\.$/, ''))).toBe(true);
  });
});

describe('what Sous remembers', () => {
  const d = deriveRoom(SEED, 'oakland');
  const noticed = sousNoticed(d);
  const price = noticed.find((n) => n.id === 'vendor:price');
  const t0 = Date.parse('2026-10-27T00:00:00Z');
  const said = (how, extra = {}) => ({ [price.id]: { at: new Date(t0).toISOString(), how, sig: noticedSig(price), title: price.title, ...extra } });

  it('handled stays quiet for two weeks, then comes back saying so', () => {
    const soon = sousRemember(noticed, said('handled'), t0 + 3 * 864e5);
    expect(soon.active.some((n) => n.id === price.id)).toBe(false);
    expect(soon).toMatchObject({ quiet: 1, quietIds: [price.id] });
    const later = sousRemember(noticed, said('handled'), t0 + (REMEMBER.handledDays + 1) * 864e5);
    const back = later.active.find((n) => n.id === price.id);
    expect(back.back).toBe(true);
    expect(back.text).toMatch(/You marked this handled on Oct 27, and it is still showing\.$/);
  });

  it('"not for us" stays quiet until the numbers change', () => {
    expect(sousRemember(noticed, said('dismissed'), t0 + 864e5).active.some((n) => n.id === price.id)).toBe(false);
    const moved = sousRemember(noticed, said('dismissed', { sig: 'old' }), t0 + 864e5).active.find((n) => n.id === price.id);
    expect(moved.text).toMatch(/has changed since you set it aside/);
  });

  it('reports what was handled and is no longer showing', () => {
    const r = sousRemember(noticed.filter((n) => n.id !== price.id), said('handled'), t0 + 864e5);
    expect(r.resolved).toEqual([{ id: price.id, title: price.title, at: new Date(t0).toISOString() }]);
  });

  it('once handled, the same thing is not suggested again from the plan', () => {
    const memory = sousRemember(noticed, said('handled'), t0 + 864e5);
    const moves = sousMoves(d, { noticed: memory.active, quietIds: memory.quietIds });
    expect(moves.some((m) => m.noticedId === price.id)).toBe(false);
    expect(moves.some((m) => m.id === 'do:plan:vendor')).toBe(false);
    expect(sousMoves(d, { noticed }).some((m) => m.id === 'do:plan:vendor')).toBe(true);
  });

  it('survives a damaged memory', () => {
    for (const bad of [null, 'x', { 'vendor:price': null }, { 'vendor:price': { at: 'never', how: 'handled' } }]) expect(sousRemember(noticed, bad).active).toHaveLength(noticed.length);
  });
});

describe('connections across pages', () => {
  it('ties one ingredient to its supplier price, its usage and its dish, without adding the figures', () => {
    const d = deriveRoom(SEED, 'oakland');
    const [l] = sousLinks(d);
    expect(l).toMatchObject({ id: 'link:salmon-fillet', topic: 'link', also: ['purchasing', 'stock', 'menu', 'plan'] });
    expect(l.text).toMatch(/\$873 over the invoice period \(observed\)/);
    expect(l.text).toMatch(/about \$314 since the last count \(estimated\)/);
    expect(l.text).toMatch(/Grilled Salmon/);
    expect(l.text).not.toMatch(/\$1,187/); // 873 + 314 is never shown: different certainty
    expect(sousLinks(d).length).toBeLessThanOrEqual(2);
  });

  it('every room’s links hold only figures from that room, and each agent in the chain sees the link', () => {
    for (const roomId of Object.keys(SEED.rooms)) {
      const d = deriveRoom(SEED, roomId);
      const noticed = sousNoticed(d);
      const facts = sousFacts(d, { noticed });
      for (const l of sousLinks(d)) {
        expect(numbersOk(l.text, JSON.stringify([d.inv.invoices, d.usage.flagged, d.menu.menu, d.plan.sorted.map((c) => c.title), d.tokens]).replace(/(\d+\.\d)\d+/g, '$1') + sousSheet(facts.filter((f) => f.topic !== 'link')) + l.text.match(/\d+(\.\d+)?%/g).join(' '))).toBe(true);
        for (const page of l.also.map((t) => ({ purchasing: 'purchasing', stock: 'inventory', menu: 'menu', plan: 'plan' })[t])) expect(agentRead(page, facts, noticed).link?.id, `${roomId}/${page}`).toBeTruthy();
      }
    }
  });

  it('a "why" question in any linked area is answered with the connection first', () => {
    const d = deriveRoom(SEED, 'oakland');
    const facts = sousFacts(d, { noticed: sousNoticed(d) });
    expect(agentAnswer('menu', 'Why is food cost up?', facts).used[0]).toBe('link:salmon-fillet');
  });
});

describe('track record', () => {
  it('counts verified changes at their bookable rate, by the area that earned them', () => {
    for (const roomId of Object.keys(SEED.rooms)) {
      const d = deriveRoom(SEED, roomId);
      const r = agentRecord(d);
      expect(r.all.wins).toBe(d.banked.live.length);
      expect(Math.round(r.all.week)).toBe(Math.round(d.banked.week));
      const parts = Object.entries(r).filter(([k]) => k !== 'all').map(([, v]) => v);
      expect(parts.reduce((s, v) => s + v.wins, 0)).toBe(r.all.wins);
      expect(parts.reduce((s, v) => s + v.testing, 0)).toBe(r.all.testing);
    }
  });

  it('a change of what an agent says changes its fingerprint, and nothing else does', () => {
    const d = deriveRoom(SEED, 'oakland');
    const noticed = sousNoticed(d);
    const facts = sousFacts(d, { noticed });
    const moves = sousMoves(d, { noticed });
    const a = agentRead('purchasing', facts, noticed, { moves }).sig;
    expect(agentRead('purchasing', facts, noticed, { moves }).sig).toBe(a);
    expect(agentRead('purchasing', facts, noticed.filter((n) => n.id !== 'vendor:price'), { moves: moves.filter((m) => m.noticedId !== 'vendor:price') }).sig).not.toBe(a);
    expect(moveFor({ id: 'x', page: 'x', topics: ['nope'] }, moves)).toBeNull();
  });
});
