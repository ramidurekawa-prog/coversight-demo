'use client';

import * as React from 'react';

/* Today's layout preferences: which three numbers sit in the tiles, and
 * which optional extras show below the main flow. A per-viewer convenience
 * kept in this browser (it never changes a figure or a decision). Each role
 * starts from its own default; "Restore defaults" goes back to it. The
 * status, the action and the progress line always show. */

/** The numbers the three tiles can show. */
export const METRICS = {
  tonight: 'Tonight',
  sales: 'Sales',
  labor: 'Labor',
  covers: 'Covers',
};
/** Optional extras, below the main flow and off by default. */
export const WIDGETS = {
  last: { label: 'Last service chart' },
  locations: { label: 'All your locations' },
};
export const MAX_METRICS = 3;

/** Each role's starting layout: three tiles, no extras. */
export const PRESETS = {
  owner: { metrics: ['sales', 'labor', 'tonight'], widgets: [] },
  gm: { metrics: ['tonight', 'labor', 'sales'], widgets: [] },
};
export const presetFor = (role) => PRESETS[role] || PRESETS.owner;

const KEY = (role) => `cv-today-layout-v2:${role in PRESETS ? role : 'owner'}`;
const clean = (v, role) => {
  const base = presetFor(role);
  if (!v || typeof v !== 'object') return base;
  const metrics = Array.isArray(v.metrics) ? v.metrics.filter((m) => m in METRICS).slice(0, MAX_METRICS) : base.metrics;
  const widgets = Array.isArray(v.widgets) ? v.widgets.filter((w) => w in WIDGETS) : base.widgets;
  return { metrics: metrics.length ? metrics : base.metrics, widgets };
};

/** The layout for a role, and setters that keep it in this browser. */
export function useLayout(role) {
  const [layout, setLayout] = React.useState(() => presetFor(role));
  const [custom, setCustom] = React.useState(false);
  React.useEffect(() => {
    let v = null;
    try { v = JSON.parse(window.localStorage.getItem(KEY(role)) || 'null'); } catch { /* storage blocked: defaults */ }
    setLayout(clean(v, role));
    setCustom(!!v);
  }, [role]);
  const save = React.useCallback((next) => {
    const v = clean(next, role);
    setLayout(v);
    setCustom(true);
    try { window.localStorage.setItem(KEY(role), JSON.stringify(v)); } catch { /* kept for this visit only */ }
  }, [role]);
  const restore = React.useCallback(() => {
    setLayout(presetFor(role));
    setCustom(false);
    try { window.localStorage.removeItem(KEY(role)); } catch { /* nothing stored */ }
  }, [role]);
  return { layout, custom, save, restore };
}

/**
 * Demo scenarios, for showing and testing the page (shown only with
 * ?tools=1). Rooms are real switches; the others change this view only and
 * say so on a banner. Nothing is saved or sent.
 */
export const SCENARIOS = [
  { id: 'live', label: 'As it is' },
  { id: 'healthy', label: 'Healthy day', note: 'Every card and the live service read are hidden in this view, as if the day were clear. Nothing was saved.' },
  { id: 'laborDown', label: 'Labor feed down', note: '7shifts is shown as not updating. Labor figures and labor advice hold back. Nothing was changed in 7shifts.' },
  { id: 'noHistory', label: 'New restaurant', note: 'Shown as if there were no history yet: comparisons wait for a baseline.' },
];

/**
 * The room's derived data and cards as one scenario sees them. Live returns
 * them unchanged.
 */
export function applyScenario(id, d, cards) {
  if (id === 'healthy') {
    return { d: { ...d, feeds: d.feeds.map((f) => (f.state === 'stale' ? { ...f, state: 'healthy' } : f)), room: { ...d.room, service: null } }, cards: [], scenario: id };
  }
  if (id === 'laborDown') {
    const feeds = d.feeds.map((f) => (f.name === '7shifts' ? { ...f, state: 'stale', last: 'not updating' } : f));
    const laborish = (c) => c.task?.system === '7shifts' || /^staff:/.test(c.when || '') || c.id === 'cut';
    const out = cards.map((c) => (laborish(c) && !c.blocked ? { ...c, blocked: 'Waiting on 7shifts: labor advice holds back until schedules and clock-ins update.', blockedNeeds: 'data' } : c));
    return { d: { ...d, feeds, staleCount: feeds.filter((f) => f.state === 'stale').length }, cards: out, scenario: id, laborDown: true };
  }
  if (id === 'noHistory') return { d, cards, scenario: id, noHistory: true };
  return { d, cards, scenario: 'live' };
}
