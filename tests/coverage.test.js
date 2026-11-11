import { describe, expect, it } from 'vitest';

import { coverageOf } from '../lib/data/coverage.js';
import { deriveRoom } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';

const d = deriveRoom(SEED, 'oakland');
const by = (rows) => Object.fromEntries(rows.map((a) => [a.id, a]));

describe('the coverage map, computed', () => {
  it('verify needs a verified test on that lever, not a written note', () => {
    const none = by(coverageOf(d));
    expect(none.labour.reached).not.toBe('verify');
    expect(none.labour.steps.verify.why).toMatch(/nothing verified/);
    const yes = by(coverageOf(d, { verified: ['Labour'] }));
    expect(yes.labour.reached).toBe('verify');
    expect(yes.demand.reached).not.toBe('verify'); // same dollars, counted once under Labour
  });

  it('a missing feed is unavailable, not zero', () => {
    const feeds = d.feeds.map((f) => (f.name === 'Invoices' ? { ...f, state: 'off' } : f));
    const p = by(coverageOf({ ...d, feeds }));
    expect(p.purchasing).toMatchObject({ reached: 'none', kind: 'unavailable', missing: ['Invoices'] });
    expect(p.purchasing.next).toEqual({ label: 'Connect Invoices', go: 'sources' });
    expect(p.inventory.kind).toBe('unavailable');
  });

  it('partial data flags but never acts', () => {
    const p = by(coverageOf(d));
    expect(p.inventory.steps.act.ok).toBe(false);
    expect(p.inventory.steps.act.why).toMatch(/partly in/);
    expect(p.inventory.next.label).toMatch(/Complete/);
  });

  it('levers with no weekly metric can never reach verify', () => {
    const p = by(coverageOf(d, { verified: ['Purchasing', 'Channels'] }));
    expect(p.purchasing.reached).toBe('act');
    expect(p.channels.steps.verify.why).toMatch(/can’t be verified or billed/);
  });

  it('not-built and out-of-scope areas say so', () => {
    const p = by(coverageOf(d));
    expect(p.guests.kind).toBe('unbuilt');
    expect(p.facilities.kind).toBe('out');
    expect(coverageOf(d)).toHaveLength(12);
  });
});
