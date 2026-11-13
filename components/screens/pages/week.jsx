'use client';

import * as React from 'react';

import { Icon, Button, Tabs } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { PLAN_KEY, PLAN_TOP, REVIEW_KEY, buildCommit, planState, setItemStatus, trimReviews, weekView } from '../../../lib/data/page/week';
import { useCv, cvMoney, CV_D, CV_DS, CV_ROOM, Claim, Money, Callout, Interval, PageHead, Pill } from '../core';
import { DenseWeek } from '../dense-sections';
import { Meter, TestTrack, Waterfall, WeekBars } from './week-charts';
import s from './week.module.css';

/* This week: your week in review, mostly as pictures. Big numbers first,
   then where the money moved, the weeks around it, and a short plan with
   one action each. Explanations sit behind "How this is worked out".
   Every figure comes from weekView() (lib/data/page/week.js), which the
   week API and the Monday digest also use. A real group's verified dollars
   and tests come from its own test windows, never the sample's. */

const minutes = (h) => `${Math.round(h * 60)} min`;
const hrs = (h) => `${+h.toFixed(2)} h`;
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const stampDay = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const STATUS_LABEL = { planned: 'Planned', doing: 'In progress', done: 'Done', dropped: 'Dropped' };
const usd = (v, sign = false) => cvMoney(Math.round(v), { sign });

/** A dollar that opens its derivation, but only when that derivation describes this figure. */
function Fig({ id, show, children }) {
  return show ? <Money id={id}>{children}</Money> : <span>{children}</span>;
}

/** Long text, one click away. */
function More({ label = 'How this is worked out', children }) {
  return (
    <details className={s.more}>
      <summary><Icon name="Info" size={14} /> {label}</summary>
      <div className="cv-small cv-muted">{children}</div>
    </details>
  );
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

/* ---------------------------------------------------------------- big numbers */
function Board({ v }) {
  const c = v.contribution;
  const ch = v.decomposition?.contribution.change;
  const b = v.banked;
  const sample = v.sample;
  const urgent = v.attention.length;
  const spark = v.history.map((h) => h.earned);
  return (
    <section className={`cv-card ${s.board}`} aria-label="The week in four numbers">
      <div className={s.tile}>
        <div className={s.tileHead}><span className="cv-over">Contribution</span><Claim k={c.claim} /></div>
        <span className={`cv-fig xl ${s.big}`}>{c.value == null ? '—' : <Money id="earned-week">{usd(c.value)}</Money>}</span>
        {spark.length > 1 && <MiniLine vals={spark} />}
        <span className={s.tileFoot}>After food and labour{c.status === 'estimated' ? ' · labour estimated' : ''}</span>
      </div>
      <div className={s.tile}>
        <div className={s.tileHead}><span className="cv-over">Vs {v.comparator ? v.comparator.label.toLowerCase() : 'before'}</span><Claim k={v.comparator?.id === 'matched' ? 'mod' : 'obs'} /></div>
        <span className={`cv-fig xl ${s.big} ${ch == null ? '' : ch >= 0 ? 'cv-up' : 'cv-down'}`}>
          {ch == null ? '—' : <Fig id="margin-move" show={sample && v.comparator?.id === 'matched'}>{usd(ch, true)}</Fig>}
        </span>
        {ch != null && <span className={`${s.delta} ${ch >= 0 ? 'cv-up' : 'cv-down'}`}><Icon name={ch >= 0 ? 'TrendingUp' : 'TrendingDown'} size={16} /> {Math.abs((ch / (v.decomposition.contribution.then || 1)) * 100).toFixed(1)}%</span>}
        <span className={s.tileFoot}>{ch == null ? 'No earlier week of yours yet' : 'A change, not a saving'}</span>
      </div>
      <div className={s.tile}>
        <div className={s.tileHead}><span className="cv-over">Verified this week</span><Claim k="book" /></div>
        <span className={`cv-fig xl ${s.big} ${b.accrued ? 'cv-up' : ''}`}><Fig id="banked-week" show={sample}>{cvMoney(b.accrued, { cents: !sample && b.accrued % 1 !== 0 })}</Fig></span>
        <span className={s.tileFoot}>{b.liveCount ? `${cvMoney(b.week, { cents: !sample && b.week % 1 !== 0 })}/wk run-rate · ${b.liveCount} change${b.liveCount === 1 ? '' : 's'}` : b.running ? `${b.running} test${b.running === 1 ? '' : 's'} running` : 'Nothing verified yet'}</span>
      </div>
      <a className={`${s.tile} ${s.tileLink}`} href="#week-attention">
        <div className={s.tileHead}><span className="cv-over">Needs attention</span>{urgent ? <Icon name="TriangleAlert" size={16} color="var(--warning-600)" /> : <Icon name="CircleCheck" size={16} color="var(--success-600)" />}</div>
        <span className={`cv-fig xl ${s.big}`} style={{ color: urgent ? 'var(--warning-600)' : 'var(--success-600)' }}>{urgent}</span>
        <span className={s.tileFoot}>{urgent ? 'See them below' : 'All clear'}</span>
      </a>
    </section>
  );
}

function MiniLine({ vals }) {
  const w = 160, h = 30, lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const xy = vals.map((v, i) => [(i / (vals.length - 1)) * (w - 6) + 3, h - 4 - ((v - lo) / span) * (h - 8)]);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ maxWidth: '100%' }}>
      <polyline points={xy.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--cat-1)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={xy.at(-1)[0]} cy={xy.at(-1)[1]} r="3.5" fill="var(--accent)" />
    </svg>
  );
}

