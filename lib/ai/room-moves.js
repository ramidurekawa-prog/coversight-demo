/**
 * The moves on offer in one room, worked out the way Sous works them out
 * (components/sous.jsx in the browser, server/ai/sous.ts on the server): what
 * was noticed, what the room already answered, today's first card, each
 * specialist's line check and the plan, ranked by what the room has taught it.
 *
 * The casebook logs these as the consultants' calls (lib/ai/casebook.js
 * recordCalls), so the Consultants page and the nightly job read the same
 * moves a person sees. Pure.
 */
import { rankMoves, respectNotes, sousLearned } from './learn.js';
import { sousMoves, sousRemember } from './moves.js';
import { sousNoticed, sousToday } from './sous.js';

/**
 * @param {any} d a derived room
 * @param {Record<string, any>} saved the room's saved decisions (queue, findings, fences, sous, sous.notes, sous.learn)
 * @param {{ windows?: any[], tasks?: any[], role?: string, now?: number }} [ctx]
 */
export function roomMoves(d, saved = {}, { windows = [], tasks = [], role = 'owner', now = Date.now() } = {}) {
  const today = sousToday(d, { stored: saved.queue || null, dismissed: saved.findings || {}, windows, tasks, now });
  const memory = sousRemember(sousNoticed(d), saved.sous || {}, now);
  const learned = sousLearned(d, { mem: saved.sous || {}, acts: saved['sous.learn'] || [] });
  const day = { tasks: tasks.filter((t) => t.roomId === d.id), assigned: today.view?.assigned || {}, open: today.open, fences: saved.fences ?? null, now };
  return respectNotes(rankMoves(sousMoves(d, { noticed: memory.active, card: today.card, role, quietIds: memory.quietIds, day }), learned), saved['sous.notes'] || []);
}
