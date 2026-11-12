/**
 * One cycle of the crew: an event queue, every agent that subscribes to an
 * event runs, each effect it asks for is authorized, applied by the store,
 * and logged. Events are deduplicated per cycle so two agents can't loop.
 *
 * A store provides: orgId, startCycle(), facts(), apply(agent, effect),
 * logEvent(), logRun(), finishCycle(). The server's store writes Postgres;
 * the memory store (browser preview, tests) keeps it all in memory.
 */
import { CREW } from './crew.js';
import { authorize } from './policy.js';
import { deriveRoom } from '../data/model.js';
import { dataEnd } from '../data/readers.js';

/** The sample's clock is frozen at its last week; real data runs on today. */
export const SAMPLE_NOW = '2026-10-27';

const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
export { stable };

/** Facts every agent reads about a group's rooms, from an applied dataset. */
export function roomFacts(ds, { today, sample }) {
  return Object.keys(ds.rooms).map((id) => {
    const room = ds.rooms[id];
    const d = deriveRoom(ds, id);
    const end = dataEnd(room, SAMPLE_NOW);
    const own = !!room.fromToast;
    const clock = own || !sample ? today : SAMPLE_NOW;
    return { id, name: room.profile?.short ?? room.profile?.name ?? id, room, d, dataEnd: end, own, staleDays: Math.max(0, Math.round((Date.parse(`${clock}T12:00:00Z`) - Date.parse(`${end}T12:00:00Z`)) / 864e5)) };
  });
}

/**
 * How an incoming proposal meets the existing one with the same key.
 * A person's "no" holds for 14 days; an unchanged proposal isn't re-sent.
 * @returns {'insert'|'update'|'skip'|'resolve'|'reopen'}
 */
export function proposalAction(existing, incoming, now) {
  if (incoming.resolve) return existing && existing.status === 'open' ? 'resolve' : 'skip';
  if (!existing) return incoming.merge && !incoming.title ? 'skip' : 'insert';
  if (existing.status === 'accepted' || existing.status === 'applied') return 'skip';
  if (existing.status === 'rejected') {
    const days = (Date.parse(now) - Date.parse(existing.decidedAt ?? now)) / 864e5;
    return days >= 14 && !incoming.merge ? 'reopen' : 'skip';
  }
  if (incoming.merge) return stable(mergePayload(existing.payload, incoming.merge)) === stable(existing.payload) ? 'skip' : 'update';
  // Fields another agent merged in (a plan's experiment) aren't the proposer's to drop.
  const same = stable({ t: existing.title, b: existing.body, p: existing.payload }) === stable({ t: incoming.title, b: incoming.body, p: mergePayload(existing.payload, incoming.payload) });
  if (same && existing.status === 'open') return 'skip';
  return 'update';
}

/** The payload a full update writes: the proposer's fields, over what other agents merged in. */
export const updatedPayload = (existing, incoming) => mergePayload(existing?.payload, incoming.payload ?? {});

/** Deep-merge plain objects (for a plan the experiment design adds to). */
export function mergePayload(base, add) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(add || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? mergePayload(out[k], v) : v;
  return out;
}

/**
 * @param {{ store: any, crew?: any[], trigger?: string, maxDispatch?: number, now?: string }} opts
 */
export async function runCycle({ store, crew = CREW, trigger = 'schedule', maxDispatch = 500 }) {
  const cycle = await store.startCycle({ trigger });
  try {
    return await drain(store, crew, cycle, trigger, maxDispatch);
  } catch (e) {
    // A cycle that dies (no data, a store error) still closes, so the next one isn't blocked.
    await store.finishCycle(cycle.id, { error: e instanceof Error ? e.message.slice(0, 300) : String(e), events: 0, dispatches: 0, proposals: 0, refused: 0, errors: 1, effects: 0, ms: 0 });
    throw e;
  }
}

async function drain(store, crew, cycle, trigger, maxDispatch) {
  let facts = await store.facts();
  const ctx = { orgId: store.orgId, cycleId: cycle.id };
  const stats = { dispatches: 0, events: 0, proposals: 0, refused: 0, errors: 0, effects: 0 };
  const log = [];
  const seen = new Set();
  const queue = [{ type: 'cycle.start', from: 'system', roomId: null, payload: { trigger } }];
  let ended = false;
  const t0 = Date.now();

  while (queue.length || !ended) {
    if (!queue.length) { ended = true; queue.push({ type: 'cycle.end', from: 'system', roomId: null, payload: {} }); }
    const ev = queue.shift();
    const k = `${ev.type}|${ev.roomId}|${stable(ev.payload)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    log.push(ev);
    stats.events++;
    const to = crew.filter((a) => a.on.includes(ev.type)).map((a) => a.id);
    await store.logEvent({ ...ev, to });
    for (const agent of crew.filter((a) => a.on.includes(ev.type))) {
      if (stats.dispatches >= maxDispatch) break;
      stats.dispatches++;
      const started = Date.now();
      let effects = [], error = null;
      try { effects = (await agent.run({ ev, facts, ctx, log })) || []; } catch (e) { error = e instanceof Error ? e.message : String(e); stats.errors++; }
      const applied = {}, refused = [], notes = [];
      for (const eff of effects) {
        const ok = authorize(agent, eff, ctx);
        if (!ok.ok) {
          refused.push({ effect: eff.type, rule: ok.rule, why: ok.why });
          stats.refused++;
          await store.logEvent({ type: 'policy.refused', from: agent.id, roomId: eff.roomId ?? ev.roomId ?? null, payload: { effect: eff.type, rule: ok.rule, why: ok.why }, to: [] });
          continue;
        }
        stats.effects++;
        if (eff.type === 'emit') { queue.push({ ...eff.event, from: agent.id }); applied.emit = (applied.emit || 0) + 1; continue; }
        if (eff.type === 'note') { notes.push(eff.text); continue; }
        let res = null;
        try { res = await store.apply(agent, eff, facts); } catch (e) { error = `${eff.type}: ${e instanceof Error ? e.message : String(e)}`; stats.errors++; continue; }
        applied[eff.type] = (applied[eff.type] || 0) + 1;
        if (eff.type === 'propose' && res?.changed) stats.proposals++;
        if (res?.result) notes.push(res.result);
        if (res?.refresh) facts = await store.facts();
        else if (res?.proposals) facts = { ...facts, proposals: res.proposals };
      }
      await store.logRun({ agent: agent.id, trigger: ev.type, roomId: ev.roomId ?? null, ms: Date.now() - started, ok: !error, error, applied, refused, notes });
    }
    if (stats.dispatches >= maxDispatch) { await store.logEvent({ type: 'cycle.capped', from: 'system', roomId: null, payload: { maxDispatch }, to: [] }); break; }
  }
  const summary = { ...stats, ms: Date.now() - t0 };
  await store.finishCycle(cycle.id, summary);
  return { cycleId: cycle.id, ...summary, log };
}