/* ---------------------------------------------------------------- where the money moved (spec §7.3–7.4) */
function MoneyMoved({ v, comparator, setComparator }) {
  const dec = v.decomposition;
  const avail = v.comparators.filter((c) => c.available);
  const missing = v.comparators.filter((c) => !c.available);
  const m = v.margin;
  const line = (k) => dec?.lines.find((l) => l.key === k);
  return (
    <section className="cv-card" aria-labelledby="week-moved">
      <div className="cv-card-head">
        <span className="cv-h4" id="week-moved">Where the money moved</span>
        <Claim k="obs" />
      </div>
      {avail.length > 1 && <Tabs tabs={avail.map((c) => ({ value: c.id, label: `vs ${c.label.toLowerCase()}` }))} value={comparator || v.comparator?.id} onChange={setComparator} />}
      {dec ? <>
        <Waterfall
          caption={`Contribution from ${v.comparator.label.toLowerCase()} to this week`}
          start={{ label: v.comparator.label, short: 'Before', value: dec.contribution.then }}
          parts={['net', 'food', 'labour'].map((k) => ({ key: k, label: { net: 'Sales', food: 'Food cost', labour: 'Labour cost' }[k], short: { net: 'Sales', food: 'Food', labour: 'Labour' }[k], value: line(k).effect }))}
          end={{ label: 'This week', short: 'Now', value: dec.contribution.now }}
          fmt={(x, sign) => usd(x, sign)} />
        <div className={s.chips}>
          {[['net', 'Sales'], ['covers', 'Covers'], ['check', 'Avg check']].map(([k, label]) => {
            const l = line(k);
            const up = l.change >= 0;
            return (
              <div key={k} className={s.chip}>
                <span className="cv-xs cv-faint">{label}</span>
                <span className={s.chipNum}>{k === 'covers' ? Math.round(l.now).toLocaleString('en-US') : cvMoney(k === 'check' ? l.now : Math.round(l.now), { cents: k === 'check' })}</span>
                <span className={`cv-xs ${up ? 'cv-up' : 'cv-down'}`}><Icon name={up ? 'ArrowUp' : 'ArrowDown'} size={12} /> {k === 'covers' ? Math.abs(Math.round(l.change)) : cvMoney(Math.abs(k === 'check' ? l.change : Math.round(l.change)), { cents: k === 'check' })}</span>
              </div>
            );
          })}
          {v.comparator.id === 'matched' && m.move > 0 && (
            <div className={s.chip} style={{ flex: 2, minWidth: 220 }}>
              <span className="cv-xs cv-faint">How much of the rise is verified</span>
              <Meter label={`${usd(m.claimable)} verified, ${usd(m.unexplained)} not claimed`} parts={[{ label: 'Verified', value: m.claimable, color: 'var(--claim-book)' }, { label: 'Not claimed', value: m.unexplained, color: 'var(--border-strong)' }]} />
              <span className="cv-xs"><b className="cv-up">{usd(m.claimable)}</b> verified · <span className="cv-faint">{usd(m.unexplained)} not claimed</span></span>
            </div>
          )}
        </div>
        <More>
          Contribution is net sales minus food cost minus hourly labour. It isn’t profit: rent and other costs aren’t taken off. Sales, food and labour add up exactly to the change; that describes the week, it doesn’t prove what caused it, and none of it is a saving we claim. Food cost is plates sold × recipe cost{v.contribution.status === 'estimated' ? '; labour isn’t measured yet, so it’s estimated' : ''}. {v.comparator.desc}.
          {missing.length ? ` Not available yet: ${missing.map((c) => `${c.label.toLowerCase()} (${c.reason.replace(/\.$/, '').toLowerCase()})`).join('; ')}.` : ''}
        </More>
      </> : <Callout icon="CalendarRange">Comparisons appear once there’s an earlier week of your own data.</Callout>}
    </section>
  );
}

