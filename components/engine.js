'use client';

import * as React from 'react';

import { applyInputs, KIND_LABEL } from '../lib/data/apply';
import { SEED } from '../lib/data/seed';
import { INPUT_KINDS as KINDS } from '../lib/data/apply';
import { authClient } from '../lib/client/auth';
import { cvLoad } from './screens/core';
import { expectFor, stepsFor } from '../lib/data/writebacks';

/* The data engine: which org's data is loaded, which room is showing, what's
 * been entered by hand, and the activity log. Every change re-derives the room
 * (cvLoad) and bumps `version`, which the shell uses to re-render every screen.
 *
 * Two modes:
 *  - server: signed in. The org's dataset, inputs and log come from /api/state;
 *    every commit, undo and reset is saved on the server first, then applied.
 *    Operator decisions (engine.act / useSaved) save to /api/actions.
 *  - local: no backend reachable (a static preview, or local dev without a
 *    database). Inputs and decisions live in this browser only, as before.
 * The room picker is a per-viewer convenience kept in browser storage either way. */

const KEY = 'coversight-demo:v2';
const OLD_KEYS = ['coversight-demo:v1'];
const INITIAL = { mode: 'pending', base: SEED, org: null, viewer: null, room: 'oakland', inputs: {}, log: [], actions: {}, tasks: [], windows: [], notes: { items: [], unread: 0 }, version: 0, notice: null, saving: false };
let state = INITIAL;
const subs = new Set();
const pending = new Map();
let notesTimer = null;

