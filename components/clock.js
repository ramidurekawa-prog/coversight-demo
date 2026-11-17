'use client';

import * as React from 'react';

import { NOW } from '../lib/data/seed.js';

/*
 * One clock for every date and time on screen, so the top bar and the page
 * always agree and both keep running. A room on its own data reads the real
 * time in the room's time zone. The sample restaurant runs a demo clock: it
 * starts at the sample's moment (Tuesday, Oct 27, 7:15 pm) and moves forward
 * in real time from when the page opened, so deadlines count down while the
 * sample's figures stay as of 7:15 pm.
 */

const OPENED = typeof performance !== 'undefined' ? Date.now() : 0;
// The sample's moment, as a wall-clock instant in UTC fields (no zone maths needed).
const SAMPLE_START = (() => {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(NOW.time);
  const h = m ? (+m[1] % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0) : 19;
  return Date.parse(`${NOW.iso}T${String(h).padStart(2, '0')}:${m ? m[2] : '15'}:00Z`);
})();

let tick = 0;
const subs = new Set();
let timer = null;
function subscribe(fn) {
  subs.add(fn);
  if (!timer) {
    // Re-render when either clock turns over a minute: the real one (own rooms) or the
    // sample's, which counts from when the page opened. Checked every 5 s.
    const key = () => `${Math.floor(Date.now() / 60_000)}:${Math.floor((Date.now() - OPENED) / 60_000)}`;
    let last = key();
    timer = setInterval(() => {
      const k = key();
      if (k !== last) { last = k; tick++; subs.forEach((f) => f()); }
    }, 5_000);
  }
  return () => { subs.delete(fn); if (!subs.size) { clearInterval(timer); timer = null; } };
}
const snap = () => tick;
const serverSnap = () => 0;

const fmt = (ms, tz) => {
  const d = new Date(ms);
  const opts = { timeZone: tz };
  return {
    label: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', ...opts }),
    short: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', ...opts }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...opts }).toLowerCase(),
    iso: d.toLocaleDateString('en-CA', opts),
  };
};

/**
 * The current moment for a room: { label, short, time, iso, sample }.
 * @param {{ own: boolean, tz?: string }} room
 */
export function useClock({ own, tz = 'America/Los_Angeles' }) {
  const t = React.useSyncExternalStore(subscribe, snap, serverSnap);
  return React.useMemo(() => {
    if (own) return { ...fmt(Date.now(), tz), sample: false };
    // First render (and the server) show the sample's own moment, so hydration matches.
    const elapsed = t === 0 ? 0 : Math.max(0, Date.now() - OPENED);
    return { ...fmt(SAMPLE_START + elapsed, 'UTC'), sample: true };
  }, [own, tz, t]);
}
