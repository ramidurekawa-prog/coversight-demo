'use client';

/* Data inputs: what the page reads from the server (linked sheets, history),
 * with the browser-only fallback when there's no server. */

import * as React from 'react';

import { engine, useEngine } from '../../engine';
import { currentIds } from '../../../lib/data/page/inputs';

export async function jfetch(url, init) {
  const r = await fetch(url, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

/** Linked sheets for the viewer's rooms (server only). */
export function useLinks(server) {
  const [links, setLinks] = React.useState([]);
  const [ready, setReady] = React.useState(!server);
  React.useEffect(() => {
    if (!server) return;
    let live = true;
    jfetch('/api/inputs/links').then((j) => { if (live) setLinks(j.links || []); }).catch(() => { if (live) setLinks([]); }).finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [server]);
  return { links, setLinks, ready };
}

/**
 * The history of commits. On the server: paged, with who made each one and
 * whether it's what the room holds now. In the browser-only preview: the
 * engine's own log, everything by "you".
 */
export function useHistory({ server, roomId, kind }) {
  const eng = useEngine();
  const [state, setState] = React.useState({ entries: [], more: false, canReset: true, loading: server, error: null });
  const load = React.useCallback(async (before) => {
    const q = new URLSearchParams({ limit: '20' });
    if (roomId) q.set('roomId', roomId);
    if (kind) q.set('kind', kind);
    if (before) q.set('before', before);
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const j = await jfetch(`/api/inputs/history?${q}`);
      setState((s) => ({ entries: before ? [...s.entries, ...j.entries] : j.entries, more: j.more, canReset: j.canReset, loading: false, error: null }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, [roomId, kind]);
  React.useEffect(() => { if (server) load(); }, [server, load]);

  if (!server) {
    const cur = currentIds(eng.log);
    const entries = eng.log
      .filter((e) => (!roomId || e.room === roomId) && (!kind || e.kind === kind))
      .map((e) => ({ ...e, current: cur.has(e.id), by: { kind: 'you', name: 'You' } }));
    return { entries, more: false, canReset: true, loading: false, error: null, loadMore: () => {}, reload: () => {} };
  }
  const last = state.entries[state.entries.length - 1];
  return { ...state, loadMore: () => last && load(last.createdAt), reload: () => load() };
}

/** Undo one entry. The engine does it when the entry is in its recent log; older ones go straight to the server. */
export async function undoEntry(id) {
  const eng = engine.get();
  if (eng.mode !== 'server' || eng.log.some((e) => e.id === id)) { engine.undo(id); return; }
  await jfetch(`/api/inputs/${encodeURIComponent(id)}/undo`, { method: 'POST' });
  await engine.hydrate();
}
