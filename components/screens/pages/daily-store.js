'use client';

import * as React from 'react';

import { buildDaily, daysFromExports } from '../../../lib/data/page/daily';

/* Local rooms hold { days: summaries (with source, complete), checks: { [day]: rows }, notes }. */
import { detectToastFile } from '../../../lib/data/toast';
import { gridToTable } from '../../../lib/data/ingest';
import { readAny } from '../../../lib/data/sniff';

/* Where Daily detail's own days and notes live.
 *  - server mode: /api/page/daily (stored per group and room, scoped to the
 *    viewer). Synced days are summarised as they're read; while some are
 *    still waiting the page asks again.
 *  - local mode (no backend): this browser only, the same summaries. */

const KEY = 'coversight-daily:v1';
const CHUNK = 30;

function readLocal() {
  try { return JSON.parse(window.localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function writeLocal(all) {
  try { window.localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; }
}
const memory = { rooms: null };
function localRoom(roomId) {
  memory.rooms ??= readLocal().rooms || {};
  return memory.rooms[roomId] ?? { days: [], notes: {} };
}
function saveLocalRoom(roomId, room) {
  memory.rooms = { ...(memory.rooms || {}), [roomId]: room };
  // Checks stay in memory: a few months of them outgrow browser storage. Days and notes are kept.
  return writeLocal({ rooms: Object.fromEntries(Object.entries(memory.rooms).map(([k, v]) => [k, { ...v, checks: undefined }])) });
}
function localPayload(roomId) {
  const r = localRoom(roomId);
  const uploaded = r.days.filter((d) => d.source === 'toast-export');
  const complete = r.days.filter((d) => d.complete !== false);
  return {
    roomId, view: buildDaily(r.days), notes: r.notes, pending: 0,
    provenance: { synced: r.days.length - uploaded.length, uploaded: uploaded.length, uploadedAt: r.uploadedAt ?? null, first: r.days[0]?.day ?? null, last: r.days.at(-1)?.day ?? null, dataThrough: complete.at(-1)?.day ?? null, partial: r.days.filter((d) => d.complete === false).map((d) => d.day), lastSyncAt: null, tz: null, local: true },
  };
}

async function api(path, init) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

/** Read dropped files (CSV, .xlsx, zips) into day summaries. Nothing is saved yet. */
export async function readDailyFiles(fileList) {
  const files = [], unknown = [], errors = [];
  for (const f of [...fileList]) {
    const read = readAny({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
    errors.push(...read.errors.map((e) => `${e.name}: ${e.msg}`));
    for (const t of read.tables) {
      const tab = gridToTable(t.grid);
      const kind = detectToastFile(tab.headers);
      if (kind) files.push({ kind, name: t.source, rows: tab.rows });
      else unknown.push(t.source);
    }
    unknown.push(...read.media.map((m) => m.name));
  }
  if (!files.length) return { ok: false, error: errors[0] ?? 'None of these look like Toast data exports. Daily detail reads OrderDetails.csv, ItemSelectionDetails.csv, TimeEntries.csv and PaymentDetails.csv (or a zip of them).', unknown };
  const r = daysFromExports(files);
  return { ...r, files: files.map((f) => ({ name: f.name, kind: f.kind, rows: f.rows.length })), unknown, errors };
}

/**
 * @param {string} roomId
 * @param {'pending' | 'server' | 'local'} mode
 */
export function useDailyData(roomId, mode) {
  const [state, setState] = React.useState({ status: 'loading', roomId: null, view: null, notes: {}, provenance: null, pending: 0, error: null });
  const tries = React.useRef(0);

  const load = React.useCallback(async () => {
    if (mode === 'pending' || !roomId) return;
    if (mode !== 'server') { setState({ status: 'ready', error: null, ...localPayload(roomId) }); return; }
    try {
      const b = await api(`/api/page/daily?room=${encodeURIComponent(roomId)}`);
      setState({ status: 'ready', error: null, ...b });
      if (b.pending > 0 && tries.current++ < 40) setTimeout(() => load(), 600);
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', roomId, error: e.message }));
    }
  }, [roomId, mode]);

  React.useEffect(() => {
    tries.current = 0;
    setState((s) => (s.roomId === roomId ? s : { status: 'loading', roomId, view: null, notes: {}, provenance: null, pending: 0, error: null }));
    load();
  }, [load, roomId]);

  /** Save parsed days. Resolves to { saved, keptSynced }. */
  const upload = React.useCallback(async (days, onProgress) => {
    if (mode !== 'server') {
      const r = localRoom(roomId);
      const byDay = new Map(r.days.map((d) => [d.day, d]));
      const checks = { ...(r.checks || {}) };
      let kept = 0, saved = 0;
      for (const d of days) {
        if (byDay.get(d.summary.day)?.source === 'toast-api') { kept++; continue; }
        byDay.set(d.summary.day, { ...d.summary, source: 'toast-export', complete: d.complete });
        checks[d.summary.day] = d.checks; saved++;
      }
      const all = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
      const stored = saveLocalRoom(roomId, { ...r, days: all, checks, uploadedAt: new Date().toISOString() });
      await load();
      return { saved, keptSynced: kept, stored };
    }
    let saved = 0, keptSynced = 0;
    for (let i = 0; i < days.length; i += CHUNK) {
      const b = await api('/api/page/daily', { method: 'POST', body: JSON.stringify({ roomId, days: days.slice(i, i + CHUNK) }) });
      saved += b.saved; keptSynced += b.keptSynced;
      onProgress?.(Math.min(days.length, i + CHUNK), days.length);
    }
    await load();
    return { saved, keptSynced, stored: true };
  }, [roomId, mode, load]);

  const removeUploads = React.useCallback(async () => {
    if (mode !== 'server') {
      const r = localRoom(roomId);
      saveLocalRoom(roomId, { ...r, days: r.days.filter((d) => d.source !== 'toast-export'), checks: {}, uploadedAt: null });
      await load();
      return;
    }
    await api(`/api/page/daily?room=${encodeURIComponent(roomId)}`, { method: 'DELETE' });
    await load();
  }, [roomId, mode, load]);

  /** Write, change or (empty text) remove the note on a day. */
  const saveNote = React.useCallback(async (day, text, by = '') => {
    if (mode !== 'server') {
      const r = localRoom(roomId);
      const notes = { ...r.notes };
      const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 280);
      if (t) notes[day] = { text: t, by, at: new Date().toISOString() }; else delete notes[day];
      saveLocalRoom(roomId, { ...r, notes });
      setState((s) => ({ ...s, notes }));
      return;
    }
    const b = await api('/api/page/daily/notes', { method: 'POST', body: JSON.stringify({ roomId, day, text }) });
    setState((s) => ({ ...s, notes: b.notes }));
  }, [roomId, mode]);

  /** One day in full: dishes and checks. */
  const loadDay = React.useCallback(async (day) => {
    if (mode !== 'server') {
      const r = localRoom(roomId);
      const s = r.days.find((d) => d.day === day);
      if (!s) return { day, held: false };
      const checks = r.checks?.[day] ?? null;
      return { day, held: true, source: s.source, complete: s.complete !== false, dishes: s.dishes || {}, checks, checksKept: checks != null };
    }
    return api(`/api/page/daily/day?room=${encodeURIComponent(roomId)}&day=${encodeURIComponent(day)}`);
  }, [roomId, mode]);

  return { ...state, reload: load, upload, removeUploads, saveNote, loadDay };
}
