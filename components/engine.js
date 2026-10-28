'use client';

import * as React from 'react';

import { applyInputs, KIND_LABEL } from '../lib/data/apply';
import { SEED } from '../lib/data/seed';
import { KINDS } from '../lib/data/ingest';
import { cvLoad } from './screens/core';

/* The demo's data engine: which room is loaded, what's been entered by hand,
 * and the audit log. Every change re-derives the room (cvLoad) and bumps
 * `version`, which the shell uses to re-render every screen.
 *
 * Browser storage keeps a viewer's inputs and room across visits. It's a
 * convenience only: every read is validated, a failed load resets to the
 * sample group instead of breaking the page, and the demo works the same with
 * storage blocked. Bump KEY when the input shape changes so old saves are
 * dropped rather than misread. */

const KEY = 'coversight-demo:v2';
const OLD_KEYS = ['coversight-demo:v1'];
const INITIAL = { room: 'oakland', inputs: {}, log: [], version: 0, notice: null };
let state = INITIAL;
const subs = new Set();

function emit() { subs.forEach((f) => f()); }
function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ room: state.room, inputs: state.inputs, log: state.log }));
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
export function sanitizeSaved(saved) {
  if (!isObj(saved)) return null;
  const room = typeof saved.room === 'string' && SEED.rooms[saved.room] ? saved.room : 'oakland';
  const inputs = {};
  if (isObj(saved.inputs)) {
    Object.entries(saved.inputs).forEach(([roomId, kinds]) => {
      if (!SEED.rooms[roomId] || !isObj(kinds)) return;
      Object.entries(kinds).forEach(([kind, entry]) => {
        if (!KINDS.includes(kind) || !isObj(entry) || !Array.isArray(entry.rows) || !entry.rows.every(isObj)) return;
        inputs[roomId] ??= {};
        inputs[roomId][kind] = { rows: entry.rows, date: String(entry.date || ''), label: KIND_LABEL[kind], n: entry.rows.length, ...(isObj(entry.opts) ? { opts: entry.opts } : {}) };
      });
    });
  }
  const log = Array.isArray(saved.log) ? saved.log.filter((e) => isObj(e) && typeof e.id === 'string' && KINDS.includes(e.kind) && SEED.rooms[e.room]).slice(0, 50) : [];
  return { room, inputs, log };
}

/** Re-derive; if the data can't be derived, fall back to the sample group and say so. */
function reload() {
  try {
    cvLoad(applyInputs(SEED, state.inputs), state.room);
  } catch (err) {
    console.error('Coversight demo: could not load saved data, resetting', err);
    state = { ...state, room: SEED.rooms[state.room] ? state.room : 'oakland', inputs: {}, log: [], notice: 'Saved demo data couldn’t be loaded, so the demo is back on the sample group.' };
    clearSaved();
    cvLoad(SEED, state.room);
  }
  state = { ...state, version: state.version + 1 };
  emit();
}
const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const stamp = () => new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const engine = {
  get: () => state,
  server: () => INITIAL,
  subscribe(f) { subs.add(f); return () => subs.delete(f); },

  /** True when a viewer has a non-default saved state (the shell holds paint until it's applied). */
  hasSaved() {
    try {
      const raw = window.localStorage.getItem(KEY);
      return !!raw && raw !== JSON.stringify({ room: 'oakland', inputs: {}, log: [] });
    } catch { return false; }
  },

  /** Restore a viewer's room and inputs (called from a layout effect, before first paint). */
  hydrate() {
    let raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch { raw = null; }
    try { OLD_KEYS.forEach((k) => window.localStorage.removeItem(k)); } catch { /* ignore */ }
    if (!raw) return;
    let saved = null;
    try { saved = sanitizeSaved(JSON.parse(raw)); } catch { saved = null; }
    if (!saved) { clearSaved(); return; }
    state = { ...state, ...saved };
    if (state.room !== 'oakland' || Object.keys(state.inputs).length) reload();
  },

  dismissNotice() { state = { ...state, notice: null }; emit(); },

  setRoom(id) {
    if (!id || id === state.room || !SEED.rooms[id]) return;
    state = { ...state, room: id };
    persist();
    reload();
  },

  /** Commit validated rows for one kind in one room. Replaces that kind's previous entry. */
  commit(kind, roomId, rows, summary, opts) {
    const prev = state.inputs[roomId]?.[kind] || null;
    const entry = { rows, date: today(), label: KIND_LABEL[kind], n: rows.length, ...(opts ? { opts } : {}) };
    const id = `${Date.now().toString(36)}-${kind}`;
    state = {
      ...state,
      inputs: { ...state.inputs, [roomId]: { ...(state.inputs[roomId] || {}), [kind]: entry } },
      log: [{ id, kind, room: roomId, at: stamp(), rows: rows.length, summary, prev }, ...state.log].slice(0, 50),
    };
    persist();
    reload();
    return id;
  },

  /** Undo one commit: restores whatever that kind held before it. */
  undo(logId) {
    const e = state.log.find((x) => x.id === logId);
    if (!e || e.undone) return;
    const roomInputs = { ...(state.inputs[e.room] || {}) };
    if (e.prev) roomInputs[e.kind] = e.prev;
    else delete roomInputs[e.kind];
    const inputs = { ...state.inputs, [e.room]: roomInputs };
    if (!Object.keys(roomInputs).length) delete inputs[e.room];
    state = { ...state, inputs, log: state.log.map((x) => (x.id === logId ? { ...x, undone: true } : x)) };
    persist();
    reload();
  },

  /** Back to the sample restaurant group. */
  reset() {
    state = { ...state, inputs: {}, log: [], notice: null };
    persist();
    reload();
  },

  /** Hard reset from the error screen: clears storage even if the engine never loaded. */
  hardReset() {
    clearSaved();
    state = { ...INITIAL, version: state.version + 1 };
    try { cvLoad(SEED, 'oakland'); } catch { /* the seed always loads */ }
    emit();
  },
};

export function useEngine() {
  return React.useSyncExternalStore(engine.subscribe, engine.get, engine.server);
}
