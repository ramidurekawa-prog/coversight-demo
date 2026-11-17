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

/** @typedef {{ bg: string, surface: string, muted: string, text: string, text2: string, text3?: string, border: string, borderStrong: string,
 *   cta: string, ctaHover: string, ctaActive: string, ctaText: string, accent: string, accentText: string, accentSubtle: string,
 *   good?: string, bad?: string, caution?: string, side?: string }} Palette */

/**
 * Persimmon & Ink is the chosen look (Ramidu, 2026-11-16) and Today's default.
 * The other two stay for comparison behind ?tools=1.
 * @type {Record<string, { label: string, note: string, p: Palette }>}
 */
export const THEMES = {
  persimmon: {
    label: 'Persimmon',
    note: 'Persimmon & Ink: warm cream, rich navy and a persimmon action color',
    p: {
      bg: '#F8F6F0', surface: '#FFFFFF', muted: '#F2EEE6', text: '#172536', text2: '#536477', text3: '#66717C', border: '#E4E3DF', borderStrong: '#D3D0C8',
      cta: '#FF8050', ctaHover: '#FF6D39', ctaActive: '#F25E28', ctaText: '#172536', accent: '#FF8050', accentText: '#172536', accentSubtle: '#FFEEE6',
      good: '#23846A', bad: '#C64C50', caution: '#B97923', side: '#142131',
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

export const DEFAULT_THEME = 'persimmon';

/**
 * The semantic tokens, then the app tokens they drive. In dark mode only the
 * action color and the status colors change, so a dark page stays dark.
 */
export function tokensFor(id, { dark = false } = {}) {
  const t = THEMES[id];
  if (!t) return null;
  const { p } = t;
  const semantic = {
    ...(p.good ? { '--success-600': p.good, '--success-700': p.good } : {}),
    ...(p.bad ? { '--error-600': p.bad } : {}),
    ...(p.caution ? { '--warning-500': p.caution, '--warning-600': p.caution, '--warning-700': p.caution } : {}),
  };
  const action = {
    '--cv-primary-cta': p.cta, '--cv-primary-cta-text': p.ctaText,
    '--primary': 'var(--cv-primary-cta)', '--primary-hover': p.ctaHover, '--primary-active': p.ctaActive, '--primary-fg': 'var(--cv-primary-cta-text)', '--fg-on-accent': p.ctaText,
    '--cv-accent': p.accent, '--accent': 'var(--cv-accent)',
    ...(p.side ? { '--side-active-fg': '#F6F1E7', '--cv-side-mark': p.cta } : {}),
  };
  if (dark) return { ...action, ...(p.bad ? { '--error-600': p.bad } : {}) };
  return {
    '--cv-bg': p.bg, '--cv-surface': p.surface, '--cv-surface-muted': p.muted, '--cv-text': p.text, '--cv-text-secondary': p.text2,
    '--cv-border': p.border, '--cv-accent-subtle': p.accentSubtle,
    '--background': 'var(--cv-bg)', '--surface': 'var(--cv-surface)', '--surface-sunken': 'var(--cv-surface-muted)', '--surface-hover': p.muted,
    '--fg-1': 'var(--cv-text)', '--fg-2': 'var(--cv-text-secondary)', '--fg-3': p.text3 || p.text2,
    '--border': 'var(--cv-border)', '--border-strong': p.borderStrong, '--border-focus': p.accentText,
    '--accent-subtle': 'var(--cv-accent-subtle)', '--teal-700': p.accentText,
    '--ring': `0 0 0 3px ${hexA(p.cta, 0.4)}`,
    ...(p.side ? { '--side-bg': p.side, '--side-active': 'rgba(255, 255, 255, 0.07)', '--side-line': 'rgba(255, 255, 255, 0.07)', '--side-mute': '#7F8A98' } : {}),
    ...action,
    ...semantic,
  };
}

const KEY = 'cv-today-theme';
const read = () => { try { const v = window.localStorage.getItem(KEY); return v === 'original' || THEMES[v] ? v : DEFAULT_THEME; } catch { return DEFAULT_THEME; } };

/** Whether the app is showing its dark mode right now. */
const isDark = () => {
  const set = document.documentElement.dataset.theme;
  if (set) return set === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
};

/**
 * Today's palette, applied while Today is mounted and removed when it isn't.
 * Persimmon by default. A different choice is only possible, and only kept,
 * with the design tools on (?tools=1).
 */
export function useTodayTheme(tools = false) {
  const [theme, setTheme] = React.useState(DEFAULT_THEME);
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => { setTheme(tools ? read() : DEFAULT_THEME); }, [tools]);
  React.useEffect(() => {
    const check = () => setDark(isDark());
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', check);
    return () => { mo.disconnect(); mq?.removeEventListener?.('change', check); };
  }, []);
  React.useEffect(() => {
    const el = document.documentElement;
    const tokens = tokensFor(theme, { dark });
    if (!tokens) { delete el.dataset.todayTheme; return undefined; }
    el.dataset.todayTheme = theme;
    for (const [k, v] of Object.entries(tokens)) el.style.setProperty(k, v);
    return () => {
      for (const k of Object.keys(tokens)) el.style.removeProperty(k);
      delete el.dataset.todayTheme;
    };
  }, [theme, dark]);
  const pick = React.useCallback((id) => {
    const next = THEMES[id] ? id : 'original';
    setTheme(next);
    try { window.localStorage.setItem(KEY, next); } catch { /* not saved; still applied */ }
  }, []);
  return { theme, pick };
}

/*
 * Font trial (Ramidu, 2026-11-17): a few typefaces to compare on the real
 * page, behind ?tools=1 like the colors. IBM Plex is the current type and
 * stays the default until Ramidu picks. Each option sets the text font and
 * the figures font; figures always use tabular digits so columns line up.
 * Applied while Today is on screen (the top bar included).
 */
const stack = (f) => `'${f}', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
export const FONTS = {
  plex: { label: 'IBM Plex', note: 'Current. Engineered and precise; figures in Plex Mono', sans: null, figs: null },
  jakarta: { label: 'Plus Jakarta Sans', note: 'Warm and modern, soft geometric shapes', sans: stack('Plus Jakarta Sans'), figs: stack('Plus Jakarta Sans') },
  inter: { label: 'Inter', note: 'Neutral and very legible at small sizes', sans: stack('Inter'), figs: stack('Inter') },
  manrope: { label: 'Manrope', note: 'Premium, open and rounded; strong big numbers', sans: stack('Manrope'), figs: stack('Manrope') },
  dmsans: { label: 'DM Sans', note: 'Friendly and compact, like a good menu', sans: stack('DM Sans'), figs: stack('DM Sans') },
};
export const DEFAULT_FONT = 'plex';
const FONT_KEY = 'cv-today-font';

/** Today's font trial: the current type unless a different one is picked with the tools on. */
export function useTodayFont(tools = false) {
  const [font, setFont] = React.useState(DEFAULT_FONT);
  React.useEffect(() => {
    let v = DEFAULT_FONT;
    if (tools) { try { const x = window.localStorage.getItem(FONT_KEY); if (x && FONTS[x]) v = x; } catch { /* default */ } }
    setFont(v);
  }, [tools]);
  React.useEffect(() => {
    const f = FONTS[font];
    const el = document.documentElement;
    if (!f?.sans) return undefined;
    el.style.setProperty('--font-sans', f.sans);
    el.style.setProperty('--font-wordmark', f.sans);
    el.style.setProperty('--font-mono', f.figs);
    return () => { ['--font-sans', '--font-wordmark', '--font-mono'].forEach((k) => el.style.removeProperty(k)); };
  }, [font]);
  const pick = React.useCallback((id) => {
    const next = FONTS[id] ? id : DEFAULT_FONT;
    setFont(next);
    try { window.localStorage.setItem(FONT_KEY, next); } catch { /* applied, not kept */ }
  }, []);
  return { font, pick };
}
