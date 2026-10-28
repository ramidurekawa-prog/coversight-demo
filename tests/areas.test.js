import { describe, expect, test } from 'vitest';

import { CV_APPROVALS } from '../components/screens/core.jsx';
import * as A from '../components/screens/areas.jsx';
import { CV_PAGES } from '../lib/pages.js';

/* Pins the operating-area figures (V3) and the rules behind them. */
describe('operating areas', () => {
  test('controls: one person above her p-chart limit; the room is inside its limits', () => {
    expect(A.CV_SIGNALS.map((r) => r.name)).toEqual(['Kayla P.']);
    expect(Math.round(A.CV_PV_EXCESS_28)).toBe(512);
    const last = A.CV_EXC_SERIES.at(-1);
    expect(last).toBeLessThan(A.CV_EXC_UCL);
    expect(last).toBeGreaterThan(A.CV_EXC_LCL);
  });

  test('controls: staff sales add up to four weeks of Oakland sales', () => {
    expect(A.CV_STAFF.reduce((s, r) => s + r.sales, 0)).toBe(A.CV_WEEK_SALES * 4);
  });

  test('inventory: only gaps past tolerance are counted', () => {
    expect(A.CV_USAGE.filter((r) => r.flag).map((r) => r.item)).toEqual(['Salmon fillet', 'Romaine hearts', 'House red', 'Bourbon']);
    expect(Math.round(A.CV_USAGE_WEEK)).toBe(167);
    expect(Math.round(A.CV_BAR_WEEK)).toBe(62);
  });

  test('channels: sales add up to the week and delivery keeps less than dine-in', () => {
    expect(A.CV_CHANNELS.reduce((s, c) => s + c.sales, 0)).toBe(A.CV_WEEK_SALES);
    const [dine, , dd, ue] = A.CV_CHANNELS;
    expect(dd.per100).toBeLessThan(dine.per100 * 0.65);
    expect(ue.per100).toBeLessThan(dd.per100);
    expect(Math.round(A.CV_MARKUP_LO)).toBe(-7);
    expect(Math.round(A.CV_MARKUP_HI)).toBe(258);
  });

  test('coverage: twelve areas, each pointing at a real screen or the build plan', () => {
    expect(A.CV_AREAS).toHaveLength(12);
    for (const a of A.CV_AREAS) expect(a.screen === 'build' || CV_PAGES[a.screen], a.id).toBeTruthy();
    expect(A.cvAreaFig(A.CV_AREAS.find((a) => a.id === 'menu'))).toBe('$299/wk in 3 moves');
  });

  test('approvals the new screens open are registered', () => {
    expect(CV_APPROVALS['void-reason']).toBeDefined();
    expect(CV_APPROVALS['delivery-markup'].value).toBe('−$7 to $258/wk estimated');
  });
});
