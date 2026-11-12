/**
 * The crew's store kept in memory: the browser-only preview and the tests.
 * Jobs that need the server (Toast sync, the proof loop on stored windows,
 * billing) are recorded as skipped, never faked.
 */
import { mergePayload, proposalAction, roomFacts, updatedPayload } from './cycle.js';

export function memoryStore({ ds, orgId = 'preview', sample = true, today, windows = [], tasks = [], conn = null, links = [], fences = {}, dismissed = {}, invoices = [], autonomy } = {}) {
  const day = today ?? new Date().toISOString().slice(0, 10);
  const state = {
    cycles: [], runs: [], events: [], proposals: [], notifications: [], snapshots: {}, lastCycleAt: null,
    autonomy: autonomy ?? Object.fromEntries(Object.entries(ds.rooms).map(([id, r]) => [id, Object.fromEntries(Object.entries(r.autonomy || {}).map(([k, [now]]) => [k, now]))])),
  };
  let n = 0;
  const id = () => `m${++n}`;
  const store = {
    orgId, state,
    async startCycle({ trigger }) { const c = { id: id(), trigger, startedAt: new Date().toISOString() }; state.cycles.unshift(c); return c; },
    async facts() {
      return {
        orgId, today: day, sample, lastCycleAt: state.lastCycleAt, ds, rooms: roomFacts(ds, { today: day, sample }),
        windows, tasks, conn, links, fences, dismissed, invoices, autonomy: state.autonomy, planHours: {},
        proposals: state.proposals, snapshots: state.snapshots,
      };
    },
    async logEvent(e) { state.events.push({ ...e, cycleId: state.cycles[0]?.id, at: new Date().toISOString() }); },
    async logRun(r) { state.runs.push({ ...r, cycleId: state.cycles[0]?.id, at: new Date().toISOString() }); },
    async finishCycle(cid, summary) { const c = state.cycles.find((x) => x.id === cid); Object.assign(c, { summary, finishedAt: new Date().toISOString() }); state.lastCycleAt = c.startedAt; },
    async apply(agent, eff) {
      switch (eff.type) {
        case 'propose': {
          const ex = state.proposals.find((p) => p.key === eff.key);
          const act = proposalAction(ex, eff, new Date().toISOString());
          if (act === 'skip') return { changed: false };
          if (act === 'resolve') { ex.status = 'resolved'; ex.updatedAt = new Date().toISOString(); return { changed: true, proposals: [...state.proposals] }; }
          if (act === 'insert') state.proposals.push({ id: id(), key: eff.key, agent: agent.id, kind: eff.kind, roomId: eff.roomId ?? null, title: eff.title, body: eff.body ?? '', needs: eff.needs ?? 'human', payload: eff.payload ?? {}, status: 'open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          else Object.assign(ex, eff.merge ? { payload: mergePayload(ex.payload, eff.merge) } : { title: eff.title, body: eff.body ?? '', payload: updatedPayload(ex, eff), needs: eff.needs ?? ex.needs }, act === 'reopen' ? { status: 'open', decidedAt: null } : {}, { updatedAt: new Date().toISOString() });
          return { changed: true, proposals: [...state.proposals] };
        }
        case 'notify': state.notifications.push({ ...eff, at: new Date().toISOString() }); return { result: `Note: ${eff.title}` };
        case 'snapshot': state.snapshots[`${eff.roomId}:${eff.kind}`] = eff.data; return {};
        case 'autonomy.lower': state.autonomy[eff.roomId] = { ...(state.autonomy[eff.roomId] || {}), [eff.lever]: eff.to }; return { result: `${eff.lever} autonomy A${eff.from} → A${eff.to}` };
        default: return { result: `${eff.type}: skipped in the browser preview (needs the server)` };
      }
    },
    /** A person's decision (the preview's inbox). */
    decide(key, status, by = 'you') { const p = state.proposals.find((x) => x.key === key); if (p) Object.assign(p, { status, decidedBy: by, decidedAt: new Date().toISOString() }); return p; },
  };
  return store;
}
