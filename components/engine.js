'use client';

import * as React from 'react';

import { applyInputs, KIND_LABEL } from '../lib/data/apply';
import { SEED } from '../lib/data/seed';
import { cvLoad } from './screens/core';

/* The demo's data engine: which room is loaded, what's been entered by hand,
 * and the audit log. Every change re-derives the room (cvLoad) and bumps
 * `version`, which the shell uses to re-render every screen.
 *
 * Browser storage keeps a viewer's inputs and room across visits. It's a
 * convenience only: reads and writes are wrapped, and the demo works the same
 * with storage blocked (it just starts fresh). */

const KEY = 'coversight-demo:v1';
const INITIAL = { room: 'oakland', inputs: {}, log: [], version: 0 };
let state = INITIAL;
const subs = new Set();

function emit() { subs.forEach((f) => f()); }
function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ room: state.room, inputs: state.inputs, log: state.log }));
  } catch { /* storage blocked: keep going in memory */ }
}
function reload() {
  cvLoad(applyInputs(SEED, state.inputs), state.room);
  state = { ...state, version: state.version + 1 };
  emit();
}
const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const stamp = () => new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const engine = {
  get: () => state,
  server: () => INITIAL,
  subscribe(f) { subs.add(f); return () => subs.delete(f); },

  /** Restore a viewer's room and inputs after first render (keeps hydration identical to the server). */
  hydrate() {
    let saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
    if (!saved) return;
    state = { ...state, room: saved.room || 'oakland', inputs: saved.inputs || {}, log: saved.log || [] };
    if (state.room !== 'oakland' || Object.keys(state.inputs).length) reload();
  },

  setRoom(id) {
    if (!id || id === state.room || !SEED.rooms[id]) return;
    state = { ...state, room: id };
    persist();
    reload();
  },

  /** Commit validated rows for one kind in one room. Replaces that kind's previous entry. */
  commit(kind, roomId, rows, summary) {
    const prev = state.inputs[roomId]?.[kind] || null;
    const entry = { rows, date: today(), label: KIND_LABEL[kind], n: rows.length };
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
    state = { ...state, inputs: {}, log: [] };
    persist();
    reload();
  },
};

export function useEngine() {
  return React.useSyncExternalStore(engine.subscribe, engine.get, engine.server);
}