const TREND_FIELDS = {
  earned: { label: 'Contribution', fmt: (x) => usd(x) },
  net: { label: 'Sales', fmt: (x) => usd(x) },
  covers: { label: 'Covers', fmt: (x) => Math.round(x).toLocaleString('en-US') },
};
function Weeks({ v }) {
  const [f, setF] = React.useState('earned');
  if (v.history.length < 2) return null;
  const field = TREND_FIELDS[f];
  const pts = v.history.map((h) => ({ label: h.label || day(h.iso), value: h[f], current: h.current }));
  const base = v.decomposition && v.comparator ? { earned: v.decomposition.contribution.then, net: v.decomposition.lines.find((l) => l.key === 'net').then, covers: v.decomposition.lines.find((l) => l.key === 'covers').then }[f] : null;
  return (
    <section className="cv-card" aria-labelledby="week-weeks">
      <div className="cv-card-head">
        <span className="cv-h4" id="week-weeks">The last {v.history.length} weeks</span>
        <Tabs tabs={Object.entries(TREND_FIELDS).map(([k, x]) => ({ value: k, label: x.label }))} value={f} onChange={setF} />
      </div>
      <WeekBars points={pts} baseline={base} baselineLabel={v.comparator?.label.toLowerCase()} fmt={field.fmt} caption={`${field.label} by week`} />
      <span className="cv-xs cv-faint">Hover or tap a week. The dashed line is {v.comparator ? v.comparator.label.toLowerCase() : 'the baseline'}.</span>
    </section>
  );
}

