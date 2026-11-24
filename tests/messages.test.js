// What Coversight sends: every message is written from the room's own
// records and keeps their claims; only a verified Proof is savings.
import { describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { deriveRoom } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';
import { covercastRoom } from '../lib/data/forecast/index.js';
import { dayLoop } from '../lib/ai/loop.js';
import { foodCostChecks } from '../lib/data/page/purchasing.js';
import { TEXT_MAX, firstWeek, itWorked, morningText, orderGuide, prepList } from '../lib/data/page/messages.js';

const ds = applyInputs(SEED, {});
const at = (id) => {
  const d = deriveRoom(ds, id);
  const cc = covercastRoom(ds.rooms[id], { accuracy: false });
  return { d, cc, L: dayLoop(d, { cc }) };
};

describe('the GM morning text', () => {
  it('fits one text and reads last night, today and the top ask from the records', () => {
    const { d, L } = at('oakland');
    const t = morningText(d, L);
    expect(t.text.length).toBeLessThanOrEqual(TEXT_MAX);
    expect(t.text).toMatch(/^Morning Marcus\./);
    expect(t.text).toContain(`${L.night.covers} guests`);
    expect(t.text).toContain(`about ${L.plan.covers} guests (${L.plan.low} to ${L.plan.high})`);
    const ask = foodCostChecks(d.room).find((c) => c.approvalId);
    expect(t.text).toContain(`ask ${ask.vendor}`);
  });

  it('drops lines from the end, never the greeting, when it runs long', () => {
    const { d, L } = at('oakland');
    const t = morningText(d, L, { link: 'x'.repeat(200) });
    expect(t.text.startsWith('Morning Marcus.')).toBe(true);
    expect(t.parts).toBeLessThan(morningText(d, L).parts);
  });

  it('says nothing about a night or a forecast it does not have', () => {
    const { d } = at('oakland');
    expect(morningText(d, { night: null, plan: null }, { checks: [] }).text).toBe('Morning Marcus. More: coversight');
  });
});

describe('the "it worked" note', () => {
  it('goes only with a verified packet, at its bookable rate', () => {
    const { d } = at('oakland');
    const v = d.proofs.find((p) => p.outcome === 'verified');
    const n = itWorked(v, { room: 'Rosewood Oakland' });
    expect(n).toMatchObject({ claim: 'book', cents: v.bookable * 100 });
    expect(n.body).toContain(`$${v.bookable} a week`);
    expect(n.body).not.toContain(`$${v.point} a week`);
    expect(itWorked(d.proofs.find((p) => p.outcome === 'testing'))).toBeNull();
  });
});

describe('the chef’s prep list and order guide', () => {
  it('prep is Covercast’s own plan for the next day', () => {
    const { cc } = at('oakland');
    const p = prepList(cc);
    expect(p).toMatchObject({ ready: true, iso: cc.covers.days[0].iso, guests: cc.covers.days[0].value, claim: 'mod' });
    expect(p.rows[0]).toMatchObject({ item: cc.prep[0].item, prep: cc.prep[0].prep });
    expect(prepList({ ready: false, why: 'No days on file yet.' })).toMatchObject({ ready: false, why: 'No days on file yet.' });
  });

  it('orders what the next days use from the recipes, less what the last count had, priced from the invoice', () => {
    const { cc } = at('oakland');
    const g = orderGuide(ds.rooms.oakland, ds.recipes, cc, { days: 3 });
    expect(g.ready).toBe(true);
    expect(g.guests).toBe(cc.covers.days.slice(0, 3).reduce((t, x) => t + x.value, 0));
    const salmon = g.rows.find((r) => r.item === 'Salmon fillet');
    expect(salmon.vendor).toBe('Bay Fish Co.');
    expect(salmon.order).toBe(Math.max(0, Math.ceil(salmon.need - (salmon.have ?? 0))));
    expect(salmon.ask).toMatch(/Ask about the price first/);
    expect(g.cents).toBe(g.rows.reduce((t, r) => t + (r.cents ?? 0), 0));
    for (const rows of Object.values(g.byVendor)) expect(rows.every((r) => r.order > 0)).toBe(true);
  });
});

describe('the first-week report', () => {
  it('reports found money with its claim and counts only verified packets as savings', () => {
    const { d, L } = at('oakland');
    const r = firstWeek(d, L);
    const leak = foodCostChecks(d.room).reduce((t, c) => t + (c.cents ?? 0), 0);
    expect(r.found.find((f) => f.key === 'invoices')).toMatchObject({ claim: 'obs', cents: leak });
    expect(r.found.find((f) => f.key === 'staffing')?.claim).toBe('mod');
    expect(r.verifiedWeekly).toBe(d.proofs.filter((p) => p.outcome === 'verified').reduce((t, p) => t + p.bookable, 0));
    expect(r.testing.every((t) => t.claim === 'mod')).toBe(true);
    expect(r.found.map((f) => f.text).join(' ')).not.toMatch(/\.\./);
  });
});