function emit() { subs.forEach((f) => f()); }
function persist() {
  try {
    const saved = state.mode === 'server' ? { room: state.room } : { room: state.room, inputs: state.inputs, log: state.log, actions: state.actions, tasks: state.tasks };
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch { /* storage blocked: keep going in memory */ }
}
function clearSaved() {
  try {
    window.localStorage.removeItem(KEY);
    OLD_KEYS.forEach((k) => window.localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/** The room key for decisions that belong to the whole group. */
export const GROUP = '';

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
  const actions = {};
  if (isObj(saved.actions)) {
    Object.entries(saved.actions).forEach(([roomId, keys]) => {
      if ((roomId === GROUP || base.rooms[roomId]) && isObj(keys)) actions[roomId] = keys;
    });
  }
  const tasks = Array.isArray(saved.tasks) ? saved.tasks.filter((t) => isObj(t) && typeof t.id === 'string' && base.rooms[t.roomId] && Array.isArray(t.steps)).slice(0, 200) : [];
  return { room, inputs, log, actions, tasks };
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
      actions: body.actions || {},
    };
    reload();
    api('/api/tasks').then((b) => { state = { ...state, tasks: b.tasks || [] }; emit(); }).catch(() => { /* tasks load best-effort */ });
    engine.refreshNotes();
    engine.refreshWindows();
    if (!notesTimer) notesTimer = setInterval(() => { if (document.visibilityState === 'visible') engine.refreshNotes(); }, 60_000);
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

  /** The saved value of one decision for a room ('' = the whole group), or undefined. */
  saved(key, room = state.room) { return state.actions[room]?.[key]; },

  /** Save one operator decision. Shown at once; on the server the write is
   * debounced per room and key (a dragged slider sends one request), and a
   * refused write rolls back to the last saved value with a notice. Doesn't
   * re-derive figures, so screens keep their local state. */
  act(key, value, { room = state.room, summary = '' } = {}) {
    const slot = `${room}/${key}`;
    if (!pending.has(slot)) pending.set(slot, { confirmed: state.actions[room]?.[key], timer: null });
    const p = pending.get(slot);
    state = { ...state, actions: { ...state.actions, [room]: { ...(state.actions[room] || {}), [key]: value } } };
    emit();
    if (state.mode !== 'server') { persist(); pending.delete(slot); return; }
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      pending.delete(slot);
      state = { ...state, saving: true }; emit();
      api('/api/actions', { method: 'POST', body: JSON.stringify({ roomId: room, key, value, summary }) })
        .then(() => { state = { ...state, saving: false }; emit(); })
        .catch((err) => {
          const roomActs = { ...(state.actions[room] || {}) };
          if (p.confirmed === undefined) delete roomActs[key]; else roomActs[key] = p.confirmed;
          state = { ...state, saving: false, actions: { ...state.actions, [room]: roomActs }, notice: `Not saved: ${err.message}` };
          emit();
        });
    }, 350);
  },

  /** An approved change becomes a guided task: steps to do in the other system, then Done. */
  createTask(approvalId, a, roomId = state.room) {
    const payload = { roomId, approvalId, title: a.title, system: a.system, diff: (a.diff || []).map((row) => row.map((c) => String(c).slice(0, 120))) };
    if (state.mode === 'server') {
      return api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) })
        .then((b) => { state = { ...state, tasks: b.tasks }; emit(); return b.task; })
        .catch((err) => { state = { ...state, notice: `Task not saved: ${err.message}` }; emit(); return null; });
    }
    const dup = state.tasks.find((t) => t.roomId === roomId && t.approvalId === approvalId && (t.status === 'open' || t.status === 'done'));
    if (dup) return Promise.resolve(dup);
    const task = { id: `local-${Date.now().toString(36)}`, roomId, approvalId, title: a.title, system: a.system, steps: stepsFor(a.system, payload.diff), expect: expectFor(approvalId), status: 'open', createdAt: new Date().toISOString() };
    state = { ...state, tasks: [task, ...state.tasks] };
    persist(); emit();
    return Promise.resolve(task);
  },

  /** done | reopen | cancel */
  taskAction(id, action) {
    if (state.mode === 'server') {
      return api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ action }) })
        .then((b) => { state = { ...state, tasks: b.tasks }; emit(); return b.task; })
        .catch((err) => { state = { ...state, notice: `Couldn’t update the task: ${err.message}` }; emit(); return null; });
    }
    const status = action === 'done' ? 'done' : action === 'reopen' ? 'open' : 'cancelled';
    state = { ...state, tasks: state.tasks.map((t) => (t.id === id ? { ...t, status, ...(action === 'done' ? { doneAt: new Date().toISOString() } : {}) } : t)) };
    persist(); emit();
    return Promise.resolve(state.tasks.find((t) => t.id === id));
  },

  /** Test windows (server mode only). */
  refreshWindows() {
    if (state.mode !== 'server') return Promise.resolve([]);
    return api('/api/windows').then((b) => { state = { ...state, windows: b.windows || [] }; emit(); return b.windows; }).catch(() => []);
  },
  /** Start a 28-day test on a lever in a room. Resolves to { ok, error? }. */
  startWindow(lever, { roomId = state.room, dish } = {}) {
    if (state.mode !== 'server') return Promise.resolve({ ok: false, error: 'Tests need the server; this preview runs in your browser only.' });
    return api('/api/windows', { method: 'POST', body: JSON.stringify({ roomId, lever, dish }) })
      .then((b) => { state = { ...state, windows: b.windows }; emit(); return { ok: true, window: b.window }; })
      .catch((err) => ({ ok: false, error: err.message }));
  },
  stopWindow(id) {
    return api(`/api/windows/${encodeURIComponent(id)}/stop`, { method: 'POST' })
      .then((b) => { state = { ...state, windows: b.windows }; emit(); return { ok: true }; })
      .catch((err) => ({ ok: false, error: err.message }));
  },

  /** The bell: notifications for this viewer (server mode only). */
  refreshNotes() {
    if (state.mode !== 'server') return;
    api('/api/notifications').then((b) => { state = { ...state, notes: b }; emit(); }).catch(() => { /* best-effort */ });
  },
  markRead(ids) {
    if (state.mode !== 'server') return;
    const all = ids === 'all';
    state = { ...state, notes: { items: state.notes.items.map((n) => (all || ids.includes(n.id) ? { ...n, read: true } : n)), unread: all ? 0 : Math.max(0, state.notes.unread - ids.length) } };
    emit();
    api('/api/notifications', { method: 'POST', body: JSON.stringify({ ids }) }).then((b) => { state = { ...state, notes: b }; emit(); }).catch(() => { /* best-effort */ });
  },

  /** An email the operator asked for (vendor request, GM talking points). No address → a draft. */
  draftEmail(payload) {
    if (state.mode !== 'server') return Promise.resolve({ status: 'local' });
    return api('/api/outbox', { method: 'POST', body: JSON.stringify(payload) }).then((b) => b.email);
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

/** Like useState, but saved: per room (or for the whole group with { group: true }),
 * on the server when signed in, else in this browser. set(next, summary) takes a
 * value or an updater. */
export function useSaved(key, initial, { group = false } = {}) {
  const eng = useEngine();
  const room = group ? GROUP : eng.room;
  const v = eng.actions[room]?.[key];
  const value = v === undefined ? initial : v;
  const set = (next, summary) => {
    const cur = engine.saved(key, room);
    engine.act(key, typeof next === 'function' ? next(cur === undefined ? initial : cur) : next, { room, summary });
  };
  return [value, set];
}
