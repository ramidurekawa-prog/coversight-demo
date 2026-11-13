'use client';

/* The weekly meeting's data, one interface for both modes:
 *  - server (signed in): /api/page/meeting, sessions and actions in Postgres.
 *  - local (the browser-only demo): the same operations on this browser's
 *    storage, using the same pure functions, so the page behaves the same. */

import { finalizeMeeting, MEETING_LIMITS, startState, weekOf } from '../../../lib/data/page/meeting';

async function call(init) {
  const res = await fetch('/api/page/meeting', { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...(init || {}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status, detail: body.detail });
  return body;
}

export const serverApi = {
  load: (roomId) => fetch(`/api/page/meeting?room=${encodeURIComponent(roomId)}`, { credentials: 'same-origin' })
    .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(b.error || `Request failed (${r.status})`), { status: r.status }); return b; }),
  start: (roomId, agenda, attendees) => call({ method: 'POST', body: JSON.stringify({ op: 'start', roomId, agenda, attendees }) }),
  save: (id, version, state, takeover = false) => call({ method: 'POST', body: JSON.stringify({ op: 'save', id, version, state, takeover }) }),
  finalize: (id, version, state) => call({ method: 'POST', body: JSON.stringify({ op: 'finalize', id, version, state }) }),
  discard: (id) => call({ method: 'POST', body: JSON.stringify({ op: 'discard', id }) }),
  action: (id, patch) => call({ method: 'POST', body: JSON.stringify({ op: 'action', id, patch }) }),
};

/* ------------------------------------------------------------------ browser-only */
const KEY = (roomId) => `coversight-demo:meeting:v2:${roomId}`;
function read(roomId) {
  try { const raw = window.localStorage.getItem(KEY(roomId)); if (raw) return JSON.parse(raw); } catch { /* storage blocked */ }
  return { live: null, history: [], actions: [] };
}
function write(roomId, data) {
  try { window.localStorage.setItem(KEY(roomId), JSON.stringify(data)); } catch { /* storage blocked: keep going in memory */ }
  return data;
}
const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);
const shape = (d) => ({ ...d, live: d.live ? { ...d.live, editorIsMe: true, canEdit: true, canTakeOver: true, editor: null } : null });
const findRoom = (id) => {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k?.startsWith('coversight-demo:meeting:v2:')) continue;
      const d = JSON.parse(window.localStorage.getItem(k));
      if (d.live?.id === id || d.actions?.some((a) => a.id === id)) return k.slice('coversight-demo:meeting:v2:'.length);
    }
  } catch { /* storage blocked */ }
  return null;
};

export function localApi({ roomName = '', onDismiss = () => {} } = {}) {
  return {
    load: async (roomId) => shape(read(roomId)),
    start: async (roomId, agenda, attendees) => {
      const d = read(roomId);
      if (!d.live) {
        const now = new Date();
        d.live = { id: uid(), roomId, week: weekOf(now), status: 'live', version: 1, agenda, state: startState(attendees, now), startedAt: now.toISOString() };
      }
      return shape(write(roomId, d));
    },
    save: async (id, version, state) => {
      const roomId = findRoom(id);
      const d = read(roomId);
      if (!d.live || d.live.id !== id) throw Object.assign(new Error('This meeting is already closed.'), { status: 409 });
      d.live = { ...d.live, state: state ?? d.live.state, version: d.live.version + 1 };
      write(roomId, d);
      return { version: d.live.version };
    },
    finalize: async (id, version, state) => {
      const roomId = findRoom(id);
      const d = read(roomId);
      if (!d.live || d.live.id !== id) throw Object.assign(new Error('This meeting is already closed.'), { status: 409 });
      const now = new Date();
      const at = now.toISOString();
      const { record, upserts, updates, dismiss } = finalizeMeeting(d.live.agenda, state, { now, startedAt: d.live.startedAt, roomName });
      const acts = [...d.actions];
      for (const u of upserts) {
        const i = acts.findIndex((a) => a.sourceKey === u.sourceKey && (a.status === 'open' || a.status === 'deferred'));
        const row = { ...u, roomId, meetingId: id, updatedAt: at };
        if (i >= 0) acts[i] = { ...acts[i], ...row };
        else acts.push({ ...row, id: uid(), createdAt: at });
      }
      for (const u of updates) {
        const i = acts.findIndex((a) => a.id === u.id && a.status === 'open');
        if (i >= 0) acts[i] = { ...acts[i], ...u, updatedAt: at, ...(u.status === 'done' || u.status === 'cancelled' ? { closedAt: at } : {}) };
      }
      d.actions = acts.slice(-MEETING_LIMITS.actions * 3);
      d.history = [{ id, ...record }, ...d.history].slice(0, MEETING_LIMITS.history);
      d.live = null;
      write(roomId, d);
      if (Object.keys(dismiss).length) onDismiss(dismiss);
      return { record: { id, ...record }, ...shape(d) };
    },
    discard: async (id) => {
      const roomId = findRoom(id);
      const d = read(roomId);
      d.live = null;
      return shape(write(roomId, d));
    },
    action: async (id, patch) => {
      const roomId = findRoom(id);
      const d = read(roomId);
      const at = new Date().toISOString();
      d.actions = d.actions.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: at, ...(patch.status === 'done' || patch.status === 'cancelled' ? { closedAt: at } : {}) } : a));
      write(roomId, d);
      return { actions: d.actions };
    },
    /** Sample only: wipe this browser's meeting record for the room. */
    reset: async (roomId) => shape(write(roomId, { live: null, history: [], actions: [] })),
  };
}

