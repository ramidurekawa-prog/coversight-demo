'use client';

import * as React from 'react';

/* Today's color trial: three palettes Ramidu is comparing, applied to the
 * Today page only. One source: each palette is a few semantic --cv-* tokens,
 * mapped onto the app's own tokens (so kit buttons, chips and the header
 * follow). Applied as inline custom properties on <html> while Today is on
 * screen, and removed when it isn't, so other pages keep the current look.
 * Status colours (confirmed, warning, error, delayed) are never themed. */

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** @typedef {{ bg: string, surface: string, muted: string, text: string, text2: string, border: string, borderStrong: string,
 *   cta: string, ctaHover: string, ctaActive: string, ctaText: string, accent: string, accentText: string, accentSubtle: string }} Palette */

/** @type {Record<string, { label: string, note: string, p: Palette }>} */
export const THEMES = {
  persimmon: {
    label: 'Persimmon',
    note: 'Persimmon & Ink: warm, confident hospitality tech',
    p: {
      bg: '#F7F6F2', surface: '#FFFFFF', muted: '#F1F0EA', text: '#192431', text2: '#6B7480', border: '#E5E3DB', borderStrong: '#D4D1C6',
      cta: '#FF8050', ctaHover: '#FF6C38', ctaActive: '#F25C26', ctaText: '#192431', accent: '#FF8050', accentText: '#29745E', accentSubtle: '#FFEDE4',
    },
  },
  saffron: {
    label: 'Saffron',
    note: 'Saffron & Espresso: an elegant bistro, warm and timeless',
    p: {
      bg: '#F8F5EE', surface: '#FFFFFF', muted: '#F1EBE0', text: '#292723', text2: '#746F69', border: '#E8E1D3', borderStrong: '#D8CDB9',
      cta: '#FFC04E', ctaHover: '#F7AF2E', ctaActive: '#E99F1B', ctaText: '#292723', accent: '#8A5547', accentText: '#8A5547', accentSubtle: '#F5EAE4',
    },
  },
  citrus: {
    label: 'Citrus',
    note: 'Citrus & Basil: fresh and technology-forward',
    p: {
      bg: '#F6F8F3', surface: '#FFFFFF', muted: '#EAF0E8', text: '#1D302A', text2: '#63736B', border: '#DEE6DB', borderStrong: '#CAD6C6',
      cta: '#D9F66B', ctaHover: '#CDEE52', ctaActive: '#BFE13C', ctaText: '#1D302A', accent: '#2E745D', accentText: '#2E745D', accentSubtle: '#E3F0EA',
    },
  },
};

/** The semantic tokens, then the app tokens they drive. */
export function tokensFor(id) {
  const t = THEMES[id];
  if (!t) return null;
  const { p } = t;
  return {
    '--cv-bg': p.bg, '--cv-surface': p.surface, '--cv-surface-muted': p.muted, '--cv-text': p.text, '--cv-text-secondary': p.text2,
    '--cv-border': p.border, '--cv-primary-cta': p.cta, '--cv-primary-cta-text': p.ctaText, '--cv-accent': p.accent, '--cv-accent-subtle': p.accentSubtle,
    '--background': 'var(--cv-bg)', '--surface': 'var(--cv-surface)', '--surface-sunken': 'var(--cv-surface-muted)', '--surface-hover': p.muted,
    '--fg-1': 'var(--cv-text)', '--fg-2': 'var(--cv-text-secondary)', '--fg-3': p.text2,
    '--border': 'var(--cv-border)', '--border-strong': p.borderStrong, '--border-focus': p.accentText,
    '--primary': 'var(--cv-primary-cta)', '--primary-hover': p.ctaHover, '--primary-active': p.ctaActive, '--primary-fg': 'var(--cv-primary-cta-text)', '--fg-on-accent': p.ctaText,
    '--accent': 'var(--cv-accent)', '--accent-subtle': 'var(--cv-accent-subtle)', '--teal-700': p.accentText,
    '--ring': `0 0 0 3px ${hexA(p.accentText, 0.32)}`,
  };
}

const KEY = 'cv-today-theme';
const read = () => { try { const v = window.localStorage.getItem(KEY); return THEMES[v] ? v : 'original'; } catch { return 'original'; } };

/** The chosen palette, saved in this browser, applied while Today is mounted. */
export function useTodayTheme() {
  const [theme, setTheme] = React.useState('original');
  React.useEffect(() => { setTheme(read()); }, []);
  React.useEffect(() => {
    const el = document.documentElement;
    const tokens = tokensFor(theme);
    if (!tokens) { delete el.dataset.todayTheme; return undefined; }
    el.dataset.todayTheme = theme;
    for (const [k, v] of Object.entries(tokens)) el.style.setProperty(k, v);
    el.style.setProperty('color-scheme', 'light'); // the trial palettes are light ones
    return () => {
      el.style.removeProperty('color-scheme');
      for (const k of Object.keys(tokens)) el.style.removeProperty(k);
      delete el.dataset.todayTheme;
    };
  }, [theme]);
  const pick = React.useCallback((id) => {
    const next = THEMES[id] ? id : 'original';
    setTheme(next);
    try { if (next === 'original') window.localStorage.removeItem(KEY); else window.localStorage.setItem(KEY, next); } catch { /* not saved; still applied */ }
  }, []);
  return { theme, pick };
}
