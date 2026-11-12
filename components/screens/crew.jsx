'use client';

import * as React from 'react';

import { Button, Icon, Tabs } from '../kit';
import { engine, useEngine } from '../engine';
import { CV_DS, CV_GROUP, Callout, Pill, useCv } from './core';
import { answer } from '../../lib/agents/copilot';
import { CREW } from '../../lib/agents/crew';
import { runCycle } from '../../lib/agents/cycle';
import { memoryStore } from '../../lib/agents/memory-store';
import { LEVEL_LABEL, NEVER } from '../../lib/agents/policy';

/* The crew on System: nineteen roles, what the last cycle did and how they
 * handed work to each other, what waits on a person, the eleven things none of
 * them may do, and the two copilots. With a server it's the real record; in
 * the browser-only preview the same crew runs in memory on the sample. */

const LEVEL_ICON = { read: 'Eye', propose: 'Lightbulb', draft: 'PenLine', load: 'DatabaseZap', 'act-within-fence': 'Zap', rules: 'Scale' };
const LEVEL_TONE = { 'act-within-fence': 'warn', rules: 'info', load: 'info' };
const KIND = { plan: ['Plan to approve', 'ClipboardCheck'], replicate: ['Try in another room', 'Copy'], mapping: ['Ledger mapping', 'BookOpen'], todo: ['To do', 'ListTodo'], ranking: ['Order of work', 'ListOrdered'] };
const ORDER = ['plan', 'replicate', 'mapping', 'todo'];
const nameOf = Object.fromEntries(CREW.map((a) => [a.id, a.name]));
const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - Date.parse(t)) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const roomName = (id) => CV_GROUP?.rooms?.find((r) => r.id === id)?.profile?.short ?? id ?? 'Group';

/* The preview keeps one in-memory store per page load, rebuilt when the sample changes. */
let preview = null;
function previewStore() {
  if (!preview || preview.ds !== CV_DS) preview = { ds: CV_DS, store: memoryStore({ ds: CV_DS, today: '2026-10-28' }) };
  return preview.store;
}
function previewStatus(store) {
  const s = store.state;
  const last = s.cycles.find((c) => c.finishedAt);
  return {
    crew: CREW.map((a) => {
      const mine = s.runs.filter((r) => r.agent === a.id && r.cycleId === last?.id);
      const applied = mine.reduce((acc, r) => { for (const [k, v] of Object.entries(r.applied)) acc[k] = (acc[k] || 0) + v; return acc; }, {});
      return { id: a.id, name: a.name, does: a.does, permission: a.permission, level: LEVEL_LABEL[a.permission], on: a.on, emits: a.emits, lastCycle: { runs: mine.length, ok: mine.every((r) => r.ok), notes: mine.flatMap((r) => r.notes).slice(0, 6), applied, errors: mine.filter((r) => !r.ok).map((r) => r.error) } };
    }),
    last: last ? { id: last.id, trigger: last.trigger, startedAt: last.startedAt, summary: last.summary, events: s.events.filter((e) => e.cycleId === last.id).map((e, i) => ({ seq: i, ...e })) } : null,
    proposals: [...s.proposals].reverse(),
    refused: s.events.filter((e) => e.type === 'policy.refused').map((e) => ({ from: e.from, at: e.at, ...e.payload })),
    never: NEVER,
  };
}

async function jfetch(url, init) {
  const r = await fetch(url, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.result?.error || `Request failed (${r.status})`);
  return j;
}

const usd = (v) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;

/** "1539" in "$/wk" → "$1,539/wk"; other units stay as they are. */
const amt = (v, unit) => (v == null ? '—' : /^\$/.test(unit ?? '') ? `$${Math.round(v).toLocaleString('en-US')}${unit.slice(1)}` : `${(+v).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}`);

