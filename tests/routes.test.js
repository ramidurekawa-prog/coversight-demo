import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import { cvPlanCandidates, CV_PROOF } from '../components/screens/core.jsx';
import { SCREENS } from '../components/screen.jsx';
import { CV_NAV, CV_PAGES, CV_ROLES, CV_SETTINGS, CV_TABS, DEFAULT_IDS, familyOf, FINDING_IDS, PACKET_IDS, pageFromPath, pathFor, SCREEN_PAGES } from '../lib/pages.js';

describe('routing', () => {
  test('every page has a screen component', () => {
    for (const p of Object.keys(CV_PAGES)) expect(SCREENS[p], p).toBeTypeOf('function');
  });

  test('every page lives in its own file, so page work never shares a file', () => {
    const map = readFileSync('components/screen.jsx', 'utf8');
    for (const p of Object.keys(CV_PAGES)) {
      expect(existsSync(`components/screens/pages/${p}.jsx`), p).toBe(true);
      expect(map, p).toContain(`from './screens/pages/${p}';`);
    }
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

  test('every visible page has exactly one home: the sidebar, a tab or Settings', () => {
    const nav = CV_NAV.flatMap((g) => g.items);
    const tabs = Object.values(CV_TABS).flatMap((t) => t.map(([id]) => id));
    expect(new Set(nav).size).toBe(nav.length);
    expect(new Set(tabs).size).toBe(tabs.length);
    for (const [parent, list] of Object.entries(CV_TABS)) {
      expect(list[0][0], parent).toBe(parent); // the sidebar entry opens the first tab
      expect(nav.includes(parent) || parent === CV_SETTINGS, parent).toBe(true);
      for (const [id] of list) expect(CV_PAGES[id]?.hidden, id).toBe(undefined);
    }
    for (const g of CV_NAV) for (const id of Object.keys(g.sections || {})) expect(g.items, id).toContain(id);
    const placed = new Set([...nav, ...tabs]);
    for (const [id, p] of Object.entries(CV_PAGES)) {
      if (p.hidden || id === 'connect') continue; // id screens and Connect your POS open from inside a tab
      expect(placed.has(id), id).toBe(true);
    }
    expect(familyOf('plan')).toMatchObject({ parent: 'week', tab: 'plan' });
    expect(familyOf('finding')).toMatchObject({ parent: 'week', tab: 'plan' });
    expect(familyOf('connect')).toMatchObject({ parent: 'inputs', tab: 'sources' });
    expect(familyOf('today').tabs).toBeNull();
  });

  test('nav and role homes point at real, visible pages', () => {
    for (const g of CV_NAV) for (const id of g.items) expect(CV_PAGES[id]?.hidden, id).toBeFalsy();
    for (const r of Object.values(CV_ROLES)) {
      expect(CV_PAGES[r.home]).toBeDefined();
      if (r.nav) expect(CV_NAV.some((g) => r.nav.includes(g.label) && g.items.includes(r.home))).toBe(true);
      expect(r.hide).not.toContain(r.home);
    }
  });
});
