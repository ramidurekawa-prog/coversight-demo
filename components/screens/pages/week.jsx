'use client';

import * as React from 'react';

import { Icon, Button, Tabs } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { PLAN_KEY, PLAN_TOP, REVIEW_KEY, buildCommit, planState, setItemStatus, trimReviews, weekView } from '../../../lib/data/page/week';
import { useCv, cvMoney, CV_D, CV_DS, CV_ROOM, Claim, Money, Callout, Interval, PageHead, Pill } from '../core';
import { DenseWeek } from '../dense-sections';
import s from './week.module.css';

/* This week: your week in review. What changed, why, what's verified, and
   the committed improvement plan, for the room in view. Every figure comes
   from weekView() (lib/data/page/week.js), which the week API and the Monday
   digest also use. A real group's verified dollars and tests come from its
   own test windows, never the sample's. */

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const minutes = (h) => `${Math.round(h * 60)} min`;
const hrs = (h) => `${+h.toFixed(2)} manager-hour${h === 1 ? '' : 's'}`;
const chance = (p) => `${Math.round(p * 100)}% chance it verifies`;
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const stampDay = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const STATUS_LABEL = { planned: 'Planned', doing: 'In progress', done: 'Done', dropped: 'Dropped' };

/** A dollar that opens its derivation, but only when that derivation describes this figure. */
function Fig({ id, show, children }) {
  return show ? <Money id={id}>{children}</Money> : <span>{children}</span>;
}

