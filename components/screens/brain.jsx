'use client';

import * as React from 'react';
import { useEngine, useSaved } from '../engine';
import { CV_D, CV_GROUP, CV_NOW } from './core';
import { casebook, recordCalls } from '../../lib/ai/casebook';
import { roomMoves } from '../../lib/ai/room-moves';

/* What Mise (the restaurant's brain) and the consultants read for the room in
   view, shared by the Mise and Consultants pages: the room's saved decisions,
   the moves on offer now, and the casebook. Opening either page logs the
   consultants' calls on offer (once each, with what they estimated then). */
export function useBrain() {
  const eng = useEngine();
  const saved = eng.actions?.[CV_D.id] || {};
  const seeded = React.useMemo(() => Object.fromEntries(Object.entries(CV_D.room.autonomy || {}).map(([k, [now]]) => [k, now])), [eng.version, eng.room]);
  const [levels, saveLevels] = useSaved('autonomy', seeded);
  const [calls, saveCalls] = useSaved('sous.calls', []);
  const own = eng.mode === 'server' && eng.org && !eng.org.sample;
  const rooms = React.useMemo(() => Object.fromEntries((CV_GROUP.rows || []).map((r) => [r.id, r.name])), [eng.version]);

  const moves = React.useMemo(() => roomMoves(CV_D, saved, { windows: eng.windows || [], tasks: eng.tasks || [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eng.version, eng.room, eng.actions, eng.windows, eng.tasks]);
  React.useEffect(() => {
    const next = recordCalls(calls, moves);
    const n = next.length - (calls?.length || 0);
    if (next !== calls) saveCalls(next, `Logged ${n} consultant call${n === 1 ? '' : 's'}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves]);

  const book = React.useMemo(() => casebook(CV_D, {
    windows: own ? eng.windows || [] : undefined, rooms, today: own ? undefined : CV_NOW.iso,
    calls, acts: saved['sous.learn'] || [], mem: saved.sous || {}, offered: moves, levels: { ...seeded, ...(levels || {}) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [own, eng.windows, rooms, calls, saved, moves, levels]);

  return { eng, saved, seeded, levels, saveLevels, moves, book, own, rooms };
}
