'use client';

import * as React from 'react';

import { applyInputs, KIND_LABEL } from '../lib/data/apply';
import { SEED } from '../lib/data/seed';
import { KINDS } from '../lib/data/ingest';
import { authClient } from '../lib/client/auth';
import { cvLoad } from './screens/core';

/* The data engine: which org's data is loaded, which room is showing, what's
 * been entered by hand, and the activity log. Every change re-derives the room
 * (cvLoad) and bumps `version`, which the shell uses to re-render every screen.
 *
 * Two modes:
 *  - server: signed in. The org's dataset, inputs and log come from /api/state;
 *    every commit, undo and reset is saved on the server first, then applied.
 *  - local: no backend reachable (a static preview, or local dev without a
 *    database). Inputs live in this browser only, as before.
 * The room picker is a per-viewer convenience kept in browser storage either way. */

const KEY = 'coversight-demo:v2';
const OLD_KEYS = ['coversight-demo:v1'];
const INITIAL = { mode: 'pending', base: SEED, org: null, viewer: null, room: 'oakland', inputs: {}, log: [], version: 0, notice: null, saving: false };
let state = INITIAL;
const subs = new Set();

function emit() { subs.forEach((f) => f()); }
function persist() {
  try {
    const saved = state.mode === 'server' ? { room: state.room } : { room: state.room, inputs: state.inputs, log: state.log };
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch { /* storage blocked: keep going in memory */ }
}
function clearSaved() {
  try {
    window.localStorage.removeItem(KEY);
    OLD_KEYS.forEach((k) => window.localStorage.removeItem(k));
  } catch { /* ignore */ }
}

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Keep only what the current dataset understands; drop everything else. */
export function sanitizeSaved(saved, base = SEED) {
  if (!isObj(saved)) return null;
  const firstRoom = Object.keys(base.rooms)[0] || 'oakland';
  const room = typeof saved.room === 'string' && base.rooms[saved.room] ? saved.room : firstRoom;
  const inputs = {};
  if (isObj(saved.inputs)) {
    Object.entries(saved.inputs).forEach(([roomId, kinds]) => {
      if (!base.rooms[roomId] || !isObj(kinds)) return;
      Object.entries(kinds).forEach(([kind, entry]) => {
        if (!KINDS.includes(kind) || !isObj(entry) || !Array.isArray(entry.rows) || !entry.rows.every(isObj)) return;
        inputs[roomId] ??= {};
        inputs[roomId][kind] = { rows: entry.rows, date: String(entry.date || ''), label: KIND_LABEL[kind], n: entry.rows.length, ...(isObj(entry.opts) ? { opts: entry.opts } : {}) };
      });
    });
  }
  const log = Array.isArray(saved.log) ? saved.log.filter((e) => isObj(e) && typeof e.id === 'string' && KINDS.includes(e.kind) && base.rooms[e.room]).slice(0, 50) : [];
  return { room, inputs, log };
}

/** Re-derive; if the data can't be derived, fall back to the org's base data and say so. */
function reload() {
  try {
    cvLoad(applyInputs(state.base, state.inputs), state.room);
  } catch (err) {
    console.error('Coversight: could not apply inputs, showing the data without them', err);
    state = { ...state, inputs: {}, notice: 'Some entered data couldn’t be applied, so it’s hidden for now.' };
    if (state.mode === 'local') clearSaved();
    cvLoad(state.base, state.base.rooms[state.room] ? state.room : Object.keys(state.base.rooms)[0]);
  }
  state = { ...state, version: state.version + 1 };
  emit();
}
const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const stamp = () => new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function api(path, init) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status });
  return body;
}

