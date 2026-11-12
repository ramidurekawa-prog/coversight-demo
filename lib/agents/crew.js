/**
 * The crew: nineteen agents (eighteen agents and the verification rules), each
 * with one job. They don't call each other. Each subscribes to events,
 * reads the cycle's facts, and returns effects: events for the next agent,
 * proposals for a person, notifications, and the few jobs its permission
 * covers. policy.authorize() checks every effect before anything happens.
 *
 * A cycle's usual path:
 *   cycle.start → Orchestration → ingest.due → Ingestion → data.loaded
 *   → Data quality → data.ok / data.issue → Opportunity detection → findings.updated
 *   → Recommendation → ranked → Action planning → plan.drafted / plan.blocked
 *   → Experiment design → experiment.designed → Control selection → controls.selected
 *   data.loaded also wakes Measurement → windows.measured → Verification rules → verdict
 *   → Accounting reconciliation, Portfolio intelligence; Guardrail, Execution
 *   evidence and Persistence watch alongside; cycle.end → Briefing.
 *
 * Pure JS. Facts come from the server (server/agents/store.ts) or, in the
 * browser-only preview, from the sample (lib/agents/memory-store.js).
 */
import { findingBlocked, findingStatus, findingTest } from '../data/findings.js';
import { minimumDetectableEffect } from '../data/levers.js';
import { baselineOf, LEVER_METRIC, weeklySeries } from '../data/readers.js';
import { stepsFor } from '../data/writebacks.js';

