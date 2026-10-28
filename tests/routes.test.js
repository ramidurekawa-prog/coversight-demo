import { describe, expect, test } from 'vitest';

import { cvPlanCandidates, CV_PROOF } from '../components/screens/core.jsx';
import { SCREENS } from '../components/screen.jsx';
import { CV_NAV, CV_PAGES, CV_ROLES, DEFAULT_IDS, FINDING_IDS, PACKET_IDS, pageFromPath, pathFor, SCREEN_PAGES } from '../lib/pages.js';

describe('routing', () => {
  test('every page has a screen component', () => {
    for (const p of Object.keys(CV_PAGES)) expect(SCREENS[p], p).toBeTypeOf('function');
  });

  test('pre-rendered ids match the screens’ own data', () => {
    expect([...PACKET_IDS].sort()).toEqual(CV_PROOF.map((r) => r.id).sort());
    expect(FINDING_IDS).toEqual(expect.arrayContaining(cvPlanCandidates().map((c) => c.id)));
    expect(new Set(FINDING_IDS).size).toBe(FINDING_IDS.length);
    expect(FINDING_IDS.length).toBe(32); // 30 sample findings + 2 own-dish price moves created by inputs
    expect(PACKET_IDS).toContain(DEFAULT_IDS.packet);
    expect(FINDING_IDS).toContain(DEFAULT_IDS.finding);
  });

  test('pathFor and pageFromPath round-trip, with or without a trailing slash', () => {
    for (const p of [...SCREEN_PAGES, 'week']) {
      expect(pageFromPath(pathFor(p)).page).toBe(p);
      expect(pageFromPath(`${pathFor(p)}/`).page).toBe(p);
    }
    expect(pageFromPath('/packet/wc-close/')).toEqual({ page: 'packet', id: 'wc-close' });
    expect(pageFromPath('/build/').page).toBe('build');
    expect(pageFromPath('/nope').page).toBe('week');
  });

  test('nav and role homes point at real, visible pages', () => {
    for (const g of CV_NAV) for (const id of g.items) expect(CV_PAGES[id]?.hidden, id).toBeFalsy();
    for (const r of Object.values(CV_ROLES)) {
      expect(CV_PAGES[r.home]).toBeDefined();
      if (r.nav) expect(CV_NAV.some((g) => r.nav.includes(g.label) && g.items.includes(r.home))).toBe(true);
    }
  });
});
