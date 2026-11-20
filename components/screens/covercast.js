'use client';

import * as React from 'react';

import { covercastRoom } from '../../lib/data/forecast/index.js';

/**
 * Covercast for a room, shared by Service and Today so both pages pace from
 * the same forecast: from the server when there is one (the same call the
 * server's checks use), else computed here from the room's data. Null until
 * it's ready, or when there isn't enough history (or `enabled` is false).
 */
export function useCovercast(room, roomId, useServer, enabled = true) {
  const [srv, setSrv] = React.useState(/** @type {any} */ (null));
  React.useEffect(() => {
    if (!useServer || !enabled) return undefined;
    let stop = false;
    setSrv(null);
    fetch(`/api/forecast?room=${encodeURIComponent(roomId)}&days=14`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => { if (!stop) setSrv(b.forecast?.ready ? b.forecast : false); })
      .catch(() => { if (!stop) setSrv(false); });
    return () => { stop = true; };
  }, [roomId, useServer, enabled]);
  const local = React.useMemo(() => {
    if (useServer || !enabled) return null;
    try { const f = covercastRoom(room, { accuracy: false }); return f.ready ? f : null; } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, useServer, enabled]);
  return useServer ? (srv || null) : local;
}