/* ---------------------------------------------------------------- the plan (spec §7.6, §7.9) */
function PlanRow({ n, item, children, lead }) {
  return (
    <div className={`${s.planRow} ${item.blocked ? s.planBlocked : ''}`}>
      {lead}
      <span className="cv-rank" aria-hidden="true">{n}</span>
      <div className={s.grow}>
        <span className={s.planTitle}>{item.title}</span>
        <span className="cv-xs cv-faint">{item.lever} · {minutes(item.hours)}{item.blocked ? '' : ' · '}{!item.blocked && <span className="cv-up">Ready</span>}</span>
        {item.blocked && <span className={s.blockedNote}><Icon name="Lock" size={12} /> Blocked: {item.blocked.split('.')[0]}</span>}
        {(item.why || item.safety) && <More label="Why and what could go wrong">{item.why} {item.safety && <><br /><Icon name="ShieldCheck" size={12} /> {item.safety}</>}</More>}
        {children}
      </div>
      <div className={s.right}>
        <span className={s.planNum}>{usd(item.conservative ?? item.value)}<span className="cv-faint" style={{ fontSize: '0.6em' }}>/wk</span></span>
        <Claim k="est" />
      </div>
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
  const total = picked.reduce((t, p) => { const c = [...pool, ...extra].find((x) => x.id === p.id); return t + (c ? c.conservative ?? c.value : 0); }, 0);
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
            <PlanRow key={c.id} n={i + 1} item={c}
              lead={<input type="checkbox" className={s.check} aria-label={`Include ${c.title}`} checked={r.on} disabled={!!c.blocked} onChange={(e) => set(c.id, { on: e.target.checked })} />}>
              {r.on && !c.blocked && (
                <div className={s.assign}>
                  <label className="sr-only" htmlFor={`own-${c.id}`}>Owner</label>
                  <span className={s.field}><Icon name="User" size={14} /><input id={`own-${c.id}`} className={`input ${s.small}`} list="week-owners" maxLength={80} value={r.owner} onChange={(e) => set(c.id, { owner: e.target.value })} placeholder="Owner" /></span>
                  <label className="sr-only" htmlFor={`due-${c.id}`}>Due</label>
                  <span className={s.field}><Icon name="CalendarRange" size={14} /><input id={`due-${c.id}`} className={`input ${s.small}`} type="date" min={v.period.start} max={addDays(v.period.end, 35)} value={r.due} onChange={(e) => set(c.id, { due: e.target.value })} /></span>
                </div>
              )}
              {c.blocked && <div><Button size="sm" variant="secondary" icon="Upload" onClick={() => cv.go('inputs')}>Bring the data in</Button></div>}
            </PlanRow>
          );
        })}
      </div>
      <datalist id="week-owners">{[CV_ROOM.gm, 'Owner', 'Kitchen lead', 'Bar lead'].filter(Boolean).map((n) => <option key={n} value={n} />)}</datalist>
      {(pool.length > PLAN_TOP || extra.length > 0) && <button className="cv-link" style={{ alignSelf: 'flex-start' }} onClick={() => setShowMore((x) => !x)}>{showMore ? 'Top three only' : `${pool.length - PLAN_TOP + extra.length} more ideas`} <Icon name={showMore ? 'ChevronUp' : 'ChevronDown'} size={14} /></button>}
      {rec.error && <Callout tone="warn" icon="TriangleAlert">{rec.error}</Callout>}
      <div className={s.commitBar}>
        <div className="cv-col" style={{ gap: 0 }}>
          <span className="cv-xs cv-faint">{picked.length} action{picked.length === 1 ? '' : 's'}, at least</span>
          <span className={s.planNum}>{usd(total)}<span className="cv-faint" style={{ fontSize: '0.6em' }}>/wk</span> <Claim k="est" /></span>
        </div>
        <div className="cv-row" style={{ gap: 8 }}>
          {onCancel && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
          <Button icon="ClipboardCheck" disabled={rec.busy || picked.length === 0} onClick={commit}>{defaults ? 'Re-commit' : 'Commit the plan'}</Button>
        </div>
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
  const done = plan.items.filter((i) => i.status === 'done').length;
  const live = plan.items.filter((i) => i.status !== 'dropped').length;
  return (
    <>
      <div className="cv-col" style={{ gap: 6 }}>
        <div className="cv-row" style={{ justifyContent: 'space-between' }}><span className="cv-xs cv-faint">Progress</span><span className="cv-xs"><b>{done}</b> of {live} done</span></div>
        <div className="progress" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={live} aria-label="Plan progress"><span style={{ width: `${live ? (done / live) * 100 : 0}%` }} /></div>
      </div>
      {plan.revisions && (
        <div className={s.revise}>
          <Icon name="RefreshCcw" size={16} />
          <span className="cv-small" style={{ flex: 1 }}>New data suggests {plan.revisions.added.length ? `${plan.revisions.added.length} new` : ''}{plan.revisions.added.length && plan.revisions.dropped.length ? ' and ' : ''}{plan.revisions.dropped.length ? `${plan.revisions.dropped.length} to drop` : ''}. Your plan stays until you choose.</span>
          <Button size="sm" variant="secondary" onClick={onRevise}>Review</Button>
        </div>
      )}
      <div className={s.list}>
        {plan.items.map((i, n) => (
          <PlanRow key={i.id} n={n + 1} item={i}>
            <div className={s.assign}>
              <span className={s.who}><Icon name="User" size={13} /> {i.owner}</span>
              <span className={s.who}><Icon name="CalendarRange" size={13} /> {day(i.due)}</span>
              <div className={s.seg} role="radiogroup" aria-label={`Status of ${i.title}`}>
                {Object.entries(STATUS_LABEL).map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={i.status === k} className={i.status === k ? s.segOn : ''} disabled={rec.busy} onClick={() => i.status !== k && setStatus(i.id, k)}>{l}</button>
                ))}
              </div>
            </div>
            {i.progress && <span className="cv-xs cv-muted"><Icon name="ListChecks" size={12} /> {i.progress}</span>}
          </PlanRow>
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
        <div className="cv-col" style={{ gap: 2 }}>
          <span className="cv-h4" id="week-plan">Do this week</span>
          <span className="cv-xs cv-faint">{committed ? `Committed ${stampDay(committed.committedAt)}${plan.committedBy ? ` by ${plan.committedBy}` : ''}` : `Picked to fit ${hrs(v.plan.hours)} of manager time`}</span>
        </div>
        <Button variant="secondary" size="sm" iconRight="ArrowRight" onClick={() => cv.go('meeting')}>Meeting</Button>
      </div>
      {!plan ? <span className="cv-small cv-muted">{rec.error ? `Couldn’t load the plan: ${rec.error}` : 'Loading…'}</span>
        : committed && !revising ? <PlanCommitted v={v} rec={rec} plan={plan} onRevise={() => setRevising(true)} />
          : v.plan.ranked.length === 0 ? <span className="cv-small cv-muted">Nothing clears the bar this week.</span>
            : <PlanDraft key={`${v.roomId}:${revising}`} v={v} rec={rec} defaults={defaults} onCancel={revising ? () => setRevising(false) : null} />}
      <div className={s.exposure}>
        <Claim k="est" />
        <span className="cv-xs">Still open: <Money id="exposure"><b className="cv-num">{usd(v.exposure.value)}/wk</b></Money> across {v.exposure.count} ideas. Never counted as saved.</span>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- needs attention (spec §7.7) */
function NeedsAttention({ v }) {
  const cv = useCv();
  const [all, setAll] = React.useState(false);
  const list = all ? v.attention : v.attention.slice(0, 4);
  return (
    <section className="cv-card" id="week-attention" aria-labelledby="week-att">
      <div className="cv-card-head">
        <span className="cv-h4" id="week-att">Needs attention</span>
        {v.attention.length > 0 && <span className={s.count}>{v.attention.length}</span>}
      </div>
      {v.attention.length === 0 && <div className={s.clear}><Icon name="ShieldCheck" size={28} /><span className="cv-small">All clear at {v.short}</span></div>}
      <div className={s.list}>
        {list.map((a) => (
          <div key={a.id} className={s.attRow}>
            <span className={`cv-q-ico ${a.tone === 'neutral' ? '' : a.tone}`}><Icon name={a.icon} size={18} /></span>
            <div className={s.grow}>
              <span className={s.attTitle}>{a.title}</span>
              {a.body && <More label="Details">{a.body}</More>}
            </div>
            <Button size="sm" variant="secondary" onClick={() => cv.go(a.go, a.goId ? { id: a.goId } : undefined)} aria-label={`${a.cta}: ${a.title}`}>{a.cta.split(' ').slice(0, 3).join(' ')}</Button>
          </div>
        ))}
      </div>
      {v.attention.length > 4 && <button className="cv-link" style={{ alignSelf: 'flex-start' }} aria-expanded={all} onClick={() => setAll((x) => !x)}>{all ? 'Fewer' : `All ${v.attention.length}`} <Icon name={all ? 'ChevronUp' : 'ChevronDown'} size={14} /></button>}
    </section>
  );
}

/* ---------------------------------------------------------------- tests + verified (spec §7.5, §7.8) */
function InFlight({ v }) {
  const cv = useCv();
  return (
    <section className="cv-card" aria-labelledby="week-tests">
      <div className="cv-card-head">
        <span className="cv-h4" id="week-tests">Tests running</span>
        <button className="cv-link" onClick={() => cv.go(v.real ? 'windows' : 'proof')}>All <Icon name="ArrowRight" size={14} /></button>
      </div>
      {v.inFlight.length === 0 && <span className="cv-small cv-muted">None running. Commit an action, then test it from Levers.</span>}
      <div className={s.list}>
        {v.inFlight.map((t) => {
          const d = t.day ?? Math.round((t.progress / 100) * 28);
          return (
            <div key={t.id} className={s.testRow}>
              <div className="cv-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', gap: 8 }}>
                <span className={s.planTitle}>{t.title}</span>
                <Pill tone={t.waiting ? 'warn' : 'info'} icon={t.waiting ? 'Hourglass' : 'Timer'}>{t.waiting ? 'Waiting' : `Day ${d}`}</Pill>
              </div>
              <TestTrack day={d} waiting={t.waiting} label={t.title} />
              <More label="Details">
                <dl className={s.facts}>
                  {t.owner && <><dt>Owner</dt><dd>{t.owner}</dd></>}
                  {t.started && <><dt>Started</dt><dd>{/^\d{4}-/.test(t.started) ? day(t.started) : t.started}</dd></>}
                  <dt>Next</dt><dd>{t.next}</dd>
                  {t.review && <><dt>Review</dt><dd>{/^\d{4}-/.test(t.review) ? day(t.review) : t.review}</dd></>}
                  <dt>Data</dt><dd>{t.coverage}</dd>
                  <dt>Guardrails</dt><dd>{t.guardrail}</dd>
                </dl>
                {t.verified}
              </More>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Verified({ v }) {
  const cv = useCv();
  const b = v.banked;
  const lead = b.lead;
  const sample = v.sample;
  const m = (x) => cvMoney(sample ? Math.round(x) : x, { cents: !sample && x % 1 !== 0 });
  return (
    <section className="cv-card" aria-labelledby="week-verified">
      <div className="cv-card-head">
        <span className="cv-h4" id="week-verified">Verified savings</span>
        <Claim k="book" />
      </div>
      <div className={s.trio}>
        <div><span className="cv-xs cv-faint">This week</span><span className={`${s.trioNum} cv-up`}>{m(b.accrued)}</span></div>
        <div><span className="cv-xs cv-faint">Per week</span><span className={s.trioNum}><Fig id="banked-week" show={sample}>{m(b.week)}</Fig></span></div>
        <div><span className="cv-xs cv-faint">To date</span><span className={s.trioNum}><Fig id="to-date" show={sample}>{m(b.toDate)}</Fig></span></div>
      </div>
      {lead && sample && lead.lo != null && <Interval lo={lead.lo} pt={lead.point} hi={lead.hi} min={Math.round(lead.lo * 0.6)} max={Math.round(lead.hi * 1.25)} billedLabel="what we count" />}
      {b.newly.length > 0 && <span className="cv-xs"><Icon name="BadgeCheck" size={13} className="cv-up" /> New: {b.newly.map((x) => x.title).join('; ')}</span>}
      {b.suspended.length > 0 && <span className="cv-xs"><Icon name="CirclePause" size={13} /> Paused: {b.suspended.map((x) => x.title).join('; ')}</span>}
      {!lead && <span className="cv-small cv-muted">{b.running ? `${b.running} test${b.running === 1 ? '' : 's'} running. Nothing counts until one verifies.` : 'Nothing verified yet.'}</span>}
      <More>
        {lead ? <>{lead.title}: we count the cautious end of what it measured ({m(lead.bookable)}/wk{lead.point != null ? ` of ${m(lead.point)}/wk` : ''}). </> : null}
        “This week” is what verified changes actually accrued on the days of this week; “per week” is their run-rate. Estimates and changes in contribution are never added here.
        {sample && b.coverage != null ? ` September covered the subscription ${b.coverage.toFixed(1)}×.` : ''}
      </More>
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
      <PageHead over={`${CV_ROOM.name}${v.period ? ` · ${v.period.label}` : ''}`} q={q} sub={v.headline}
        right={reviewed
          ? <Pill tone="good" icon="ClipboardCheck">Reviewed</Pill>
          : <a className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }} href="#week-review"><Icon name="ClipboardCheck" size={14} /> Close out the week</a>} />
      <div className="cv-row" style={{ gap: 8, marginTop: -8 }} aria-label="About this data">
        <Pill tone={v.status === 'complete' ? 'neutral' : 'warn'} icon={v.status === 'complete' ? 'CalendarRange' : 'Hourglass'}>{v.status === 'complete' ? 'Complete week' : 'Week in progress'}</Pill>
        <Pill icon="Database">Data through {day(v.dataThrough)}</Pill>
        {v.sample ? <Pill icon="FlaskConical">Sample data</Pill> : v.own ? <Pill icon="Store">Your Toast data</Pill> : null}
        {v.contribution.status === 'estimated' && <Pill tone="warn" icon="CircleDashed">Labour estimated</Pill>}
      </div>
      <Board v={v} />
      <div className="cv-grid g-hero" style={{ alignItems: 'start' }}>
        <ImprovementPlan v={v} rec={rec} />
        <NeedsAttention v={v} />
      </div>
      <MoneyMoved v={v} comparator={comparator} setComparator={setComparator} />
      <Weeks v={v} />
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
