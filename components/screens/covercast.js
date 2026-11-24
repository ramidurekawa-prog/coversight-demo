'use client';

import * as React from 'react';

import { covercastRoom } from '../../lib/data/forecast/index.js';

/**
 * Covercast for a room, shared by Service and Today so both pages pace from
 * the same forecast: from the server when there is one (the same call the
 * server's checks use), else computed here from the room's data. Null until
 * it's ready, or when there isn't enough history (or `enabled` is false).
 */
/* One forecast per room per data load, shared across pages, so going from
 * Today to Service doesn't compute it twice. Keyed by the room object, which
 * changes whenever the room's data does. */
const LOCAL = new WeakMap();
function localFor(room) {
  if (!room) return null;
  if (LOCAL.has(room)) return LOCAL.get(room);
  let f = null;
  try { const r = covercastRoom(room, { accuracy: false }); f = r.ready ? r : null; } catch { f = null; }
  LOCAL.set(room, f);
  return f;
}

/**
 * Covercast and whether it is still being worked out. The local forecast takes
 * a few hundred milliseconds, so it runs after the page has painted: the page
 * shows at once and fills its forecast in, instead of a blank screen.
 */
export function useCovercastState(room, roomId, useServer, enabled = true) {
  const [srv, setSrv] = React.useState(/** @type {any} */ (undefined));
  React.useEffect(() => {
    if (!useServer || !enabled) return undefined;
    let stop = false;
    setSrv(undefined);
    fetch(`/api/forecast?room=${encodeURIComponent(roomId)}&days=14`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => { if (!stop) setSrv(b.forecast?.ready ? b.forecast : false); })
      .catch(() => { if (!stop) setSrv(false); });
    return () => { stop = true; };
  }, [roomId, useServer, enabled]);
  const cached = !useServer && enabled && room && LOCAL.has(room) ? LOCAL.get(room) : undefined;
  const [local, setLocal] = React.useState(/** @type {any} */ (cached));
  React.useEffect(() => {
    if (useServer || !enabled) { setLocal(null); return undefined; }
    if (room && LOCAL.has(room)) { setLocal(LOCAL.get(room)); return undefined; }
    setLocal(undefined);
    let stop = false;
    // Two frames: let the browser paint the page first, then do the work.
    const raf = requestAnimationFrame(() => setTimeout(() => { if (!stop) setLocal(localFor(room)); }, 0));
    return () => { stop = true; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, useServer, enabled, room]);
  if (!enabled) return { cc: null, pending: false };
  const v = useServer ? srv : local;
  return { cc: v || null, pending: v === undefined };
}

/**
 * Covercast for a room, shared by Service and Today so both pages pace from
 * the same forecast: from the server when there is one (the same call the
 * server's checks use), else computed here from the room's data. Null until
 * it's ready, or when there isn't enough history (or `enabled` is false).
 */
export function useCovercast(room, roomId, useServer, enabled = true) {
  return useCovercastState(room, roomId, useServer, enabled).cc;
}