function savedRoom() {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function hydrateLocal() {
  let saved = savedRoom();
  try { OLD_KEYS.forEach((k) => window.localStorage.removeItem(k)); } catch { /* ignore */ }
  saved = saved ? sanitizeSaved(saved, SEED) : null;
  state = { ...state, mode: 'local', base: SEED, ...(saved || {}) };
  reload();
}

export const engine = {
  get: () => state,
  server: () => INITIAL,
  subscribe(f) { subs.add(f); return () => subs.delete(f); },

  /** Load the signed-in org from the server; with no backend, fall back to this browser. */
  async hydrate() {
    let body;
    try {
      body = await api('/api/state');
    } catch (err) {
      if (err.status === 401) {
        window.location.assign(`/login/?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      // No backend (404 on a static host, 503 with no database, or offline).
      hydrateLocal();
      return;
    }
    const saved = sanitizeSaved(savedRoom() || {}, body.base) || {};
    state = {
      ...state,
      mode: 'server',
      base: body.base,
      org: body.org,
      viewer: body.viewer,
      room: saved.room || Object.keys(body.base.rooms)[0],
      inputs: body.inputs || {},
      log: body.log || [],
    };
    reload();
  },

  dismissNotice() { state = { ...state, notice: null }; emit(); },

  setRoom(id) {
    if (!id || id === state.room || !state.base.rooms[id]) return;
    state = { ...state, room: id };
    persist();
    reload();
  },

  /** Save validated rows for one kind in one room. Replaces that kind's previous entry. */
  commit(kind, roomId, rows, summary, opts) {
    const prev = state.inputs[roomId]?.[kind] || null;
    const entry = { rows, date: today(), label: KIND_LABEL[kind], n: rows.length, ...(opts ? { opts } : {}) };
    const id = `${Date.now().toString(36)}-${kind}`;
    const before = { inputs: state.inputs, log: state.log };
    // Applied at once; on the server the saved copy replaces it, or it's rolled back.
    state = {
      ...state,
      inputs: { ...state.inputs, [roomId]: { ...(state.inputs[roomId] || {}), [kind]: entry } },
      log: [{ id, kind, room: roomId, at: stamp(), rows: rows.length, summary, prev }, ...state.log].slice(0, 50),
    };
    if (state.mode === 'server') {
      state = { ...state, saving: true };
      api('/api/inputs', { method: 'POST', body: JSON.stringify({ roomId, kind, rows, opts, summary }) })
        .then((b) => { state = { ...state, inputs: b.inputs, log: b.log, saving: false }; reload(); })
        .catch((err) => { state = { ...state, ...before, saving: false, notice: `Not saved: ${err.message}` }; reload(); });
    }
    persist();
    reload();
    return id;
  },

  /** Undo one entry: restores whatever that kind held before it. */
  undo(logId) {
    const e = state.log.find((x) => x.id === logId);
    if (!e || e.undone) return;
    if (state.mode === 'server') {
      api(`/api/inputs/${encodeURIComponent(logId)}/undo`, { method: 'POST' })
        .then((b) => { state = { ...state, inputs: b.inputs, log: b.log }; reload(); })
        .catch((err) => { state = { ...state, notice: `Couldn’t undo: ${err.message}` }; emit(); });
      return;
    }
    const roomInputs = { ...(state.inputs[e.room] || {}) };
    if (e.prev) roomInputs[e.kind] = e.prev;
    else delete roomInputs[e.kind];
    const inputs = { ...state.inputs, [e.room]: roomInputs };
    if (!Object.keys(roomInputs).length) delete inputs[e.room];
    state = { ...state, inputs, log: state.log.map((x) => (x.id === logId ? { ...x, undone: true } : x)) };
    persist();
    reload();
  },

  /** Clear every hand-entered input (back to the org's own data). */
  reset() {
    if (state.mode === 'server') {
      api('/api/inputs/reset', { method: 'POST' })
        .then((b) => { state = { ...state, inputs: b.inputs, log: b.log, notice: null }; reload(); })
        .catch((err) => { state = { ...state, notice: `Couldn’t reset: ${err.message}` }; emit(); });
      return;
    }
    state = { ...state, inputs: {}, log: [], notice: null };
    persist();
    reload();
  },

  /** Hard reset from the error screen: clears browser storage and reloads the org. */
  hardReset() {
    clearSaved();
    state = { ...INITIAL, version: state.version + 1 };
    try { cvLoad(SEED, 'oakland'); } catch { /* the seed always loads */ }
    emit();
    void engine.hydrate();
  },

  async signOut() {
    try { await authClient.signOut(); } catch { /* ignore */ }
    clearSaved();
    window.location.assign('/login/');
  },
};

export function useEngine() {
  return React.useSyncExternalStore(engine.subscribe, engine.get, engine.server);
}
