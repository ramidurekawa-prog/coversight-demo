import { describe, expect, test } from 'vitest';

import * as C from '../components/screens/core.jsx';

/* Oakland's headline numbers, read through the screens' own module. These
 * are the figures a VC has already seen; a data edit that moves one fails
 * here first. */
describe('Oakland headline figures', () => {
  test('banked: $97 this week, $1,760 to date, 1.2× September', () => {
    expect(C.CV_D.banked.week).toBe(97);
    expect(Math.round(C.CV_D.banked.toDate)).toBe(1760);
    expect(Math.round(C.CV_D.banked.sept)).toBe(416);
    expect(C.CV_D.banked.coverage.toFixed(1)).toBe('1.2');
  });

  test('earned is net − food − labour, all sums of rows: $18,940', () => {
    const w = C.CV_D.week;
    expect(Math.round(w.net)).toBe(41620);
    expect(Math.round(w.food)).toBe(12130);
    expect(Math.round(w.labour)).toBe(10550);
    expect(Math.round(w.earned)).toBe(18940);
  });

  test('margin vs matched weeks: +$410, $97 of it claimed', () => {
    expect(Math.round(C.CV_D.hist.marginMove)).toBe(410);
    expect(C.CV_D.claimable).toBe(97);
  });

  test('salmon $28 → $30 is about +$146/wk for about 8 fewer plates', () => {
    expect(C.CV_SALMON_WK).toBe(146);
    expect(C.CV_SALMON_LOST).toBe(8);
  });

  test('a 2-hour plan picks salmon, ribeye and vendor', () => {
    const { chosen, used } = C.cvChoosePlan(C.cvPlanCandidates(), 2);
    expect([...chosen].sort()).toEqual(['ribeye', 'salmon', 'vendor']);
    expect(used).toBeLessThanOrEqual(2);
  });

  test('exposure sums non-prevented candidates (12 candidates, $924/wk)', () => {
    expect(C.cvPlanCandidates()).toHaveLength(12);
    expect(Math.round(C.CV_EXPOSURE)).toBe(924);
    const prevented = C.cvPlanCandidates().filter((c) => c.prevent);
    const all = C.cvPlanCandidates().reduce((s, c) => s + c.value, 0);
    expect(all - C.CV_EXPOSURE).toBeCloseTo(prevented.reduce((s, c) => s + c.value, 0));
  });

  test('vendor price leg over 28 invoice lines is $1,706', () => {
    expect(C.CV_INVOICES).toHaveLength(28);
    expect(Math.round(C.CV_PRICE_LEG)).toBe(1706);
  });

  test('money formatting', () => {
    expect(C.cvMoney(1760)).toBe('$1,760');
    expect(C.cvMoney(-7)).toBe('−$7');
  });
});