/* ---------------------------------------------------------------- server state: reviews + the committed plan */
/** In server mode the plan and reviewer names come from /api/page/week; in the browser-only demo, from this browser. */
function useWeekRecord(v, tasks) {
  const eng = useEngine();
  const server = eng.mode === 'server';
  const [remote, setRemote] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const room = eng.room;
  const load = React.useCallback(() => {
    if (!server) return Promise.resolve();
    return fetch(`/api/page/week?room=${encodeURIComponent(room)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b.error || `Request failed (${r.status})`)))))
      .then((b) => setRemote({ room, ...b }))
      .catch((e) => setError(e.message));
  }, [server, room]);
  React.useEffect(() => { setRemote(null); setError(null); void load(); }, [load, eng.version]);

  const localPlan = server ? null : engine.saved(PLAN_KEY, room) ?? null;
  const plan = server
    ? (remote?.room === room ? remote.plan : null)
    : { ...planState(v, localPlan, tasks), committedBy: null, history: [] };

  const post = async (body) => {
    setBusy(true); setError(null);
    try {
      if (server) {
        const r = await fetch('/api/page/week/plan', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomId: room, ...body }) });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error || `Request failed (${r.status})`);
        setRemote((cur) => ({ ...(cur || { room }), room, plan: b.plan }));
      } else if (body.op === 'commit') {
        const items = buildCommit(v, body);
        const prev = engine.saved(PLAN_KEY, room);
        engine.act(PLAN_KEY, { week: v.period.start, committedAt: new Date().toISOString(), revision: prev?.week === v.period.start ? prev.revision + 1 : 1, items }, { room });
      } else {
        engine.act(PLAN_KEY, setItemStatus(engine.saved(PLAN_KEY, room), body.id, body.status), { room });
      }
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally { setBusy(false); }
  };
  const names = Object.fromEntries((remote?.room === room ? remote.reviews || [] : []).map((r) => [r.week, r.by]));
  return { plan, names, busy, error, post, reload: load, loading: server && !plan && !error };
}

/* ---------------------------------------------------------------- scoreboard */
function Board({ v }) {
  const c = v.contribution;
  const dec = v.decomposition;
  const ch = dec?.contribution.change;
  const b = v.banked;
  const sample = v.sample;
  const urgent = v.attention.length;
  return (
    <section className={`cv-card ${s.board}`} aria-label="The week in four numbers">
      <div className={s.tile}>
        <div className={s.tileHead}><span className="cv-over">Contribution</span><Claim k={c.claim} /></div>
        <span className="cv-fig lg">{c.value == null ? '—' : <Money id="earned-week">{cvMoney(Math.round(c.value))}</Money>}</span>
        <span className={s.tileFoot}>After food and labour, not profit{c.status === 'estimated' ? ' · labour estimated' : ''}</span>
      </div>
      <div className={s.tile}>
        <div className={s.tileHead}><span className="cv-over">Vs {v.comparator ? v.comparator.label.toLowerCase() : 'a baseline'}</span><Claim k={v.comparator?.id === 'matched' ? 'mod' : 'obs'} /></div>
        <span className={`cv-fig lg ${ch == null ? '' : ch >= 0 ? 'cv-up' : 'cv-down'}`}>
          {ch == null ? '—' : <Fig id="margin-move" show={sample && v.comparator?.id === 'matched'}>{cvMoney(Math.round(ch), { sign: true })}</Fig>}
        </span>
        <span className={s.tileFoot}>{ch == null ? 'No earlier week of your own data yet' : <>
          <Icon name={ch >= 0 ? 'TrendingUp' : 'TrendingDown'} size={14} className={ch >= 0 ? 'cv-up' : 'cv-down'} />
          Change in contribution, not a saving
        </>}</span>
      </div>
      <div className={s.tile}>
        <div className={s.tileHead}><span className="cv-over">Verified this week</span><Claim k="book" /></div>
        <span className={`cv-fig lg ${b.accrued ? 'cv-up' : ''}`}><Fig id="banked-week" show={sample}>{cvMoney(b.accrued, { cents: !sample })}</Fig></span>
        <span className={s.tileFoot}>{b.liveCount ? `Run-rate ${cvMoney(b.week, { cents: !sample })}/wk from ${b.liveCount} verified change${b.liveCount === 1 ? '' : 's'}` : b.running ? `${b.running} test${b.running === 1 ? '' : 's'} running, none verified yet` : 'Nothing verified yet'}</span>
      </div>
      <a className={`${s.tile} ${s.tileLink}`} href="#week-attention">
        <div className={s.tileHead}><span className="cv-over">Needs attention</span>{urgent ? <Pill tone="warn" icon="TriangleAlert">Open</Pill> : <Pill tone="good" icon="CircleCheck">Clear</Pill>}</div>
        <span className="cv-fig lg">{urgent}</span>
        <span className={s.tileFoot}>{urgent ? `${v.attention[0].title}${urgent > 1 ? ` and ${urgent - 1} more` : ''}` : 'Nothing material this week'}</span>
      </a>
    </section>
  );
}

/* ---------------------------------------------------------------- what changed (spec §7.3–7.4) */
function Spark({ pts }) {
  const w = 180, h = 40, lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * (w - 6) + 3, h - 4 - ((v - lo) / span) * (h - 8)]);
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ maxWidth: '100%' }}>
      <polyline points={xy.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill="var(--accent)" />
    </svg>
  );
}

function fmtLine(l, x, sign = false) {
  if (!l.money) return `${sign && x >= 0 ? '+' : sign ? '−' : ''}${Math.abs(Math.round(x)).toLocaleString('en-US')}`;
  return cvMoney(l.cents ? x : Math.round(x), { cents: !!l.cents, sign });
}

function WhatChanged({ v, comparator, setComparator }) {
  const dec = v.decomposition;
  const avail = v.comparators.filter((c) => c.available);
  const missing = v.comparators.filter((c) => !c.available);
  const max = dec ? Math.max(...dec.lines.filter((l) => l.effect != null).map((l) => Math.abs(l.effect)), 1) : 1;
  const b = v.brief;
  const m = v.margin;
  return (
    <section className="cv-card" aria-labelledby="week-changed">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4" id="week-changed">What changed</span>
          <span className="cv-small cv-faint">{v.comparator ? v.comparator.desc : 'No comparison available yet'}</span>
        </div>
        <Claim k="obs" />
      </div>
      {avail.length > 1 && <Tabs tabs={avail.map((c) => ({ value: c.id, label: c.label }))} value={comparator || v.comparator?.id} onChange={setComparator} />}
      {dec ? (
        <div className={s.changed}>
          <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="This week against the comparison">
            <table className="cv-table">
              <thead><tr><th>Line</th><th className="r">This week</th><th className={`r ${s.hideSm}`}>{v.comparator.label}</th><th className="r">Change</th><th className={s.hideSm} style={{ width: '28%' }}><span className="sr-only">Effect on contribution</span></th></tr></thead>
              <tbody>
                {dec.lines.map((l) => (
                  <tr key={l.key}>
                    <td>{l.label}{l.key === 'food' && v.brief ? <span className="cv-xs cv-faint"> · {pct(v.brief.week.foodRate)} of sales</span> : l.key === 'labour' && v.brief ? <span className="cv-xs cv-faint"> · {pct(v.brief.week.labourRate)}</span> : null}</td>
                    <td className="r cv-num">{fmtLine(l, l.now)}</td>
                    <td className={`r cv-num cv-muted ${s.hideSm}`}>{fmtLine(l, l.then)}</td>
                    <td className={`r cv-num ${l.effect == null ? '' : l.effect >= 0 ? 'cv-up' : 'cv-down'}`}>{fmtLine(l, l.change, true)}</td>
                    <td className={s.hideSm}>{l.effect != null && <span className={s.track} aria-hidden="true"><span className={`${s.bar} ${l.effect >= 0 ? s.barUp : s.barDown}`} style={{ width: `max(4px, ${(Math.abs(l.effect) / max) * 50}%)` }} /></span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ fontWeight: 600 }}>
                <td>Contribution</td>
                <td className="r cv-num">{cvMoney(Math.round(dec.contribution.now))}</td>
                <td className={`r cv-num cv-muted ${s.hideSm}`}>{cvMoney(Math.round(dec.contribution.then))}</td>
                <td className={`r cv-num ${dec.contribution.change >= 0 ? 'cv-up' : 'cv-down'}`}>{cvMoney(Math.round(dec.contribution.change), { sign: true })}</td>
                <td className={s.hideSm} />
              </tr></tfoot>
            </table>
          </div>
          <div className={s.side}>
            {b && <div className="cv-col" style={{ gap: 2 }}>
              <span className="cv-xs cv-faint">Contribution, last {b.trend.length} weeks</span>
              <Spark pts={b.trend.map((t) => t.earned)} />
              {b.trend[0]?.label && <span className="cv-xs cv-faint">{b.trend[0].label} to {b.trend[b.trend.length - 1].label}</span>}
            </div>}
            {v.comparator.id === 'matched' && m.move > 0 && <div className="cv-col" style={{ gap: 6 }}>
              <span className="cv-xs cv-faint">Of the change against matched weeks</span>
              <div className="cv-decomp" role="img" aria-label={`${cvMoney(Math.round(m.claimable))} accounted for by verified changes, ${cvMoney(Math.round(m.unexplained))} unexplained`}>
                <span style={{ width: `${(m.claimable / m.move) * 100}%`, background: 'var(--claim-book)' }} />
                <span style={{ width: `${(m.unexplained / m.move) * 100}%`, background: 'var(--border-strong)' }} />
              </div>
              <span className="cv-xs cv-muted">Verified changes account for {cvMoney(Math.round(m.claimable))}. We don’t claim the other {cvMoney(Math.round(m.unexplained))}.</span>
            </div>}
          </div>
        </div>
      ) : <Callout icon="CalendarRange">There is no earlier week of your own data to compare this one with yet. Comparisons appear as weeks of your Toast data arrive.</Callout>}
      <span className="cv-xs cv-faint">Sales, food and labour add up exactly to the change in contribution. That describes the week; it doesn’t prove what caused it, and none of it is a saving we claim.{missing.length ? ` Not available: ${missing.map((c) => `${c.label.toLowerCase()} (${c.reason.replace(/\.$/, '').toLowerCase()})`).join('; ')}.` : ''}</span>
    </section>
  );
}

/* ---------------------------------------------------------------- the improvement plan (spec §7.6, §7.9) */
function Evidence({ item }) {
  if (item.blocked) return <Pill tone="warn" icon="DatabaseZap">Blocked</Pill>;
  return <Pill tone="good" icon="CircleCheck">Ready</Pill>;
}

function ItemBody({ item, v }) {
  return (
    <div className={s.grow}>
      <span style={{ fontWeight: 600 }}>{item.title}</span>
      {item.why && <span className="cv-small cv-muted">{item.why}</span>}
      <span className="cv-xs cv-faint">{item.lever} · {minutes(item.hours)}{item.p != null ? ` · ${chance(item.p)}` : ''}{item.prevent ? ' · prevented, not saved' : ''}</span>
      {item.blocked && <span className="cv-xs" style={{ color: 'var(--warning-600)' }}><Icon name="TriangleAlert" size={12} /> {item.blocked}</span>}
      {item.safety && !item.blocked && <span className="cv-xs cv-faint"><Icon name="ShieldCheck" size={12} /> {item.safety}</span>}
    </div>
  );
}

function Effect({ item }) {
  return (
    <div className={s.right}>
      <span className="cv-num" style={{ fontWeight: 600 }}>{cvMoney(Math.round(item.conservative ?? item.value))}/wk</span>
      <span className="cv-xs cv-faint">{item.conservative != null ? `cautious end · ${cvMoney(Math.round(item.value))} likely` : 'expected'}</span>
      <Claim k="est" />
    </div>
  );
}

function PlanDraft({ v, rec, defaults, onCancel }) {
  const cv = useCv();
  const pool = v.plan.proposal;
  const extra = v.plan.ranked.filter((c) => !pool.some((p) => p.id === c.id));
  const [showMore, setShowMore] = React.useState(false);
  const due0 = addDays(v.period.end, 7);
  const owner0 = CV_ROOM.gm || '';
  const [rows, setRows] = React.useState(() => Object.fromEntries([...pool, ...extra].map((c, i) => {
    const d = defaults?.find((x) => x.id === c.id);
    return [c.id, { on: d ? true : !defaults && !c.blocked && i < PLAN_TOP && pool.includes(c), owner: d?.owner ?? owner0, due: d?.due ?? due0 }];
  })));
  const set = (id, patch) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const visible = [...pool.slice(0, PLAN_TOP), ...(showMore ? [...pool.slice(PLAN_TOP), ...extra] : [])];
  const picked = Object.entries(rows).filter(([, r]) => r.on).map(([id, r]) => ({ id, owner: r.owner, due: r.due }));
  const commit = async () => {
    const ok = await rec.post({ op: 'commit', week: v.period.start, items: picked });
    if (ok) { cv.toast(`The plan for the week of ${v.period.label} is committed.`); onCancel?.(); }
  };
  return (
    <>
      <div className={s.list}>
        {visible.map((c, i) => {
          const r = rows[c.id];
          return (
            <div key={c.id} className={s.item}>
              <input type="checkbox" className={s.check} aria-label={`Include ${c.title}`} checked={r.on} disabled={!!c.blocked} onChange={(e) => set(c.id, { on: e.target.checked })} />
              <div className={s.grow}>
                <div className={s.itemTop}><ItemBody item={c} v={v} /><Effect item={c} /></div>
                <div className="cv-row" style={{ gap: 8, alignItems: 'center' }}>
                  <Evidence item={c} />
                  {r.on && !c.blocked && <>
                    <label className="cv-xs cv-faint" htmlFor={`own-${c.id}`}>Owner</label>
                    <input id={`own-${c.id}`} className={`input ${s.small}`} list="week-owners" maxLength={80} value={r.owner} onChange={(e) => set(c.id, { owner: e.target.value })} placeholder="Who" />
                    <label className="cv-xs cv-faint" htmlFor={`due-${c.id}`}>Due</label>
                    <input id={`due-${c.id}`} className={`input ${s.small}`} type="date" min={v.period.start} max={addDays(v.period.end, 35)} value={r.due} onChange={(e) => set(c.id, { due: e.target.value })} />
                  </>}
                  {c.blocked && <button className="cv-link" onClick={() => cv.go('inputs')}>Bring the data in <Icon name="ArrowRight" size={14} /></button>}
                </div>
              </div>
              <span className="cv-rank" aria-hidden="true" style={{ order: -1 }}>{i + 1}</span>
            </div>
          );
        })}
      </div>
      <datalist id="week-owners">{[CV_ROOM.gm, 'Owner', 'Kitchen lead', 'Bar lead'].filter(Boolean).map((n) => <option key={n} value={n} />)}</datalist>
      {(pool.length > PLAN_TOP || extra.length > 0) && <button className="cv-link" style={{ alignSelf: 'flex-start' }} onClick={() => setShowMore((x) => !x)}>{showMore ? 'Show only the top three' : `Show ${pool.length - PLAN_TOP + extra.length} more candidates`} <Icon name={showMore ? 'ChevronUp' : 'ChevronDown'} size={14} /></button>}
      {rec.error && <Callout tone="warn" icon="TriangleAlert">{rec.error}</Callout>}
      <div className="cv-row" style={{ gap: 8 }}>
        <Button icon="ClipboardCheck" disabled={rec.busy || picked.length === 0} onClick={commit}>{defaults ? 'Re-commit the plan' : `Commit ${picked.length} action${picked.length === 1 ? '' : 's'}`}</Button>
        {onCancel && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
        <span className="cv-xs cv-faint">Committing saves owners and dates. New data later shows up as proposed changes, never over your plan.</span>
      </div>
    </>
  );
}

function PlanCommitted({ v, rec, plan, onRevise }) {
  const cv = useCv();
  const setStatus = async (id, status) => {
    const ok = await rec.post({ op: 'status', week: v.period.start, id, status });
    if (ok) cv.toast(`Marked ${STATUS_LABEL[status].toLowerCase()}.`);
  };
  return (
    <>
      {plan.revisions && (
        <Callout tone="warn" icon="RefreshCcw">
          New data changes the proposal: {[...plan.revisions.added.map((a) => `add “${a.title}”`), ...plan.revisions.dropped.map((d) => `${d.blocked ? 'pause' : 'drop'} “${d.title}”${d.blocked ? ` (${d.blocked.replace(/\.$/, '')})` : ''}`)].join('; ')}. Your committed plan stays as it is until you review it.
          <div style={{ marginTop: 8 }}><Button size="sm" variant="secondary" icon="Pencil" onClick={onRevise}>Review the changes</Button></div>
        </Callout>
      )}
      <div className={s.list}>
        {plan.items.map((i, n) => (
          <div key={i.id} className={s.item}>
            <span className="cv-rank" aria-hidden="true">{n + 1}</span>
            <div className={s.grow}>
              <div className={s.itemTop}><ItemBody item={i} v={v} /><Effect item={i} /></div>
              <div className="cv-row" style={{ gap: 12, alignItems: 'center' }}>
                <span className="cv-xs"><span className="cv-faint">Owner</span> {i.owner}</span>
                <span className="cv-xs"><span className="cv-faint">Due</span> {day(i.due)}</span>
                <label className="cv-xs cv-faint" htmlFor={`st-${i.id}`}>Status</label>
                <select id={`st-${i.id}`} className={`input ${s.small} ${s.select}`} value={i.status} disabled={rec.busy} onChange={(e) => setStatus(i.id, e.target.value)}>
                  {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {i.progress && <span className="cv-xs cv-muted"><Icon name="ListChecks" size={12} /> {i.progress}</span>}
                <button className="cv-link" onClick={() => cv.go(i.go)}>Details <Icon name="ArrowRight" size={14} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {rec.error && <Callout tone="warn" icon="TriangleAlert">{rec.error}</Callout>}
    </>
  );
}

function ImprovementPlan({ v, rec }) {
  const cv = useCv();
  const [revising, setRevising] = React.useState(false);
  const plan = rec.plan;
  React.useEffect(() => setRevising(false), [v.roomId, v.period?.start]);
  const committed = plan?.committed;
  const defaults = committed && revising ? [
    ...plan.items.filter((i) => i.status !== 'dropped' && !(plan.revisions?.dropped || []).some((d) => d.id === i.id)).map((i) => ({ id: i.id, owner: i.owner, due: i.due })),
    ...(plan.revisions?.added || []).map((a) => ({ id: a.id, owner: CV_ROOM.gm || '', due: addDays(v.period.end, 7) })),
  ] : null;
  return (
    <section className="cv-card" aria-labelledby="week-plan">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4" id="week-plan">The improvement plan</span>
          <span className="cv-small cv-faint">
            {committed ? `Committed ${stampDay(committed.committedAt)}${plan.committedBy ? ` by ${plan.committedBy}` : ''}${committed.revision > 1 ? ` · revision ${committed.revision}` : ''}`
              : v.plan.used ? `Proposed to fit ${hrs(v.plan.hours)}, ranked by value, evidence and how long it lasts` : `Nothing fits the ${hrs(v.plan.hours)} set on The plan`}
          </span>
        </div>
        <div className="cv-row" style={{ gap: 8 }}>
          {committed && <Pill tone="good" icon="ClipboardCheck">Committed</Pill>}
          <Button variant="secondary" size="sm" iconRight="ArrowRight" onClick={() => cv.go('meeting')}>Take it to the meeting</Button>
        </div>
      </div>
      {!plan ? <span className="cv-small cv-muted">{rec.error ? `Couldn’t load the plan: ${rec.error}` : 'Loading the plan…'}</span>
        : committed && !revising ? <PlanCommitted v={v} rec={rec} plan={plan} onRevise={() => setRevising(true)} />
          : v.plan.ranked.length === 0 ? <span className="cv-small cv-muted">No change clears the bar this week. New data re-ranks the candidates.</span>
            : <PlanDraft key={`${v.roomId}:${revising}`} v={v} rec={rec} defaults={defaults} onCancel={revising ? () => setRevising(false) : null} />}
      <div className="cv-sep" />
      <div className="cv-row" style={{ gap: 10 }}>
        <Claim k="est" />
        <span className="cv-small" style={{ flex: 1, minWidth: 220 }}>Estimated open exposure is <Money id="exposure"><b className="cv-num">{cvMoney(Math.round(v.exposure.value))}/wk</b></Money> across {v.exposure.count} candidates. Estimates are never added to what’s verified.</span>
        <button className="cv-link" onClick={() => cv.go('plan')}>Change the hours on The plan <Icon name="ArrowRight" size={14} /></button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- needs attention (spec §7.7) */
function NeedsAttention({ v }) {
  const cv = useCv();
  const [all, setAll] = React.useState(false);
  const list = all ? v.attention : v.attention.slice(0, 3);
  return (
    <section className="cv-card" id="week-attention" aria-labelledby="week-att">
      <div className="cv-card-head">
        <span className="cv-h4" id="week-att">Needs attention this week</span>
        {v.attention.length > 0 && <Pill tone="warn">{v.attention.length}</Pill>}
      </div>
      {v.attention.length === 0 && <Callout tone="good" icon="ShieldCheck">Nothing needs attention at {v.short}: no exceptions over their limits, no broken guardrails, no stale feeds and no late tasks.</Callout>}
      <div className={s.list}>
        {list.map((a) => (
          <div key={a.id} className={s.item}>
            <span className={`cv-q-ico ${a.tone === 'neutral' ? '' : a.tone}`}><Icon name={a.icon} size={18} /></span>
            <div className={s.grow}>
              <span style={{ fontWeight: 600 }}>{a.title}</span>
              {a.body && <span className="cv-small cv-muted">{a.body}</span>}
              <button className="cv-link" style={{ alignSelf: 'flex-start' }} onClick={() => cv.go(a.go, a.goId ? { id: a.goId } : undefined)}>{a.cta} <Icon name="ArrowRight" size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      {v.attention.length > 3 && <button className="cv-link" style={{ alignSelf: 'flex-start' }} aria-expanded={all} onClick={() => setAll((x) => !x)}>{all ? 'Show fewer' : `Show all ${v.attention.length}`} <Icon name={all ? 'ChevronUp' : 'ChevronDown'} size={14} /></button>}
    </section>
  );
}

/* ---------------------------------------------------------------- tests + verified (spec §7.5, §7.8) */
function InFlight({ v }) {
  const cv = useCv();
  return (
    <section className="cv-card" aria-labelledby="week-tests">
      <div className="cv-card-head">
        <span className="cv-h4" id="week-tests">Tests in progress</span>
        <button className="cv-link" onClick={() => cv.go(v.real ? 'windows' : 'proof')}>All tests <Icon name="ArrowRight" size={14} /></button>
      </div>
      {v.inFlight.length === 0 && <span className="cv-small cv-muted">No tests running at {v.short}. Commit a plan action, then start its 28-day test from Levers.</span>}
      <div className={s.list}>
        {v.inFlight.map((t) => (
          <div key={t.id} className={s.item}>
            <span className={`cv-q-ico ${t.waiting ? 'warn' : 'accent'}`}><Icon name={t.waiting ? 'Hourglass' : 'Timer'} size={18} /></span>
            <div className={s.grow}>
              <span style={{ fontWeight: 600 }}>{t.title}</span>
              <div className="progress" style={{ margin: '4px 0' }} role="progressbar" aria-valuenow={t.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.title}: ${t.progress}% of the window`}><span style={{ width: `${Math.max(2, t.progress)}%` }} /></div>
              <dl className={s.facts}>
                {t.owner && <><dt>Owner</dt><dd>{t.owner}</dd></>}
                {t.started && <><dt>Started</dt><dd>{/^\d{4}-/.test(t.started) ? day(t.started) : t.started}</dd></>}
                <dt>Now</dt><dd>{t.day != null ? `Day ${t.day} of 28` : t.next}</dd>
                {t.day != null && <><dt>Next</dt><dd>{t.next}</dd></>}
                {t.review && <><dt>Review</dt><dd>{/^\d{4}-/.test(t.review) ? day(t.review) : t.review}</dd></>}
                <dt>Data</dt><dd>{t.coverage}</dd>
                <dt>Guardrails</dt><dd>{t.guardrail}</dd>
              </dl>
              <span className="cv-xs cv-faint">{t.verified}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Verified({ v }) {
  const cv = useCv();
  const b = v.banked;
  const lead = b.lead;
  const sample = v.sample;
  const money = (x) => cvMoney(sample ? Math.round(x) : x, { cents: !sample });
  return (
    <section className="cv-card" aria-labelledby="week-verified">
      <div className="cv-card-head">
        <span className="cv-h4" id="week-verified">Verified savings</span>
        <Claim k="book" />
      </div>
      <dl className={s.kv}>
        <dt>Run-rate</dt><dd><Fig id="banked-week" show={sample}>{money(b.week)}/wk</Fig></dd>
        <dt>Accrued this week</dt><dd>{money(b.accrued)}</dd>
        <dt>To date</dt><dd><Fig id="to-date" show={sample}>{money(b.toDate)}</Fig></dd>
        {sample && b.coverage != null && <><dt>September vs subscription</dt><dd><Money id="coverage">{b.coverage.toFixed(1)}×</Money></dd></>}
      </dl>
      {b.newly.length > 0 && <span className="cv-small"><Icon name="BadgeCheck" size={14} className="cv-up" /> Newly verified: {b.newly.map((x) => `${x.title} (${money(x.bookable)}/wk)`).join('; ')}</span>}
      {b.suspended.length > 0 && <span className="cv-small"><Icon name="CirclePause" size={14} /> Suspended or reversed: {b.suspended.map((x) => x.title).join('; ')}. Nothing accrues on {b.suspended.length === 1 ? 'it' : 'them'} while it holds.</span>}
      {lead ? <>
        <div className="cv-sep" />
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-xs cv-faint">The largest verified change</span>
          <span style={{ fontWeight: 600 }}>{lead.title}</span>
          <span className="cv-small cv-muted">{sample ? (b.note || `Holding ${lead.held}.`) : `We count the lower bound, ${money(lead.bookable)}/wk${lead.point != null ? `, of a measured ${money(lead.point)}/wk` : ''}.`}</span>
        </div>
        {sample && lead.lo != null && <Interval lo={lead.lo} pt={lead.point} hi={lead.hi} min={Math.round(lead.lo * 0.6)} max={Math.round(lead.hi * 1.25)} billedLabel="what we bill on" />}
      </> : <span className="cv-small cv-muted">{b.running ? `Nothing verified yet. ${b.running} test${b.running === 1 ? ' is' : 's are'} running; each closes at day 28 of data.` : 'Nothing verified yet. A change has to pass every gate before a dollar of it counts.'}</span>}
      <button className="cv-link" style={{ alignSelf: 'flex-start' }} onClick={() => (sample && lead ? cv.go('packet', { id: lead.id }) : cv.go(v.real ? 'windows' : 'proof'))}>See the proof <Icon name="ArrowRight" size={14} /></button>
    </section>
  );
}

/* ---------------------------------------------------------------- close out */
function CloseOut({ v, names }) {
  const cv = useCv();
  const eng = useEngine();
  const [rec, setRec] = useSaved(REVIEW_KEY, {});
  const key = v.period?.start;
  const mine = key ? rec[key] : null;
  const [note, setNote] = React.useState(mine?.note || '');
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => { setNote(mine?.note || ''); setEditing(false); }, [key, eng.room]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!key) return null;
  const save = () => {
    const entry = { at: new Date().toISOString(), ...(note.trim() ? { note: note.trim().slice(0, 1000) } : {}) };
    setRec((cur) => trimReviews({ ...cur, [key]: mine && editing ? { ...entry, at: mine.at } : entry }), `Week of ${v.period.label} ${mine ? 'note updated' : 'marked reviewed'}`);
    setEditing(false);
    cv.toast(mine ? 'Note saved.' : `The week of ${v.period.label} is marked reviewed.`);
  };
  const reopen = () => {
    setRec((cur) => { const next = { ...cur }; delete next[key]; return next; }, `Week of ${v.period.label} reopened`);
    cv.toast('Reopened.');
  };
  const by = (k) => (eng.mode === 'server' ? names[k] : null);
  const past = Object.keys(rec).filter((k) => k !== key).sort().reverse().slice(0, 4);
  return (
    <section className="cv-card" id="week-review">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4">Close out the week</span>
          <span className="cv-small cv-faint">Mark the week of {v.period.label} reviewed, with a line on what you decided. Everyone with this room sees it.</span>
        </div>
        {mine && <Pill tone="good" icon="ClipboardCheck">Reviewed {stampDay(mine.at)}{by(key) ? ` by ${by(key)}` : ''}</Pill>}
      </div>
      {mine && !editing ? (
        <div className="cv-col" style={{ gap: 10 }}>
          {mine.note ? <p className="cv-small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{mine.note}</p> : <span className="cv-small cv-muted">No note.</span>}
          <div className="cv-row" style={{ gap: 8 }}>
            <Button variant="secondary" size="sm" icon="Pencil" onClick={() => setEditing(true)}>Edit the note</Button>
            <Button variant="ghost" size="sm" icon="RotateCcw" onClick={reopen}>Reopen</Button>
          </div>
        </div>
      ) : (
        <div className="cv-col" style={{ gap: 10 }}>
          <label htmlFor="week-note" className="cv-xs cv-faint">Note (optional)</label>
          <textarea id="week-note" className={`input ${s.note}`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you decided this week" />
          <div className="cv-row" style={{ gap: 8 }}>
            <Button size="sm" icon="ClipboardCheck" onClick={save}>{mine ? 'Save the note' : 'Mark the week reviewed'}</Button>
            {editing && <Button variant="ghost" size="sm" onClick={() => { setNote(mine?.note || ''); setEditing(false); }}>Cancel</Button>}
            <span className="cv-xs cv-faint">{note.length > 900 ? `${1000 - note.length} characters left` : eng.mode === 'server' ? 'Saved to your group.' : 'Saved in this browser.'}</span>
          </div>
        </div>
      )}
      {past.length > 0 && (
        <div className={s.past}>
          <span className="cv-xs cv-faint" style={{ paddingBottom: 6 }}>Earlier weeks</span>
          {past.map((k) => (
            <div key={k} className={s.pastRow}>
              <span className="cv-num cv-muted">Week of {day(k)}</span>
              <span>{rec[k].note || <span className="cv-faint">No note</span>}<span className="cv-xs cv-faint"> · reviewed {stampDay(rec[k].at)}{by(k) ? ` by ${by(k)}` : ''}</span></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- waiting for data */
function Waiting({ v }) {
  const cv = useCv();
  return (
    <div className="cv-empty">
      <span className="ico" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}><Icon name="PlugZap" size={22} /></span>
      <span className="cv-h4">Your week fills in from {v.room}’s own sales</span>
      <span className="cv-small cv-muted" style={{ maxWidth: 520 }}>Until your Toast data is in, every figure here would be the template’s, so we don’t show them. Connect Toast for a nightly pull, or upload its data exports once.</span>
      <div className="cv-row" style={{ justifyContent: 'center', gap: 8 }}>
        <Button icon="PlugZap" onClick={() => cv.go('connect')}>Connect Toast</Button>
        <Button variant="secondary" icon="Upload" onClick={() => cv.go('inputs')}>Upload exports</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the page */
function CvThisWeek() {
  const eng = useEngine();
  const real = eng.mode === 'server' && !!eng.org && !eng.org.sample;
  const [plan] = useSaved('plan', { hours: CV_D.room.managerHours });
  const [dismissed] = useSaved('findings', {});
  const [reviews] = useSaved(REVIEW_KEY, {});
  const [comparator, setComparator] = React.useState(null);
  const tasks = eng.tasks || [];
  const v = weekView(CV_D, { windows: real ? eng.windows || [] : null, hours: plan.hours, dismissed, matchedWeeks: CV_DS?.matchedWeeks || [], comparator, tasks });
  const rec = useWeekRecord(v, tasks);
  const q = 'Your week in review';
  if (v.awaiting) {
    return (
      <div className="cv-page">
        <PageHead over={CV_ROOM.name} q={q} />
        <Waiting v={v} />
      </div>
    );
  }
  const reviewed = v.period && reviews[v.period.start];
  return (
    <div className="cv-page">
      <PageHead over={`${CV_ROOM.name}${v.period ? ` · week of ${v.period.label}` : ''}`} q={q} sub={v.headline}
        right={reviewed
          ? <Pill tone="good" icon="ClipboardCheck">Week reviewed</Pill>
          : <a className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }} href="#week-review"><Icon name="ClipboardCheck" size={14} /> Close out the week</a>} />
      <div className="cv-row" style={{ gap: 8, marginTop: -8 }} aria-label="About this data">
        <Pill tone={v.status === 'complete' ? 'neutral' : 'warn'} icon={v.status === 'complete' ? 'CalendarRange' : 'Hourglass'}>{v.status === 'complete' ? 'Complete week' : 'Week in progress'}</Pill>
        <Pill icon="Database">Data through {day(v.dataThrough)}</Pill>
        {v.sample ? <Pill icon="FlaskConical">Sample restaurant data</Pill> : v.own ? <Pill icon="Store">Your Toast data</Pill> : null}
        {v.contribution.status === 'estimated' && <Pill tone="warn" icon="CircleDashed">Labour not measured yet</Pill>}
      </div>
      <Board v={v} />
      <WhatChanged v={v} comparator={comparator} setComparator={setComparator} />
      <div className="cv-grid g-hero" style={{ alignItems: 'start' }}>
        <ImprovementPlan v={v} rec={rec} />
        <NeedsAttention v={v} />
      </div>
      <div className="cv-grid g2" style={{ alignItems: 'start' }}>
        <InFlight v={v} />
        <Verified v={v} />
      </div>
      <DenseWeek />
      <CloseOut v={v} names={rec.names} />
    </div>
  );
}

export { CvThisWeek };