function Experiment({ e }) {
  if (!e) return null;
  if (!e.measurable) return <span className="cv-xs cv-faint">{e.why}</span>;
  return (
    <div className="cv-xs" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 10px' }}>
      <span className="cv-faint">Measures</span><span>{e.label} ({e.unit}), {e.direction === 'up' ? 'up is better' : 'down is better'}</span>
      <span className="cv-faint">Baseline</span><span className="cv-num">{amt(e.baseline, e.unit)}, the average of the last {e.baselineWeeks} weeks, frozen before anything changes</span>
      <span className="cv-faint">Can detect</span><span className="cv-num">{e.mde != null ? `${amt(e.mde, e.unit)} or more` : '—'}{e.expected != null ? ` · expected about ${amt(e.expected, e.unit)}` : ''}{e.powered === false ? <b className="cv-down"> · likely too small to prove</b> : e.powered ? ' · enough' : ''}</span>
      <span className="cv-faint">Method</span><span>{e.method === 'diff_in_diff' ? `Against ${e.controls.map((c) => `${c.name} (r ${c.r})`).join(', ')}` : 'Before and after (no matched room moves like this one)'}; 4 weekly checkpoints over 28 days</span>
      <span className="cv-faint">Guardrails</span><span>{(e.guardrails || []).join('; ')}</span>
    </div>
  );
}

function Proposal({ p, canDecide, onDecide, busy }) {
  const [open, setOpen] = React.useState(false);
  const [k, icon] = KIND[p.kind] ?? [p.kind, 'Circle'];
  const pl = p.payload || {};
  return (
    <div className="cv-col" style={{ gap: 6, padding: '12px 14px', borderTop: '1px solid var(--border)' }} data-proposal={p.key}>
      <div className="cv-row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span className="cv-row" style={{ gap: 6, flexWrap: 'wrap' }}><Pill icon={icon}>{k}</Pill><span className="cv-xs cv-faint">{roomName(p.roomId)} · from {nameOf[p.agent] ?? p.agent}</span></span>
        {p.kind === 'plan' && <span className="cv-xs cv-num">~{usd(pl.value)}/wk <span className="cv-faint">({usd(pl.lo)} to {usd(pl.hi)}, estimate)</span></span>}
      </div>
      <span style={{ fontWeight: 600 }}>{p.title}</span>
      <span className="cv-small cv-muted" style={{ maxWidth: '80ch' }}>{p.body}</span>
      {(pl.approval || pl.experiment) && (
        <button className="cv-link cv-xs" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Show'} the change and how it’s measured</button>
      )}
      {open && (
        <div className="cv-col" style={{ gap: 8, background: 'var(--surface-sunken)', borderRadius: 'var(--radius)', padding: 10 }}>
          {pl.approval && <ol className="cv-xs" style={{ margin: 0, paddingLeft: 18 }}>{pl.approval.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
          <Experiment e={pl.experiment} />
        </div>
      )}
      {canDecide && (
        <div className="cv-row" style={{ gap: 8 }}>
          <Button size="sm" icon="Check" disabled={!!busy} onClick={() => onDecide(p, 'accept')}>{p.kind === 'plan' || p.kind === 'replicate' ? (pl.test || p.kind === 'replicate' ? 'Approve and start the test' : 'Approve') : p.kind === 'mapping' ? 'Confirm mapping' : 'Done'}</Button>
          <Button size="sm" variant="ghost" icon="X" disabled={!!busy} onClick={() => onDecide(p, 'reject')}>{p.kind === 'todo' ? 'Not needed' : 'Not now'}</Button>
        </div>
      )}
    </div>
  );
}

function Copilot({ server, roomId }) {
  const [who, setWho] = React.useState('operator');
  const [q, setQ] = React.useState('');
  const [a, setA] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const go = async (question) => {
    const text = question ?? q;
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (server) setA(await jfetch('/api/agents/ask', { method: 'POST', body: JSON.stringify({ who, question: text, roomId }) }));
      else { const facts = await previewStore().facts(); setA(answer(who, text, facts)); }
    } catch (e) { setA({ text: e.message, cites: [] }); } finally { setBusy(false); }
  };
  const SUGGEST = who === 'operator' ? ['What should we do first?', 'Is our data fresh?', 'Why is a test stuck?', 'What labour changes are there?'] : ['Where does each saving land in the ledger?', 'What have we saved?', 'Which tests are open?'];
  return (
    <section className="cv-card" data-copilot="1">
      <div className="cv-card-head"><span className="cv-h4">Ask a copilot</span><Tabs value={who} onChange={(v) => { setWho(v); setA(null); }} tabs={[{ value: 'operator', label: 'Operator' }, { value: 'accountant', label: 'Accountant' }]} /></div>
      <form className="cv-row nowrap" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); go(); }}>
        <input className="input" style={{ flex: 1, minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={SUGGEST[0]} aria-label="Question" maxLength={500} />
        <Button size="sm" icon="MessageSquare" disabled={busy || !q.trim()} type="submit">{busy ? 'Asking…' : 'Ask'}</Button>
      </form>
      <div className="cv-row" style={{ gap: 6, flexWrap: 'wrap' }}>{SUGGEST.map((s) => <Button key={s} size="sm" variant="secondary" disabled={busy} onClick={() => { setQ(s); go(s); }}>{s}</Button>)}</div>
      {a && (
        <div className="cv-col" style={{ gap: 6 }} aria-live="polite" data-answer="1">
          <div className="cv-small" style={{ whiteSpace: 'pre-line', lineHeight: 1.55 }}>{a.text}</div>
          <span className="cv-xs cv-faint">{a.phrased ? 'Phrased by Claude from these facts; every number is checked against them. ' : 'Built from the crew’s facts, nothing guessed. '}{(a.cites || []).map((c, i) => <span key={i}>{i ? ' · ' : ''}{c.href ? <a href={c.href}>{c.label}</a> : c.label}</span>)}</span>
        </div>
      )}
    </section>
  );
}

