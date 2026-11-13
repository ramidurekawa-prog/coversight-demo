'use client';

import * as React from 'react';

import { useEngine } from '../../engine';
import { DEFAULT_TZ, localDay, queueSummary, queueView, todayCards } from '../../../lib/data/page/today';
import { CV_D } from '../core';

/* Today's counts for the sidebar badge, by the same rules as the Today page
 * (lib/data/page/today.js). The page reports the server's copy of the queue
 * here when it has one, so the badge and the page never disagree. */

const remote = new Map(); // `${roomId}` → queue view from /api/page/today
const subs = new Set();

/** Called by the Today page whenever it has the server's view of the queue. */
export function reportTodayView(roomId, view) {
  remote.set(roomId, view);
  subs.forEach((f) => f());
}

/** Today's counts for the room in view: { total, ready, blocked, handled, ... }. */
export function useTodayCounts() {
  const eng = useEngine();
  const [, bump] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => { subs.add(bump); return () => { subs.delete(bump); }; }, []);
  const tz = CV_D.room.tz || DEFAULT_TZ;
  const today = localDay(Date.now(), tz);
  const own = !!CV_D.room.fromToast;
  const saved = eng.actions?.[CV_D.id] || {};
  const testing = (eng.windows || []).filter((w) => w.roomId === CV_D.id && (w.status === 'running' || w.status === 'waiting')).map((w) => w.lever);
  const cards = todayCards(CV_D, { today, testing, dismissed: saved.findings || {}, tasks: (eng.tasks || []).filter((t) => t.roomId === CV_D.id) });
  const view = remote.get(CV_D.id) || queueView(saved.queue || null, { today, own, tz, cards });
  return queueSummary(cards, view);
}
