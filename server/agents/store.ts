// The crew's store on Postgres: facts loaded from the group's data, effects
// applied through the same services a person's actions go through, and every
// event, run and proposal written down.
import { and, desc, eq, gt } from 'drizzle-orm';

import { mergePayload, proposalAction, roomFacts, updatedPayload } from '../../lib/agents/cycle.js';
import { previousPeriod } from '../../lib/data/billing.js';
import type { Db } from '../db/client';
import { agentCycles, agentEvents, agentProposals, agentRuns, actions, auditLog, invoices, linkedSources, orgs, snapshots, toastConnections } from '../db/schema';
import { GROUP, loadActions } from '../actions';
import { runBilling } from '../billing';
import { loadDataset } from '../dataset';
import { pullLinks } from '../links';
import { notify } from '../notify';
import { syncToast } from '../pos-sync';
import { runProofLoop, runReverify, listWindows } from '../proof';
import { listTasks, verifyTasks } from '../tasks';

type Agent = { id: string; permission: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Effect = Record<string, any> & { type: string };

const iso = (d: Date | string | null | undefined) => (d ? (d instanceof Date ? d.toISOString() : String(d)) : null);

export function dbStore(db: Db, orgId: string, { now = new Date(), fetchImpl }: { now?: Date; fetchImpl?: typeof fetch } = {}) {
  let cycleId: string | null = null;
  let seq = 0;
  let lastCycleAt: string | null = null;
  const today = now.toISOString().slice(0, 10);

  async function proposals() {
    const rows = await db.select().from(agentProposals).where(eq(agentProposals.orgId, orgId));
    return rows.map((p) => ({ ...p, decidedAt: iso(p.decidedAt), createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt) }));
  }

  return {
    orgId,
    async startCycle({ trigger }: { trigger: string }) {
      const [prev] = await db.select({ at: agentCycles.startedAt }).from(agentCycles).where(and(eq(agentCycles.orgId, orgId), gt(agentCycles.startedAt, new Date(0)))).orderBy(desc(agentCycles.startedAt)).limit(1);
      lastCycleAt = iso(prev?.at ?? null);
      const [c] = await db.insert(agentCycles).values({ orgId, trigger }).returning();
      cycleId = c!.id;
      seq = 0;
      return { id: c!.id };
    },
    async facts() {
      const [org] = await db.select({ sample: orgs.sample }).from(orgs).where(eq(orgs.id, orgId));
      const loaded = await loadDataset(db, orgId);
      if (!loaded) throw new Error('This group has no data yet.');
      const ds = loaded.ds;
      const [conn] = await db.select().from(toastConnections).where(eq(toastConnections.orgId, orgId));
      const acts = await loadActions(db, orgId);
      const windows = (await listWindows(db, orgId, null, now)).map((w) => ({ ...w, closedAt: iso(w.closedAt), reversedAt: iso(w.reversedAt), createdAt: iso(w.createdAt), updatedAt: iso(w.updatedAt) }));
      const tasks = (await listTasks(db, orgId)).map((t) => ({ id: t.id, roomId: t.roomId, approvalId: t.approvalId, title: t.title, status: t.status, createdAt: iso(t.createdAt), updatedAt: iso(t.checkedAt ?? t.doneAt ?? t.createdAt) }));
      const links = (await db.select().from(linkedSources).where(eq(linkedSources.orgId, orgId))).map((l) => ({ id: l.id, roomId: l.roomId, lastError: l.lastError, pulledAt: iso(l.pulledAt) }));
      const snaps = await db.select().from(snapshots).where(eq(snapshots.orgId, orgId));
      const invs = await db.select({ period: invoices.period, status: invoices.status }).from(invoices).where(eq(invoices.orgId, orgId));
      const pkg = acts[GROUP]?.billing as { status?: string; period?: string } | undefined;
      const autonomy: Record<string, Record<string, number>> = {};
      for (const [id, r] of Object.entries(ds.rooms as Record<string, { autonomy?: Record<string, [number, number]> }>)) {
        const saved = acts[id]?.autonomy as Record<string, number> | undefined;
        autonomy[id] = { ...Object.fromEntries(Object.entries(r.autonomy || {}).map(([k, v]) => [k, v[0]])), ...(saved || {}) };
      }
      const glmap = (acts[GROUP]?.glmap ?? {}) as Record<string, { account: string; by: string }>;
      return {
        orgId, today, sample: !!org?.sample, lastCycleAt, ds,
        rooms: roomFacts(ds, { today, sample: !!org?.sample }),
        windows, tasks, links,
        conn: conn ? { state: conn.syncState === 'off' ? 'connected' : conn.syncState, lastError: conn.lastError, syncedAt: iso(conn.syncedAt), rooms: conn.syncDetail ?? {}, restaurants: conn.restaurants.map((r) => r.roomId) } : null,
        fences: Object.fromEntries(Object.entries(acts).map(([room, v]) => [room, ((v.fences as { f?: object } | undefined)?.f ?? {})])),
        dismissed: Object.fromEntries(Object.entries(acts).map(([room, v]) => [room, (v.findings as Record<string, string>) ?? {}])),
        planHours: Object.fromEntries(Object.entries(acts).filter(([, v]) => v.plan).map(([room, v]) => [room, (v.plan as { hours: number }).hours])),
        invoices: invs.map((i) => ({ ...i, packageApproved: pkg?.status === 'approved' && pkg?.period === i.period })),
        autonomy, glmap,
        snapshots: Object.fromEntries(snaps.map((s) => [`${s.roomId}:${s.kind}`, s.data])),
        proposals: await proposals(),
      };
    },
    async logEvent(e: { type: string; from: string; roomId?: string | null; payload?: unknown; to?: string[] }) {
      if (!cycleId) return;
      await db.insert(agentEvents).values({ orgId, cycleId, seq: seq++, type: e.type, from: e.from, to: e.to ?? [], roomId: e.roomId ?? null, payload: (e.payload ?? {}) as object });
    },
    async logRun(r: { agent: string; trigger: string; roomId: string | null; ms: number; ok: boolean; error: string | null; applied: object; refused: object[]; notes: string[] }) {
      if (!cycleId) return;
      await db.insert(agentRuns).values({ orgId, cycleId, agent: r.agent, trigger: r.trigger, roomId: r.roomId, ms: r.ms, ok: r.ok, error: r.error?.slice(0, 500) ?? null, applied: r.applied, refused: r.refused, notes: r.notes.slice(0, 20).map((n) => String(n).slice(0, 400)) });
    },
    async finishCycle(id: string, summary: object) {
      await db.update(agentCycles).set({ finishedAt: new Date(), summary }).where(eq(agentCycles.id, id));
      await db.insert(auditLog).values({ orgId, userId: null, action: 'agents.cycle', detail: summary });
    },
    async apply(agent: Agent, eff: Effect) {
      switch (eff.type) {
        case 'propose': {
          const [ex] = await db.select().from(agentProposals).where(and(eq(agentProposals.orgId, orgId), eq(agentProposals.key, eff.key)));
          const act = proposalAction(ex ? { ...ex, decidedAt: iso(ex.decidedAt) } : null, eff, now.toISOString());
          if (act === 'skip') return { changed: false };
          if (act === 'resolve') await db.update(agentProposals).set({ status: 'resolved', note: eff.why ?? null, updatedAt: new Date() }).where(eq(agentProposals.id, ex!.id));
          else if (act === 'insert') await db.insert(agentProposals).values({ orgId, key: eff.key, agent: agent.id, kind: eff.kind, roomId: eff.roomId ?? null, title: String(eff.title).slice(0, 300), body: String(eff.body ?? '').slice(0, 2000), needs: eff.needs ?? 'human', payload: eff.payload ?? {} });
          else await db.update(agentProposals).set({
            ...(eff.merge ? { payload: mergePayload(ex!.payload as object, eff.merge) } : { title: String(eff.title).slice(0, 300), body: String(eff.body ?? '').slice(0, 2000), payload: updatedPayload(ex, eff), needs: eff.needs ?? ex!.needs }),
            ...(act === 'reopen' ? { status: 'open', decidedAt: null, decidedBy: null } : {}),
            updatedAt: new Date(),
          }).where(eq(agentProposals.id, ex!.id));
          return { changed: true, proposals: await proposals() };
        }
        case 'notify':
          await notify(db, { orgId, roomId: eff.roomId ?? null, kind: `agent.${agent.id}`, severity: eff.severity ?? 'info', title: eff.title, body: eff.body ?? '', link: eff.link ?? null, dedupe: eff.dedupe }).catch(() => null);
          return { result: `Notified: ${eff.title}` };
        case 'snapshot':
          await db.insert(snapshots).values({ orgId, roomId: eff.roomId, kind: eff.kind, data: eff.data }).onConflictDoUpdate({ target: [snapshots.orgId, snapshots.roomId, snapshots.kind], set: { data: eff.data, at: new Date() } });
          return {};
        case 'job.sync': {
          const r = await syncToast(db, orgId, { now, ...(fetchImpl ? { fetchImpl } : {}) });
          return { refresh: true, result: 'skipped' in r ? r.skipped : r.ok ? `Toast sync: ${r.state}` : `Toast sync failed: ${r.error}` };
        }
        case 'job.links': {
          const r = await pullLinks(db, orgId, fetchImpl ? { fetchImpl } : {});
          return { refresh: true, result: `Linked sheets read: ${r.links}` };
        }
        case 'job.proof': {
          const r = await runProofLoop(db, orgId, now);
          return { refresh: true, result: `Proof loop: ${r.windows} windows, ${(r as { recorded?: number }).recorded ?? 0} checkpoints, ${(r as { closed?: unknown[] }).closed?.length ?? 0} closed` };
        }
        case 'job.reverify': {
          const r = await runReverify(db, orgId);
          return { refresh: r.reversed.length > 0, result: `Re-verified ${r.checked}; ${r.reversed.length} reversed` };
        }
        case 'job.verifyTasks': {
          const r = await verifyTasks(db, orgId);
          return { refresh: true, result: `Tasks checked against the data: ${JSON.stringify(r)}` };
        }
        case 'job.billingDraft': {
          const r = await runBilling(db, orgId, eff.period ?? previousPeriod(now));
          return { refresh: true, result: 'skipped' in (r as object) ? `Billing: ${(r as { skipped: string }).skipped}` : `Invoice drafted for ${eff.period}` };
        }
        case 'autonomy.lower': {
          const acts = await loadActions(db, orgId, [eff.roomId]);
          const cur = { ...((acts[eff.roomId]?.autonomy as Record<string, number>) ?? {}), [eff.lever]: eff.to };
          await db.insert(actions).values({ orgId, roomId: eff.roomId, key: 'autonomy', value: cur, summary: `Guardrail agent lowered ${eff.lever} from A${eff.from} to A${eff.to} after a breach`, userId: null });
          await db.insert(auditLog).values({ orgId, userId: null, action: 'agents.autonomy.lower', detail: { roomId: eff.roomId, lever: eff.lever, from: eff.from, to: eff.to } });
          return { refresh: true, result: `${eff.lever} autonomy A${eff.from} → A${eff.to}` };
        }
        default:
          throw new Error(`no handler for ${eff.type}`);
      }
    },
  };
}
