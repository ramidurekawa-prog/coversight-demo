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
