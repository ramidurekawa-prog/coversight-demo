// The nightly Trends watch. For every room it computes the same series, limits
// and signals the Trends page shows (lib/data/page/trends.js on the rows
// lib/data/model.js derives), keeps a snapshot, and tells the room's people
// about a signal that is still going, is in the bad direction and nobody has
// explained yet. One notification per episode, ever: the dedupe key is the
// episode's first week, which doesn't move as the episode grows.
import { and, eq } from 'drizzle-orm';

import { deriveRoom } from '../../lib/data/model.js';
import { describeSignal, isExplained, METRIC, signalKey, trendsFor } from '../../lib/data/page/trends.js';
import type { Db } from '../db/client';
import { snapshots } from '../db/schema';
import { loadActions } from '../actions';
import { loadDataset } from '../dataset';
import { notify } from '../notify';

type Signal = { metric: string; from: number; to: number; i: number; weeks: number; kind: 'limit' | 'shift'; dir: 'up' | 'down'; value: number; ongoing: boolean; good: boolean };
type Note = { cause: string; text: string; at: string };
type Row = { iso?: string; label?: string; own?: boolean };

export async function runTrendsWatch(db: Db, orgId: string) {
  const loaded = await loadDataset(db, orgId);
  if (!loaded) return { rooms: 0, told: 0 };
  const acts = await loadActions(db, orgId);
  const byRoom: Record<string, unknown> = {};
  let told = 0;
  for (const id of Object.keys(loaded.ds.rooms)) {
    const d = deriveRoom(loaded.ds, id);
    const rows: Row[] = d.hist.rows;
    const t = trendsFor(rows) as unknown as { w: { own: boolean; ready: boolean; needWeeks: number }; signals: Signal[]; metrics: Record<string, { lim: unknown }> };
    const notes = (acts[id]?.['trends.notes'] ?? {}) as Record<string, Note>;
    const signals = t.signals.map((s) => {
      const key = signalKey(s, rows);
      const note = notes[key];
      return { key, metric: s.metric, kind: s.kind, dir: s.dir, good: s.good, ongoing: s.ongoing, weeks: s.weeks, from: rows[s.from]?.iso ?? null, to: rows[s.to]?.iso ?? null, explained: isExplained(note), cause: note?.cause ?? null, ...describeSignal(s, rows, t.metrics[s.metric]!.lim) };
    });
    const latest = rows.at(-1);
    const data = { week: latest?.iso ?? null, own: t.w.own, ready: t.w.ready, needWeeks: t.w.needWeeks, signals };
    await db.insert(snapshots).values({ orgId, roomId: id, kind: 'trends', data })
      .onConflictDoUpdate({ target: [snapshots.orgId, snapshots.roomId, snapshots.kind], set: { data, at: new Date() } });
    const name = loaded.ds.rooms[id]?.profile?.short ?? id;
    for (const s of signals) {
      if (s.good || !s.ongoing || s.explained) continue;
      const row = await notify(db, {
        orgId, roomId: id, kind: 'trends.signal', severity: 'warn', link: '/trends/',
        title: `${name}: ${s.title}`,
        body: `${s.body}\n\nOpen Trends to see the week and note why (${METRIC[s.metric]?.label ?? s.metric}).`,
        dedupe: `trends:${id}:${s.key}`,
      });
      if (row) told++;
    }
    byRoom[id] = { signals: signals.length, open: signals.filter((s) => !s.good && !s.explained).length };
  }
  return { rooms: Object.keys(byRoom).length, told, byRoom };
}

/** The latest Trends snapshot for one room (what the job last saw). */
export async function trendsSnapshot(db: Db, orgId: string, roomId: string) {
  const [row] = await db.select().from(snapshots).where(and(eq(snapshots.orgId, orgId), eq(snapshots.roomId, roomId), eq(snapshots.kind, 'trends')));
  return row ?? null;
}
