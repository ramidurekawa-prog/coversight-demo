import { describe, expect, test } from 'vitest';

import * as C from '../components/screens/core.jsx';

/* The demo's headline numbers are computed, not typed in. These pin them so a
 * data edit that silently moves a figure a VC has already seen fails loudly. */
describe('headline figures', () => {
  test('banked to date is the daily accrual times the days accruing', () => {
    expect(C.CV_DAYS_TO_DATE).toBe(127);
    expect(Math.round(C.CV_DAILY * C.CV_DAYS_TO_DATE)).toBe(1760);
  });

  test('salmon $28 → $30 is about +$146/wk for about 8 fewer plates', () => {
    expect(C.CV_SALMON_WK).toBe(146);
    expect(C.CV_SALMON_LOST).toBe(8);
    expect(C.CV_SALMON.lo).toBeLessThan(C.CV_SALMON.delta);
    expect(C.CV_SALMON.hi).toBeGreaterThan(C.CV_SALMON.delta);
  });

  test('exposure is the sum of non-prevented candidates (≈ $566/wk)', () => {
    expect(Math.round(C.CV_EXPOSURE)).toBe(566);
  });

  test('vendor price leg is $1,286', () => {
    expect(Math.round(C.CV_PRICE_LEG)).toBe(1286);
  });

  test('a 2-hour plan picks salmon, ribeye and vendor', () => {
    const { chosen, used } = C.cvChoosePlan(C.cvPlanCandidates(), 2);
    expect([...chosen].sort()).toEqual(['ribeye', 'salmon', 'vendor']);
    expect(used).toBeLessThanOrEqual(2);
  });

  test('prevented cost is never counted as exposure', () => {
    const prevented = C.cvPlanCandidates().filter((c) => c.prevent);
    expect(prevented.length).toBeGreaterThan(0);
    const all = C.cvPlanCandidates().reduce((s, c) => s + c.value, 0);
    expect(all - C.CV_EXPOSURE).toBeCloseTo(prevented.reduce((s, c) => s + c.value, 0));
  });

  test('money formatting', () => {
    expect(C.cvMoney(1760)).toBe('$1,760');
  });
});