export function Crew() {
  const cv = useCv();
  const eng = useEngine();
  const server = eng.mode === 'server';
  const canRun = !server || eng.viewer?.role !== 'gm';
  const [st, setSt] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [room, setRoom] = React.useState('all');
  const [showAll, setShowAll] = React.useState(false);

  const load = React.useCallback(async () => {
    try { setSt(server ? await jfetch('/api/agents') : previewStatus(previewStore())); } catch (e) { setErr(e.message); }
  }, [server]);
  React.useEffect(() => { load(); }, [load]);

  const run = async () => {
    setBusy('run'); setErr(null);
    try {
      if (server) { const j = await jfetch('/api/agents/run', { method: 'POST' }); setSt(j.status); await engine.hydrate(); cv.toast(`The crew ran: ${j.result.events} handoffs, ${j.result.proposals} proposals changed${j.result.refused ? `, ${j.result.refused} refused by policy` : ''}.`); }
      else { const r = await runCycle({ store: previewStore(), trigger: 'manual' }); setSt(previewStatus(previewStore())); cv.toast(`The crew ran on the sample: ${r.events} handoffs, ${r.proposals} proposals changed.`); }
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  const decide = async (p, decision) => {
    setBusy(p.key); setErr(null);
    try {
      if (server) { const j = await jfetch(`/api/agents/proposals/${p.id}`, { method: 'POST', body: JSON.stringify({ decision }) }); setSt(j.status); await engine.hydrate(); cv.toast(j.outcome); }
      else { previewStore().decide(p.key, decision === 'accept' ? (p.kind === 'todo' ? 'done' : 'accepted') : 'rejected'); setSt(previewStatus(previewStore())); cv.toast(decision === 'accept' ? 'Accepted in the preview. With an account this creates the task and starts the test.' : 'Rejected. The crew won’t propose it again for 14 days.'); }
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };

  const proposals = (st?.proposals || []).filter((p) => room === 'all' || p.roomId === room || !p.roomId);
  const waiting = proposals.filter((p) => p.status === 'open' && p.needs === 'human').sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const decided = proposals.filter((p) => ['accepted', 'rejected', 'done', 'resolved'].includes(p.status)).slice(0, 6);
  const events = (st?.last?.events || []).filter((e) => room === 'all' || !e.roomId || e.roomId === room);
  const sum = st?.last?.summary;
  const rooms = CV_GROUP?.rooms || [];

  return (
    <div className="cv-col" style={{ gap: 16 }} data-crew="1">
      <section className="cv-card">
        <div className="cv-card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="cv-col" style={{ gap: 4 }}>
            <span className="cv-h4">The crew: {CREW.length} roles, one job each</span>
            <span className="cv-small cv-muted" style={{ maxWidth: '78ch' }}>They don’t call each other. Each one listens for events, does its job, and hands the result to the next. Every effect they ask for is checked against what their level allows, and anything that changes the business waits for a person.{server ? ' Runs nightly at 2:40 am Pacific.' : ' This preview runs the real crew in your browser on the sample.'}</span>
          </div>
          <div className="cv-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {rooms.length > 1 && <select className="input" style={{ width: 'auto' }} value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Room"><option value="all">Every room</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.profile.short}</option>)}</select>}
            {canRun && <Button icon="Play" disabled={!!busy} onClick={run}>{busy === 'run' ? 'Running…' : st?.last ? 'Run the crew again' : 'Run the crew'}</Button>}
          </div>
        </div>
        {sum ? (
          <div className="cv-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Pill icon="Clock">{st.last.trigger === 'manual' ? 'Run by hand' : 'Nightly run'} {ago(st.last.startedAt)}</Pill>
            <Pill icon="ArrowRightLeft">{sum.events} handoffs</Pill>
            <Pill icon="Workflow">{sum.dispatches} agent runs</Pill>
            <Pill icon="Inbox">{waiting.length} waiting on a person</Pill>
            <Pill icon="ShieldCheck" tone={sum.refused ? 'warn' : 'good'}>{sum.refused} refused by policy</Pill>
            {sum.errors ? <Pill icon="CircleX" tone="bad">{sum.errors} errors</Pill> : null}
            <Pill icon="Timer">{sum.ms} ms</Pill>
          </div>
        ) : <span className="cv-small cv-faint">{st ? 'The crew hasn’t run for this group yet.' : 'Loading…'}</span>}
        {err && <Callout tone="bad" icon="CircleX">{err}</Callout>}
      </section>

      <section className="cv-card flush" data-inbox="1">
        <div className="cv-row" style={{ padding: '14px 16px', justifyContent: 'space-between' }}>
          <span className="cv-h4">Waiting on a person</span>
          <span className="cv-xs cv-faint">Approving a plan starts its test and its task as you, not as an agent</span>
        </div>
        {waiting.length ? waiting.map((p) => <Proposal key={p.key} p={p} canDecide={!(server && p.kind === 'mapping' && eng.viewer?.role === 'gm')} onDecide={decide} busy={busy} />)
          : <div className="cv-small cv-faint" style={{ padding: '0 16px 14px' }}>{st?.last ? 'Nothing. The crew has nothing it needs a decision on.' : 'Run the crew to see what it proposes.'}</div>}
        {decided.length > 0 && (
          <div className="cv-col" style={{ gap: 4, padding: '10px 16px 14px', borderTop: '1px solid var(--border)' }}>
            <span className="cv-xs cv-faint" style={{ fontWeight: 600 }}>Recently decided</span>
            {decided.map((p) => <span key={p.key} className="cv-xs"><b>{p.status}</b> · {p.title}{p.decidedBy ? ` · ${p.decidedBy}` : ''}{p.note ? ` · ${p.note}` : ''}</span>)}
          </div>
        )}
      </section>

      <div className="cv-grid g2">
        <section className="cv-card flush">
          <div className="cv-row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', justifyContent: 'space-between' }}>
            <span className="cv-h4">Who does what</span><span className="cv-xs cv-faint">Most can only read or propose</span>
          </div>
          <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="The crew" style={{ maxHeight: 620, overflowY: 'auto' }}>
            <table className="cv-table">
              <tbody>
                {(st?.crew || CREW.map((a) => ({ ...a, level: LEVEL_LABEL[a.permission] }))).map((a) => (
                  <tr key={a.id} data-agent={a.id}>
                    <td>
                      <div className="cv-col" style={{ gap: 3 }}>
                        <span style={{ fontWeight: 600 }}>{a.name}</span>
                        <span className="cv-xs cv-faint">{a.does}</span>
                        {a.lastCycle?.runs > 0 && <span className="cv-xs">{a.lastCycle.ok ? <Icon name="CircleCheck" size={12} /> : <Icon name="CircleX" size={12} />} Last run: {a.lastCycle.runs}× · {Object.entries(a.lastCycle.applied).filter(([k]) => k !== 'emit').map(([k, v]) => `${v} ${k}`).join(', ') || 'read only'}{a.lastCycle.applied.emit ? ` · handed on ${a.lastCycle.applied.emit}` : ''}</span>}
                        {a.lastCycle?.notes?.[0] && <span className="cv-xs cv-muted">“{a.lastCycle.notes[0]}”</span>}
                        {a.lastCycle?.errors?.length ? <span className="cv-xs cv-down">{a.lastCycle.errors[0]}</span> : null}
                      </div>
                    </td>
                    <td className="r" style={{ verticalAlign: 'top' }}><Pill tone={LEVEL_TONE[a.permission] ?? 'neutral'} icon={LEVEL_ICON[a.permission]}>{a.level}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="cv-card flush">
          <div className="cv-row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', justifyContent: 'space-between' }}>
            <span className="cv-h4">How they worked together</span>{st?.last ? <Pill icon="ScrollText">{server ? 'From the record' : 'This preview'}</Pill> : null}
          </div>
          <div className="cv-feed" style={{ maxHeight: 620, overflowY: 'auto' }} data-trace="1">
            {events.length ? (showAll ? events : events.slice(0, 40)).map((e) => (
              <div key={e.seq} className="ev">
                <span className="t">{e.roomId ? roomName(e.roomId) : '·'}</span>
                <span className="a">{e.from === 'system' ? 'Cycle' : nameOf[e.from] ?? e.from}</span>
                <span className="m">{e.type === 'policy.refused' ? <b className="cv-down">refused {e.payload.effect}: {e.payload.why}</b> : <><code>{e.type}</code>{e.to?.length ? <> → {e.to.map((t) => nameOf[t] ?? t).join(', ')}</> : null}{e.payload?.text ? ` · ${e.payload.text}` : ''}</>}</span>
              </div>
            )) : <div className="ev"><span className="m">No cycle yet.</span></div>}
            {events.length > 40 && <button className="cv-link cv-xs" style={{ margin: 10 }} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${events.length}`}</button>}
          </div>
        </section>
      </div>

      <Copilot server={server} roomId={room === 'all' ? undefined : room} />

      <section className="cv-card" data-never="1">
        <div className="cv-card-head"><span className="cv-h4">Eleven things no agent may do, ever</span><span className="cv-xs cv-faint">Enforced in code on every effect, not a promise</span></div>
        <ol className="cv-small" style={{ margin: 0, paddingLeft: 20, columns: '2 320px', columnGap: 28 }}>{(st?.never || NEVER).map((n) => <li key={n.id} style={{ breakInside: 'avoid', marginBottom: 4 }}>{n.text}</li>)}</ol>
        {st?.refused?.length ? <span className="cv-xs cv-down">Refused recently: {st.refused.slice(0, 3).map((r) => `${nameOf[r.from] ?? r.from} tried ${r.effect}`).join('; ')}</span> : <span className="cv-xs cv-faint">No agent has tried one of these.</span>}
      </section>
    </div>
  );
}