/* ------------------------------------------------------------------ helpers */
const emit = (type, roomId, payload = {}) => ({ type: 'emit', event: { type, roomId: roomId ?? null, payload } });
const propose = (p) => ({ type: 'propose', ...p });
const resolve = (key, why) => ({ type: 'propose', resolve: true, key, why });
const notify = (n) => ({ type: 'notify', ...n });
const note = (text, data) => ({ type: 'note', text, data });
const money = (v) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
const cents = (c) => money((c || 0) / 100);
const roomOf = (facts, id) => facts.rooms.find((r) => r.id === id);
const scoped = (facts, ev) => (ev.roomId ? facts.rooms.filter((r) => r.id === ev.roomId) : facts.rooms);
const daysSince = (iso, today) => (iso ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z')) / 864e5) : Infinity);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0; };
function corr(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 6) return null;
  const x = a.slice(-n), y = b.slice(-n), mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Which autonomy dial a test lever belongs to. */
export const TEST_TO_DIAL = { menu_margin: 'Menu', mix: 'Menu', labour: 'Labour', overtime: 'Labour', void_comp: 'Controls', turns: 'Throughput' };
/** Where a verified saving lands in the books (proposed; a named person confirms). */
export const LEVER_ACCOUNT = {
  Menu: { account: '4010 Food sales', why: 'A price or mix move shows up as more margin on the same covers' },
  Labour: { account: '6010 Hourly labour, front of house', why: 'Fewer paid hours at the same covers' },
  Controls: { account: '4900 Comps, voids and discounts', why: 'Less given away against gross sales' },
  Throughput: { account: '4010 Food sales', why: 'More covers through the same seats' },
  Purchasing: { account: '5010 Food cost', why: 'Lower unit costs on the same usage' },
};
/** A candidate's value per manager-hour, the order the crew works in. */
export const perHour = (c) => c.perHour ?? (c.edv != null && c.hours ? c.edv / c.hours : c.hours ? (c.value * (c.p ?? 0.5)) / c.hours : 0);

/**
 * Why the room's fences stop this change, or null. Recommendation uses it so a
 * fenced move never takes manager time; planning re-checks it before drafting.
 */
export function fenceBlock(c, room, fence = {}, tasks = [], today) {
  if (c.kind !== 'price' || !c.item) return null;
  const dish = (room.menu || []).find((m) => m.key === c.item);
  if (!dish) return null;
  const pct = ((c.to - dish.price) / dish.price) * 100;
  const max = fence.maxPrice ?? 8;
  if (Math.abs(pct) > max + 1e-9) return `A ${pct.toFixed(1)}% move is past this room’s ${max}% price fence.`;
  const gapWeeks = fence.priceGap ?? 6;
  const last = tasks.filter((t) => t.roomId === room.profile?.id && t.approvalId.startsWith(`price:${c.item}:`) && t.status !== 'cancelled').map((t) => daysSince(t.createdAt, today)).sort((a, b) => a - b)[0];
  if (last != null && last < gapWeeks * 7) return `Repriced ${last} days ago; the fence allows one move every ${gapWeeks} weeks.`;
  return null;
}

/** The approval a plan asks a person for: same ids the screens use. */
export function approvalFor(c, room) {
  if (c.kind === 'price' && c.item) {
    const dish = (room.menu || []).find((m) => m.key === c.item);
    const diff = [[`${dish?.name ?? c.item} price`, dish ? `$${dish.price.toFixed(2)}` : '—', `$${(+c.to).toFixed(2)}`]];
    return { approvalId: `price:${c.item}:${c.to}`, system: 'Toast menu', diff };
  }
  const system = c.lever === 'Labour' ? '7shifts' : c.lever === 'Controls' ? 'Toast' : c.lever === 'Channels' ? 'Toast delivery menus' : c.lever === 'Kitchen' ? 'Kitchen display' : c.lever === 'Purchasing' ? 'Vendor' : 'Floor';
  return { approvalId: `agent:${c.id}`, system, diff: [[c.title, '—', 'as planned']] };
}

/** Expected weekly effect in the test metric's own units, where the candidate says enough to tell. */
function expectedUnits(test, c, room) {
  const wage = room.levers?.wage ?? 18;
  switch (test.lever) {
    case 'menu_margin': case 'mix': case 'void_comp': return c.value;
    case 'labour': return c.value / wage;
    case 'overtime': return c.value / ((wage * 0.5) / 60);
    default: return null;
  }
}

/* ------------------------------------------------------------------ the crew */
export const CREW = [
  {
    id: 'orchestrator', name: 'Orchestration', permission: 'propose',
    does: 'Starts each cycle, turns problems other agents raise into one clear to-do for the right person, and closes to-dos when the problem clears',
    on: ['cycle.start', 'data.issue', 'data.ok', 'plan.blocked', 'evidence.missing', 'persistence.drift'],
    emits: ['ingest.due'],
    run({ ev, facts }) {
      if (ev.type === 'cycle.start') return [emit('ingest.due', null, { trigger: ev.payload.trigger })];
      const r = roomOf(facts, ev.roomId);
      const where = r ? r.name : 'the group';
      if (ev.type === 'data.ok') return facts.proposals.filter((p) => p.status === 'open' && p.kind === 'todo' && p.key.startsWith(`todo:data:${ev.roomId}:`)).map((p) => resolve(p.key, 'Data is healthy again'));
      if (ev.type === 'data.issue') {
        const { code, text, severity } = ev.payload;
        if (severity === 'info') return [];
        const who = code === 'sync' ? 'owner' : 'gm';
        return [propose({ kind: 'todo', key: `todo:data:${ev.roomId}:${code}`, roomId: ev.roomId, title: `${where}: ${code === 'stale' ? 'send this week’s data' : code === 'sync' ? 'fix the Toast connection' : code === 'link' ? 'fix a linked sheet' : 'check the data'}`, body: text, needs: 'human', payload: { assignee: who, code, link: code === 'sync' ? '/connect' : '/inputs' } })];
      }
      if (ev.type === 'plan.blocked') {
        const { id, title, why, fix } = ev.payload;
        return [propose({ kind: 'todo', key: `todo:blocked:${ev.roomId}:${id}`, roomId: ev.roomId, title: `${where}: unblock “${title}”`, body: why, needs: 'human', payload: { assignee: 'gm', link: fix === 'fence' ? '/fences' : '/inputs', candidateId: id } })];
      }
      if (ev.type === 'evidence.missing') {
        const { taskId, title, days, mismatch } = ev.payload;
        return [propose({ kind: 'todo', key: `todo:evidence:${taskId}`, roomId: ev.roomId, title: `${where}: ${mismatch ? 'the data doesn’t show' : 'confirm'} “${title}”`, body: mismatch ? 'The task was marked done, but the latest data shows the old value. Check the change was published.' : `Approved ${days} days ago and not marked done yet. Do it, or cancel it so its test doesn’t wait.`, needs: 'human', payload: { assignee: 'gm', link: '/today', taskId } })];
      }
      if (ev.type === 'persistence.drift') {
        const { windowId, title, share } = ev.payload;
        return [propose({ kind: 'todo', key: `todo:drift:${windowId}`, roomId: ev.roomId, title: `${where}: “${title}” is wearing off`, body: `Only ${Math.round(share * 100)}% of the verified effect is still showing over the last three weeks. Check the change is still in place; if it isn’t, re-apply it or re-test.`, needs: 'human', payload: { assignee: 'gm', link: '/windows', windowId } })];
      }
      return [];
    },
  },
  {
    id: 'ingestion', name: 'Ingestion', permission: 'load',
    does: 'Pulls new data from the sources the owner connected: the Toast API sync and linked Google Sheets or Dropbox files',
    on: ['ingest.due'], emits: ['data.loaded'],
    run({ ev, facts }) {
      const out = [];
      const manual = ev.payload.trigger === 'manual';
      const sources = [];
      if (facts.conn && (manual || daysSince(facts.conn.syncedAt, facts.today) >= 1 || facts.conn.state === 'backfilling')) { out.push({ type: 'job.sync' }); sources.push('Toast API'); }
      if (facts.links.length && (manual || facts.links.some((l) => daysSince(l.pulledAt, facts.today) >= 1))) { out.push({ type: 'job.links' }); sources.push('linked sheets'); }
      out.push(emit('data.loaded', null, { sources }));
      if (!sources.length) out.push(note(facts.conn || facts.links.length ? 'Sources were read recently; nothing to pull.' : 'No connected sources: data comes in by upload.'));
      return out;
    },
  },
  {
    id: 'dataQuality', name: 'Data quality', permission: 'read',
    does: 'Checks every room’s data for staleness, failing feeds, gaps and numbers that don’t look real, and only lets a room through when it’s fit to act on',
    on: ['data.loaded'], emits: ['data.ok', 'data.issue'],
    run({ facts }) {
      const out = [];
      for (const r of facts.rooms) {
        const issues = [];
        if (r.staleDays > 9) issues.push({ code: 'stale', severity: 'warn', text: `No new week of data since ${r.dataEnd} (${r.staleDays} days). Findings and tests wait for it.` });
        const sync = facts.conn?.rooms?.[r.id];
        if (facts.conn && facts.conn.state === 'failing' && facts.conn.restaurants.includes(r.id)) issues.push({ code: 'sync', severity: 'bad', text: `The Toast sync is failing: ${facts.conn.lastError ?? 'see Connect'}.` });
        else if (sync && sync.missing > 0) issues.push({ code: 'backfill', severity: 'info', text: `${sync.days} of ${sync.days + sync.missing} days of Toast history are in; the rest arrive over the next runs.` });
        for (const l of facts.links.filter((x) => x.roomId === r.id && x.lastError)) issues.push({ code: 'link', severity: 'warn', text: `A linked sheet couldn’t be read: ${l.lastError}` });
        const stale = (r.d.feeds || []).filter((f) => f.state === 'stale' || f.state === 'failing');
        if (stale.length) issues.push({ code: 'feed', severity: 'info', text: `${stale.map((f) => f.name).join(', ')}: ${stale[0].note ?? 'stale'}` });
        // A week far outside the room's normal range is more often a data problem than a real week.
        const nets = (r.room.history || []).map((h) => h.net).filter(Number.isFinite);
        if (nets.length >= 9) {
          const prior = nets.slice(-9, -1), s = sd(prior), last = nets[nets.length - 1];
          if (s > 0 && Math.abs(last - mean(prior)) / s > 3) issues.push({ code: 'anomaly', severity: 'warn', text: `Last week’s sales (${money(last)}) are ${((last - mean(prior)) / s).toFixed(1)}σ from the 8 weeks before. Check the export covered every day before acting on it.` });
        }
        for (const i of issues) out.push(emit('data.issue', r.id, i));
        if (!issues.some((i) => i.code === 'stale' || i.code === 'sync' || i.code === 'anomaly')) out.push(emit('data.ok', r.id, { dataEnd: r.dataEnd, own: r.own }));
      }
      return out;
    },
  },
  {
    id: 'detection', name: 'Opportunity detection', permission: 'propose',
    does: 'Runs the lever detectors on a room that passed the data check and reports what’s new, gone or changed since last time',
    on: ['data.ok'], emits: ['findings.updated'],
    run({ ev, facts }) {
      const r = roomOf(facts, ev.roomId);
      if (!r) return [];
      const now = r.d.candidates.filter((c) => c.value > 0.5).sort((a, b) => b.value - a.value).slice(0, 20).map((c) => ({ id: c.id, title: c.title ?? c.id, lever: c.lever ?? null, value: Math.round(c.value) }));
      const before = facts.snapshots[`${r.id}:detection`]?.findings ?? null;
      const prev = new Map((before || []).map((f) => [f.id, f]));
      const added = now.filter((f) => !prev.has(f.id)).map((f) => f.id);
      const gone = before ? before.filter((f) => !now.some((x) => x.id === f.id)).map((f) => f.id) : [];
      const changed = now.filter((f) => prev.has(f.id) && Math.abs(f.value - prev.get(f.id).value) > Math.max(10, 0.15 * Math.abs(prev.get(f.id).value))).map((f) => f.id);
      return [
        { type: 'snapshot', roomId: r.id, kind: 'detection', data: { dataEnd: r.dataEnd, own: r.own, findings: now, week: { net: Math.round(r.d.week.net), earned: Math.round(r.d.week.earned), covers: r.d.week.covers } } },
        emit('findings.updated', r.id, { count: now.length, new: before ? added : [], gone, changed, first: !before }),
      ];
    },
  },
  {
    id: 'recommendation', name: 'Recommendation', permission: 'propose',
    does: 'Ranks a room’s findings by value per manager-hour, skips what’s dismissed, blocked or already being tested, and fits the week’s manager time',
    on: ['findings.updated'], emits: ['ranked'],
    run({ ev, facts }) {
      const r = roomOf(facts, ev.roomId);
      if (!r) return [];
      const dismissed = facts.dismissed[r.id] || {};
      const budget = Math.max(0.5, Number(facts.planHours?.[r.id] ?? r.room.managerHours ?? 2));
      const items = r.d.candidates
        .filter((c) => c.value > 0.5 && !(dismissed[c.id] && dismissed[c.id] > facts.today))
        .map((c) => { const fenced = fenceBlock(c, r.room, facts.fences[r.id], facts.tasks, facts.today); return { c, st: findingStatus(c, facts.windows, r.id).state, blocked: findingBlocked(c, r.room) ?? fenced, fenced: !!fenced, score: perHour(c) }; })
        .filter((x) => x.st !== 'testing' && x.st !== 'verified')
        .sort((a, b) => b.score - a.score);
      let left = budget;
      const top = [], blocked = [];
      for (const x of items) {
        if (x.blocked) { blocked.push({ id: x.c.id, why: x.blocked, fix: x.fenced ? 'fence' : 'input' }); continue; }
        if ((x.c.hours ?? 0.5) <= left + 1e-9 && top.length < 3) { top.push(x.c.id); left -= x.c.hours ?? 0.5; }
      }
      const list = items.slice(0, 8).map((x) => ({ id: x.c.id, title: x.c.title, lever: x.c.lever, value: Math.round(x.c.value), perHour: Math.round(x.score), hours: x.c.hours ?? 0.5, blocked: x.blocked, status: x.st, chosen: top.includes(x.c.id) }));
      return [
        propose({ kind: 'ranking', key: `ranking:${r.id}`, roomId: r.id, title: `${r.name}: this week’s order of work`, body: top.length ? `${top.length} fit in ${budget} manager-hour${budget === 1 ? '' : 's'}: ${list.filter((x) => x.chosen).map((x) => x.title).join('; ')}.` : 'Nothing fits this week’s manager time that isn’t blocked or already in a test.', needs: 'none', payload: { items: list, budgetHours: budget, usedHours: +(budget - left).toFixed(2) } }),
        emit('ranked', r.id, { top, blocked }),
      ];
    },
  },
  {
    id: 'planner', name: 'Action planning', permission: 'draft',
    does: 'Drafts the exact change for each chosen finding (system, before and after, steps) and checks it against the room’s fences before a person sees it',
    on: ['ranked'], emits: ['plan.drafted', 'plan.blocked'],
    run({ ev, facts }) {
      const r = roomOf(facts, ev.roomId);
      if (!r) return [];
      const out = [];
      const fence = facts.fences[r.id] || {};
      for (const b of ev.payload.blocked.slice(0, 3)) {
        const c = r.d.candidates.find((x) => x.id === b.id);
        if (c) out.push(emit('plan.blocked', r.id, { id: b.id, title: c.title, why: b.why, fix: b.fix }));
      }
      for (const id of ev.payload.top) {
        const c = r.d.candidates.find((x) => x.id === id);
        if (!c) continue;
        const appr = approvalFor(c, r.room);
        const fenced = fenceBlock(c, r.room, fence, facts.tasks, facts.today); // re-checked: fences can change between agents
        if (fenced) { out.push(emit('plan.blocked', r.id, { id, title: c.title, why: fenced, fix: 'fence' })); continue; }
        const test = findingTest(c);
        out.push(propose({
          kind: 'plan', key: `plan:${r.id}:${c.id}`, roomId: r.id, title: c.title, needs: 'human',
          body: `${c.why ?? ''} Worth about ${money(c.value)} a week (${money(c.lo ?? c.value)}–${money(c.hi ?? c.value)}), about ${c.hours ?? 0.5} manager-hours.${test ? ' Approving starts a 28-day test that measures it.' : ' This one can be done but not measured yet, so nothing will be booked from it.'}`.trim(),
          payload: { candidateId: c.id, lever: c.lever, value: Math.round(c.value), lo: Math.round(c.lo ?? c.value), hi: Math.round(c.hi ?? c.value), claim: c.claim ?? 'est', approval: { ...appr, steps: stepsFor(appr.system, appr.diff) }, test },
        }));
        out.push(emit('plan.drafted', r.id, { id: c.id, test }));
      }
      return out;
    },
  },
  {
    id: 'experiment', name: 'Experiment design', permission: 'draft',
    does: 'Writes each plan’s measurement down before anything changes: metric, frozen baseline, smallest effect the test can see, guardrails, and the control rooms it’s given',
    on: ['plan.drafted', 'controls.selected'], emits: ['experiment.designed'],
    run({ ev, facts }) {
      const r = roomOf(facts, ev.roomId);
      if (!r) return [];
      const key = `plan:${r.id}:${ev.payload.id}`;
      if (ev.type === 'controls.selected') {
        return [propose({ kind: 'plan', key, roomId: r.id, merge: { experiment: { controls: ev.payload.controls, method: ev.payload.method } } })];
      }
      const t = ev.payload.test;
      if (!t) return [note(`${ev.payload.id}: no metric reads this lever yet; it can be done, not measured.`)];
      const m = LEVER_METRIC[t.lever];
      const series = m ? weeklySeries(r.room, m.metric, t.dish ? { dish: t.dish } : {}) : [];
      if (!m || series.length < 4) {
        return [propose({ kind: 'plan', key, roomId: r.id, merge: { experiment: { lever: t.lever, measurable: false, why: 'Fewer than four weeks of this metric in the data, so there is no baseline to measure against yet.' } } })];
      }
      const end = series[series.length - 1].weekEnd;
      const baseline = baselineOf(series, end, 4);
      const mde = minimumDetectableEffect({ baselineSamples: series.slice(-8).map((p) => p.value) });
      const c = r.d.candidates.find((x) => x.id === ev.payload.id);
      const exp = c ? expectedUnits(t, c, r.room) : null;
      const powered = mde && exp != null ? Math.abs(exp) >= mde.mdeUnits : null;
      const experiment = {
        lever: t.lever, dish: t.dish ?? null, metric: m.metric, label: m.label, unit: m.unit, direction: m.direction, measurable: true,
        baseline, baselineWeeks: 4, windowDays: 28, checkpoints: 4, mde: mde ? +mde.mdeUnits.toFixed(2) : null, expected: exp != null ? +exp.toFixed(2) : null, powered,
        guardrails: ['Average check may not fall more than 5%', 'Turn time may not rise more than 15%'], method: 'before_after', controls: [],
      };
      return [
        propose({ kind: 'plan', key, roomId: r.id, merge: { experiment } }),
        emit('experiment.designed', r.id, { id: ev.payload.id, lever: t.lever, metric: m.metric, dish: t.dish ?? null, powered }),
        ...(powered === false ? [note(`${c?.title}: the expected effect (${exp?.toFixed(1)} ${m.unit}) is below what 4 weekly checkpoints can detect (${mde.mdeUnits.toFixed(1)}); the test will likely end inconclusive.`)] : []),
      ];
    },
  },
  {
    id: 'controls', name: 'Control selection', permission: 'read',
    does: 'Finds rooms in the group whose weeks move like this one’s, so a test can subtract what the season did instead of crediting it',
    on: ['experiment.designed'], emits: ['controls.selected'],
    run({ ev, facts }) {
      const r = roomOf(facts, ev.roomId);
      if (!r) return [];
      const mine = weeklySeries(r.room, 'net').slice(-12).map((p) => p.value);
      const testingThere = (id) => facts.windows.some((w) => w.roomId === id && w.lever === ev.payload.lever && ['running', 'waiting'].includes(w.status));
      const controls = facts.rooms.filter((o) => o.id !== r.id && !testingThere(o.id))
        .map((o) => ({ roomId: o.id, name: o.name, r: corr(mine, weeklySeries(o.room, 'net').slice(-12).map((p) => p.value)) }))
        .filter((o) => o.r != null && o.r >= 0.6).sort((a, b) => b.r - a.r).slice(0, 2)
        .map((o) => ({ ...o, r: +o.r.toFixed(2) }));
      return [emit('controls.selected', r.id, { id: ev.payload.id, controls, method: controls.length ? 'diff_in_diff' : 'before_after' })];
    },
  },
  {
    id: 'evidence', name: 'Execution evidence', permission: 'read',
    does: 'Checks that approved changes really happened: re-reads the data for each task and flags tasks left undone or contradicted by the data',
    on: ['data.loaded'], emits: ['evidence.missing', 'evidence.confirmed'],
    run({ facts }) {
      const out = [{ type: 'job.verifyTasks' }];
      for (const t of facts.tasks) {
        if (t.status === 'open' && daysSince(t.createdAt, facts.today) >= 7) out.push(emit('evidence.missing', t.roomId, { taskId: t.id, title: t.title, days: daysSince(t.createdAt, facts.today) }));
        if (t.status === 'mismatch') out.push(emit('evidence.missing', t.roomId, { taskId: t.id, title: t.title, mismatch: true }));
        if (t.status === 'verified' && daysSince(t.updatedAt, facts.today) <= 1) out.push(emit('evidence.confirmed', t.roomId, { taskId: t.id, title: t.title }));
      }
      return out;
    },
  },
  {
    id: 'measurement', name: 'Measurement', permission: 'read',
    does: 'Records each running test’s weekly checkpoint as data lands and runs the estimator when a 28-day window closes',
    on: ['data.loaded'], emits: ['windows.measured'],
    run({ facts }) {
      const open = facts.windows.filter((w) => ['running', 'waiting'].includes(w.status));
      return open.length ? [{ type: 'job.proof' }, emit('windows.measured', null, { open: open.length })] : [emit('windows.measured', null, { open: 0 }), note('No tests running.')];
    },
  },
  {
    id: 'verification', name: 'Verification rules', permission: 'rules',
    does: 'Not an agent: the deterministic rules that turn a closed window into verified, rejected or reversed. It only announces the verdicts the rules reached',
    on: ['windows.measured'], emits: ['verdict'],
    run({ facts }) {
      const since = facts.lastCycleAt ?? '1970-01-01';
      return facts.windows.filter((w) => ['verified', 'rejected', 'reversed'].includes(w.status) && (w.closedAt ?? '') > since)
        .map((w) => emit('verdict', w.roomId, { windowId: w.id, status: w.status, title: w.title, lever: w.lever, dish: w.dish, bookedCents: w.bookedCents, method: w.method }));
    },
  },
  {
    id: 'guardrail', name: 'Guardrail', permission: 'act-within-fence',
    does: 'Re-checks average check and turn time against every verified test; a breach reverses it and drops that lever’s autonomy back to recommending',
    on: ['data.loaded', 'guardrail.check'], emits: ['guardrail.breach'],
    run({ ev, facts }) {
      if (ev.type === 'data.loaded') return [{ type: 'job.reverify' }, emit('guardrail.check', null, {})];
      const out = [];
      const since = facts.lastCycleAt ?? '1970-01-01';
      for (const w of facts.windows.filter((x) => x.status === 'reversed' && (x.reversedAt ?? '') > since)) {
        const dial = TEST_TO_DIAL[w.lever];
        const from = facts.autonomy[w.roomId]?.[dial];
        if (dial && Number.isInteger(from) && from > 1) out.push({ type: 'autonomy.lower', roomId: w.roomId, lever: dial, from, to: 1 });
        out.push(emit('guardrail.breach', w.roomId, { windowId: w.id, title: w.title, lever: w.lever }));
        out.push(notify({ roomId: w.roomId, severity: 'bad', title: `Guardrail broke: ${w.title}`, body: `The verified result was reversed and its saving stops counting.${dial && from > 1 ? ` ${dial} autonomy dropped from A${from} to A1 (recommends) until it’s earned again.` : ''}`, link: '/windows', dedupe: `breach:${w.id}` }));
      }
      // Running tests close to a limit: a heads-up, not an action.
      for (const w of facts.windows.filter((x) => ['running', 'waiting'].includes(x.status) && x.guard)) {
        const r = roomOf(facts, w.roomId);
        const last = r?.room.history?.at(-1);
        if (!last || !last.covers) continue;
        const check = last.net / last.covers;
        const drop = w.guard.avgCheckBase ? ((w.guard.avgCheckBase - check) / w.guard.avgCheckBase) * 100 : 0;
        // Past 70% of the 5% limit: a heads-up. The breach itself is the proof loop's call, not this agent's.
        if (drop > 3.5 && drop <= 5) out.push(note(`${w.title}: average check is down ${drop.toFixed(1)}% against a 5% limit. Watching.`));
      }
      return out;
    },
  },
  {
    id: 'reconciliation', name: 'Accounting reconciliation', permission: 'propose',
    does: 'Proposes where each verified saving lands in the general ledger; a named person confirms each mapping once',
    on: ['verdict', 'cycle.start'], emits: [],
    run({ ev, facts }) {
      const verified = ev.type === 'verdict' ? (ev.payload.status === 'verified' ? [{ roomId: ev.roomId, lever: ev.payload.lever, bookedCents: ev.payload.bookedCents }] : []) : facts.windows.filter((w) => w.status === 'verified').map((w) => ({ roomId: w.roomId, lever: w.lever, bookedCents: w.bookedCents }));
      const out = [];
      for (const v of verified) {
        const dial = TEST_TO_DIAL[v.lever];
        const acct = LEVER_ACCOUNT[dial];
        if (!acct) continue;
        const key = `mapping:${v.roomId}:${dial}`;
        if (facts.proposals.some((p) => p.key === key && p.status === 'accepted')) continue;
        const r = roomOf(facts, v.roomId);
        out.push(propose({ kind: 'mapping', key, roomId: v.roomId, title: `${r?.name ?? v.roomId}: book ${dial.toLowerCase()} savings to ${acct.account}`, body: `${acct.why}. A named person confirms this once; after that every verified ${dial.toLowerCase()} saving in ${r?.name ?? 'this room'} lands there.`, needs: 'human', payload: { lever: dial, account: acct.account, basis: 'rule: lever → account', weeklyCents: v.bookedCents, assignee: 'accountant' } }));
      }
      return out;
    },
  },
  {
    id: 'persistence', name: 'Persistence monitoring', permission: 'read',
    does: 'Keeps measuring each verified change after its test ends and flags one that is wearing off',
    on: ['data.ok'], emits: ['persistence.drift'],
    run({ ev, facts }) {
      const r = roomOf(facts, ev.roomId);
      if (!r) return [];
      const out = [];
      for (const w of facts.windows.filter((x) => x.roomId === r.id && x.status === 'verified' && x.bookedCents > 0 && x.centsPerUnitWeek > 0)) {
        const m = LEVER_METRIC[w.lever];
        if (!m) continue;
        const series = weeklySeries(r.room, m.metric, w.dish ? { dish: w.dish } : {});
        const after = series.filter((p) => p.weekEnd > addDaysIso(w.startedAt, 28));
        if (after.length < 3) continue;
        const sign = w.direction === 'up' ? 1 : -1;
        const bookedUnits = w.bookedCents / w.centsPerUnitWeek;
        const shares = after.map((p) => (sign * (p.value - w.baseline)) / bookedUnits);
        const recent = mean(shares.slice(-3));
        if (recent < 0.5) out.push(emit('persistence.drift', r.id, { windowId: w.id, title: w.title, share: +recent.toFixed(2), weeks: after.length }));
        else out.push(note(`${w.title}: ${Math.round(recent * 100)}% of the verified effect still showing after ${after.length} weeks.`));
      }
      return out;
    },
  },
  {
    id: 'portfolio', name: 'Portfolio intelligence', permission: 'propose',
    does: 'Learns which levers verify in which rooms and proposes trying a proven change in a sister room that has the same finding',
    on: ['verdict', 'cycle.start'], emits: [],
    run({ ev, facts }) {
      const wins = ev.type === 'verdict' ? (ev.payload.status === 'verified' ? [{ roomId: ev.roomId, lever: ev.payload.lever, dish: ev.payload.dish, bookedCents: ev.payload.bookedCents, windowId: ev.payload.windowId }] : [])
        : facts.windows.filter((w) => w.status === 'verified').map((w) => ({ roomId: w.roomId, lever: w.lever, dish: w.dish, bookedCents: w.bookedCents, windowId: w.id }));
      const out = [];
      for (const win of wins) {
        const from = roomOf(facts, win.roomId);
        for (const o of facts.rooms.filter((x) => x.id !== win.roomId)) {
          const c = o.d.candidates.find((x) => { const t = findingTest(x); return t && t.lever === win.lever && (!win.dish || t.dish === win.dish); });
          if (!c || findingStatus(c, facts.windows, o.id).state !== 'none' || findingBlocked(c, o.room)) continue;
          const key = `replicate:${o.id}:${win.lever}${win.dish ? `:${win.dish}` : ''}`;
          out.push(propose({ kind: 'replicate', key, roomId: o.id, title: `${o.name}: try what verified at ${from?.name ?? win.roomId}`, body: `${from?.name ?? win.roomId} verified ${cents(win.bookedCents)} a week on this lever. ${o.name} has the same finding (“${c.title}”, about ${money(c.value)} a week here). Different room, different guests: it gets its own 28-day test.`, needs: 'human', payload: { fromRoom: win.roomId, windowId: win.windowId, candidateId: c.id, lever: win.lever } }));
        }
      }
      return out;
    },
  },
  {
    id: 'briefing', name: 'Briefing', permission: 'propose',
    does: 'Writes each room one short morning note from the cycle: data, the order of work, tests and what’s waiting on a person',
    on: ['cycle.end'], emits: [],
    run({ facts, log }) {
      const out = [];
      for (const r of facts.rooms) {
        const issues = log.filter((e) => e.type === 'data.issue' && e.roomId === r.id && e.payload.severity !== 'info');
        const ranked = facts.proposals.find((p) => p.key === `ranking:${r.id}`);
        const top = (ranked?.payload?.items || []).filter((x) => x.chosen).map((x) => x.title);
        const tests = facts.windows.filter((w) => w.roomId === r.id && ['running', 'waiting'].includes(w.status));
        const verdicts = log.filter((e) => e.type === 'verdict' && e.roomId === r.id);
        const waiting = facts.proposals.filter((p) => p.roomId === r.id && p.status === 'open' && p.needs === 'human').length;
        const lines = [
          issues.length ? `Data: ${issues.map((i) => i.payload.text).join(' ')}` : `Data: fresh to ${r.dataEnd}.`,
          top.length ? `Do first: ${top.join('; ')}.` : 'No new work fits this week.',
          tests.length ? `${tests.length} test${tests.length === 1 ? '' : 's'} running.` : 'No tests running.',
          ...verdicts.map((v) => `${v.payload.title}: ${v.payload.status}${v.payload.status === 'verified' ? `, ${cents(v.payload.bookedCents)} a week` : ''}.`),
          waiting ? `${waiting} thing${waiting === 1 ? '' : 's'} waiting on a person in System.` : null,
        ].filter(Boolean);
        out.push(notify({ roomId: r.id, severity: issues.length ? 'warn' : 'info', title: `${r.name}: morning brief`, body: lines.join('\n'), link: '/today', dedupe: `brief:${r.id}:${facts.today}` }));
      }
      return out;
    },
  },
  {
    id: 'periodClose', name: 'Period close', permission: 'draft',
    does: 'Early each month, drafts last month’s invoice from verified tests only and asks the accountant to approve the period package',
    on: ['cycle.start'], emits: [],
    run({ ev, facts }) {
      if (facts.sample) return [note('The sample group is never invoiced, so there is no period to close.')];
      const day = +facts.today.slice(8, 10);
      if (day > 5 && ev.payload.trigger !== 'manual') return [];
      const d = new Date(`${facts.today.slice(0, 7)}-15T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 1);
      const period = d.toISOString().slice(0, 7);
      const inv = facts.invoices.find((i) => i.period === period);
      const out = [];
      if (!inv) out.push({ type: 'job.billingDraft', period });
      if (inv?.packageApproved || (inv && inv.status !== 'draft')) out.push(resolve(`todo:package:${period}`, 'Package approved'));
      else out.push(propose({ kind: 'todo', key: `todo:package:${period}`, title: `Approve the ${period} period package`, body: 'The invoice is drafted from verified tests only. It is finalized only after the accountant approves the package.', needs: 'human', payload: { assignee: 'accountant', link: '/accountant', period } }));
      return out;
    },
  },
  {
    id: 'operatorCopilot', name: 'Operator copilot', permission: 'read',
    does: 'Answers the GM in plain language from the same facts the crew used, and says where each answer comes from',
    on: ['question'], emits: [], run: () => [],
  },
  {
    id: 'accountantCopilot', name: 'Accountant copilot', permission: 'read',
    does: 'Answers the controller with lineage: which test, which checkpoints, which method, which account',
    on: ['question'], emits: [], run: () => [],
  },
];

function addDaysIso(iso, n) { return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10); }

export const crewById = Object.fromEntries(CREW.map((a) => [a.id, a]));
