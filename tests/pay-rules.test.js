import { describe, expect, it } from 'vitest';

import { payRuleCheck } from '../lib/ai/playbook.js';

describe('pay rules on a schedule change', () => {
  it('lists the rules from the room’s own state and city tables', () => {
    const oak = payRuleCheck({ state: 'CA', city: 'Oakland' }, { sameDay: true });
    expect(oak.known).toBe(true);
    expect(oak.where).toBe('Oakland, California');
    expect(oak.rules.map((r) => r.id)).toEqual(['reporting', 'split', 'breaks', 'overtime']);
    expect(oak.caveat).toMatch(/Confirm with your payroll provider/);
    expect(payRuleCheck({ state: 'CA', city: 'Berkeley' }).rules.map((r) => r.id)).toEqual(['fair-workweek', 'split', 'breaks', 'overtime']);
  });

  it('states no rule for a place with no table', () => {
    const tx = payRuleCheck({ state: 'TX', city: 'Austin' }, { sameDay: true });
    expect(tx).toMatchObject({ known: false, rules: [] });
    expect(tx.caveat).toMatch(/no pay-rule table/);
  });
});
