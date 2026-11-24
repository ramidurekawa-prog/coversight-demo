'use client';

import * as React from 'react';

import { Icon, Button } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { PLAN_KEY, PLAN_TOP, REVIEW_KEY, buildCommit, planState, setItemStatus, trimReviews, weekView } from '../../../lib/data/page/week';
import { useCv, cvMoney, CV_D, CV_DS, CV_ROOM, Claim, Money, Callout, Interval, PageHead } from '../core';
import { DenseWeek } from '../dense-sections';
import { TestTrack, WeekBars } from './week-charts';
import { useTodayTheme } from './today.themes';
import './today.module.css';
import { HowWeKnow } from '../touches';
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

/** A segmented toggle, as on Today: one choice of a few. */
function Toggle({ label, options, value, onChange }) {
  return (
    <div className={s.toggle} role="radiogroup" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

/** Today's state chip: an icon and a word, never color alone. */
function StateChip({ icon, tone, children }) {
  return <span className={`${s.stateChip} ${tone === 'warn' ? s.stateWarn : tone === 'good' ? s.stateGood : tone === 'mute' ? s.stateMute : ''}`}><Icon name={icon} size={13} />{children}</span>;
}
const leverName = (l) => (l === 'Labour' ? 'Labor' : l);

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
    <section className={s.inset} aria-labelledby="week-weeks">
      <div className="cv-card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span className={s.insetTitle} id="week-weeks">The last {v.history.length} weeks</span>
        <Toggle label="Show" options={Object.entries(TREND_FIELDS).map(([k, x]) => ({ value: k, label: x.label }))} value={f} onChange={setF} />
      </div>
      <WeekBars points={pts} baseline={base} baselineLabel={v.comparator?.label.toLowerCase()} fmt={field.fmt} caption={`${field.label} by week`} />
      <span className="cv-xs cv-faint">Hover or tap a week. The dashed line is {v.comparator ? v.comparator.label.toLowerCase() : 'the baseline'}.</span>
    </section>
  );
}

/* ---------------------------------------------------------------- the plan (spec §7.6, §7.9) */
/** One action: what, how long, what it could be worth. The why is one tap away. */
function PlanRow({ item, children, lead, onData }) {
  const [why, setWhy] = React.useState(false);
  const hasWhy = !!(item.talk?.length || item.why || item.safety);
  return (
    <div id={`plan-${item.id}`} className={`${s.planRow} ${item.blocked ? s.planBlocked : ''}`}>
      {lead}
      <div className={s.grow}>
        <span className={s.planTitle}>{item.title}</span>
        <span className={s.planMeta}>
          {item.blocked
            ? <><span className={s.blockedNote}><Icon name="Lock" size={13} />{item.blocked.split('.')[0]}</span>{onData && <button type="button" className={s.inlineLink} onClick={onData}>Bring the data in</button>}</>
            : <><span>{leverName(item.lever)}</span><span aria-hidden="true">·</span><span>{minutes(item.hours)}</span></>}
          {hasWhy && <button type="button" className={s.inlineLink} aria-expanded={why} onClick={() => setWhy((x) => !x)}>{why ? 'Hide' : 'Why this?'}</button>}
        </span>
        {why && <div className={s.whyText}>{(item.talk?.length ? item.talk : [item.why, item.safety].filter(Boolean)).map((x, i) => <p key={i}>{x}</p>)}</div>}
        {children}
      </div>
      <span className={s.planNum}>{usd(item.conservative ?? item.value)}<span className={s.unit}>/wk</span></span>
    </div>
  );
}

/** Who and when, shown as words; the fields open only to change them. */
function Assign({ id, r, set, v }) {
  const [edit, setEdit] = React.useState(false);
  if (!edit) {
    return (
      <span className={s.planMeta}>
        <span className={s.who}><Icon name="User" size={13} />{r.owner || 'No owner'}</span>
        <span className={s.who}><Icon name="CalendarRange" size={13} />Due {day(r.due)}</span>
        <button type="button" className={s.inlineLink} onClick={() => setEdit(true)}>Change</button>
      </span>
    );
  }
  return (
    <div className={s.assign}>
      <label className="sr-only" htmlFor={`own-${id}`}>Owner</label>
      <input id={`own-${id}`} className={`input ${s.small}`} list="week-owners" maxLength={80} value={r.owner} onChange={(e) => set(id, { owner: e.target.value })} placeholder="Owner" />
      <label className="sr-only" htmlFor={`due-${id}`}>Due</label>
      <input id={`due-${id}`} className={`input ${s.small}`} type="date" min={v.period.start} max={addDays(v.period.end, 35)} value={r.due} onChange={(e) => set(id, { due: e.target.value })} />
      <button type="button" className={s.inlineLink} onClick={() => setEdit(false)}>Done</button>
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
  // A fix tapped in the scorecard: add it to the plan, show it and point at it.
  React.useEffect(() => {
    const on = (e) => {
      const c = [...pool, ...extra].find((x) => x.id === e.detail);
      if (!c) return;
      e.preventDefault();
      if (!c.blocked) set(c.id, { on: true });
      if (!pool.slice(0, PLAN_TOP).includes(c)) setShowMore(true);
      requestAnimationFrame(() => { const el = document.getElementById(`plan-${c.id}`); if (el) flashRow(el); });
    };
    window.addEventListener('week:fix', on);
    return () => window.removeEventListener('week:fix', on);
  });
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
        {visible.map((c) => {
          const r = rows[c.id];
          return (
            <PlanRow key={c.id} item={c} onData={c.blocked ? () => cv.go('inputs') : null}
              lead={<input type="checkbox" className={s.check} aria-label={`Include ${c.title}`} checked={r.on} disabled={!!c.blocked} onChange={(e) => set(c.id, { on: e.target.checked })} />}>
              {r.on && !c.blocked && <Assign id={c.id} r={r} set={set} v={v} />}
            </PlanRow>
          );
        })}
      </div>
      <datalist id="week-owners">{[CV_ROOM.gm, 'Owner', 'Kitchen lead', 'Bar lead'].filter(Boolean).map((n) => <option key={n} value={n} />)}</datalist>
      {(pool.length > PLAN_TOP || extra.length > 0) && <button type="button" className={s.linkBtn} style={{ alignSelf: 'flex-start' }} aria-expanded={showMore} onClick={() => setShowMore((x) => !x)}>{showMore ? 'Show the top three only' : `Show ${pool.length - PLAN_TOP + extra.length} more ideas`}<Icon name={showMore ? 'ChevronUp' : 'ChevronDown'} size={14} /></button>}
      {rec.error && <Callout tone="warn" icon="TriangleAlert">{rec.error}</Callout>}
      <div className={s.commitBar}>
        <div className={s.total}>
          <span className={s.totalLbl}>{picked.length} action{picked.length === 1 ? '' : 's'} picked</span>
          <span className={s.totalNum}>{usd(total)}<span className={s.unit}>/wk potential</span></span>
          <Claim k="est" />
        </div>
        <div className="cv-row" style={{ gap: 8 }}>
          {onCancel && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
          <Button size="lg" className={s.cta} iconRight="ArrowRight" disabled={rec.busy || picked.length === 0} onClick={commit}>{defaults ? 'Re-commit' : 'Commit the plan'}</Button>
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
        {plan.items.map((i) => (
          <PlanRow key={i.id} item={i}>
            <div className={s.assign}>
              <span className={s.who}><Icon name="User" size={13} />{i.owner}</span>
              <span className={s.who}><Icon name="CalendarRange" size={13} />Due {day(i.due)}</span>
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

/* ---------------------------------------------------------------- the page as four steps (Ramidu, 2026-11-17: "no sense of direction")
   Each step opens with a plain answer, then one picture or list, then one thing to do.
   Charts that support the answer sit behind a click. */
const VS = { last: 'last week', avg4: 'your 4-week average', matched: 'similar weeks', prior: 'the same week last year', budget: 'budget' };
const vsPhrase = (c) => (c ? VS[c.id] || c.label.toLowerCase() : 'before');

/** The page's answer, in one line. */
function answerOf(v) {
  const dec = v.decomposition;
  if (!dec) return 'Your week in review';
  const ch = dec.contribution.change;
  if (Math.abs(ch) < Math.max(50, Math.abs(dec.contribution.then) * 0.005)) return `A steady week, in line with ${vsPhrase(v.comparator)}`;
  return ch > 0 ? `A green week: you kept ${usd(ch)} more than ${vsPhrase(v.comparator)}` : `A red week: you kept ${usd(-ch)} less than ${vsPhrase(v.comparator)}`;
}

function Step({ n, id, kicker, title, sub, right, children }) {
  return (
    <section className={`cv-card ${s.step}`} id={id} aria-labelledby={`${id}-t`}>
      <div className={s.stepHead}>
        <span className={s.stepNum} aria-hidden="true">{n}</span>
        <div className={s.stepText}>
          <span className={s.kicker}>{kicker}</span>
          <h3 id={`${id}-t`} className={s.stepTitle}>{title}</h3>
          {sub && <p className={s.stepSub}>{sub}</p>}
        </div>
        {right && <div className={s.stepRight}>{right}</div>}
      </div>
      {children}
    </section>
  );
}

/** Where to start: the four steps, each with where it stands. */
function Guide({ items }) {
  return (
    <nav className={s.guide} aria-label="This page, step by step">
      <ol>
        {items.map((x, i) => (
          <li key={x.id}>
            <a href={`#${x.id}`} className={s.guideItem}>
              <span className={`${s.guideNum} ${x.done ? s.guideDone : ''}`}>{x.done ? <Icon name="Check" size={13} /> : i + 1}</span>
              <span className={s.guideText}><b>{x.label}</b><span>{x.state}</span></span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function flashRow(el) {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add(s.flash);
  setTimeout(() => el.classList.remove(s.flash), 1600);
}

/**
 * The scorecard (Ramidu, 2026-11-18: "sell the outcome, easy to understand, easy to operate"):
 * sales, food and labor, each green or red against the normal week, each with the one action
 * that wins the most back. The button takes you to that action in step 2.
 */
function Scorecard({ score, vs }) {
  const cv = useCv();
  const open = (fix) => {
    // The plan picks it up (ticks it and shows it); otherwise scroll to it, or open its page.
    const ev = new CustomEvent('week:fix', { detail: fix.id, cancelable: true });
    if (window.dispatchEvent(ev)) {
      const el = document.getElementById(`plan-${fix.id}`);
      if (el) flashRow(el); else cv.go(fix.go);
    }
  };
  return (
    <div className={s.score}>
      {score.map((f) => (
        <div key={f.key} className={`${s.scoreTile} ${f.good ? s.scoreGood : s.scoreBad}`}>
          <span className={s.scoreHead}>
            <span className={s.scoreName}>{f.name}</span>
            <span className={s.scoreState}><Icon name={f.good ? 'CircleCheck' : 'TriangleAlert'} size={15} />{f.good ? 'Working for you' : 'Costing you'}</span>
          </span>
          <span className={s.scoreNum}>{usd(f.effect, true)}</span>
          <span className={s.scoreSub}>{f.sub} than {vs}</span>
          {f.fix ? (
            <button type="button" className={s.scoreFix} onClick={() => open(f.fix)}>
              <span className={s.scoreFixLbl}>{f.good ? 'Grow it' : f.fix.prevent ? 'Avoid it' : 'Win it back'}: <b>{usd(f.fix.worth)}/wk</b></span>
              <span className={s.scoreFixTitle}>{f.fix.title}</span>
              <Icon name="ArrowRight" size={15} />
            </button>
          ) : <span className={s.scoreNone}>No action needed this week</span>}
        </div>
      ))}
    </div>
  );
}

function StepWhy({ v, comparator, setComparator }) {
  const dec = v.decomposition;
  const [weeks, setWeeks] = React.useState(false);
  const avail = v.comparators.filter((c) => c.available);
  const missing = v.comparators.filter((c) => !c.available);
  const line = (k) => dec?.lines.find((l) => l.key === k);
  const c = v.contribution;
  const ch = dec?.contribution.change;
  const red = (v.score || []).filter((f) => !f.good);
  const back = red.reduce((t, f) => t + (f.fix?.worth || 0), 0);
  const names = red.map((f) => f.name.toLowerCase()).join(' and ');
  const title = !dec ? 'No earlier week to compare with yet'
    : red.length && back >= 1 ? `Win back ${usd(back)} a week on ${names}`
      : red.length ? `${names.charAt(0).toUpperCase()}${names.slice(1)} cost you this week`
        : 'Sales, food and labor all worked for you';
  return (
    <Step n={1} id="week-why" kicker="How the week went" title={title}
      sub={dec ? `Your three numbers against ${vsPhrase(v.comparator)}. Tap a fix to add it to your plan; amounts are potential until tested.` : 'This fills in once there’s an earlier week of your own data.'}>
      {v.prime && (
        <div className={`${s.prime} ${v.prime.good ? s.primeGood : s.primeBad}`}>
          <span className={s.primeLbl}>Prime cost<small>food plus labor, out of every sales dollar</small></span>
          <span className={s.primeNum}>{(v.prime.now * 100).toFixed(1)}%</span>
          <span className={s.primeSub}>
            <Icon name={v.prime.good ? 'TrendingDown' : 'TrendingUp'} size={16} />
            {Math.abs(v.prime.points) < 0.05 ? `Same as ${vsPhrase(v.comparator)}` : `${Math.abs(v.prime.points).toFixed(1)} points ${v.prime.good ? 'better' : 'worse'} than ${vsPhrase(v.comparator)}`}
          </span>
          <span className={s.primeEq}>{usd(v.prime.food)} food + {usd(v.prime.labour)} labor, of {usd(v.prime.net)} in sales</span>
          <Claim k={v.contribution.claim} />
        </div>
      )}
      {v.calendar && !v.calendar.fair && (
        <div className={s.calNote} role="note">
          <Icon name="CalendarDays" size={16} />
          <span>
            {v.calendar.now.length ? `This week includes ${v.calendar.now.join(' and ')}. The weeks it is compared with are ordinary weeks.` : `The weeks this one is compared with include ${v.calendar.then.join(' and ')}. This week has no holiday.`} Read the comparison with care.
          </span>
          {v.calendar.suggest && <button type="button" className={s.linkBtn} onClick={() => setComparator(v.calendar.suggest)}>Compare with the same week last year</button>}
        </div>
      )}
      {v.score && <Scorecard score={v.score} vs={vsPhrase(v.comparator)} />}
      {v.industry?.length > 0 && (
        <div className={s.industry} aria-label="Industry numbers for this week">
          {v.industry.map((n) => (
            <div key={n.key} className={`${s.indTile} ${n.good === true ? s.indGood : n.good === false ? s.indBad : ''}`}>
              <span className={s.indLbl}>{n.label}</span>
              <span className={s.indNum}>{n.unit === 'pct' ? `${(n.value * 100).toFixed(1)}%` : cvMoney(n.value, { cents: true })}</span>
              <span className={s.indPlain}>{n.plain}</span>
              {n.then != null && <span className={s.indThen}>{(n.then * 100).toFixed(1)}% in {vsPhrase(v.comparator)}</span>}
              <Claim k={n.claim} />
            </div>
          ))}
        </div>
      )}
      {dec && (
        <div className={`${s.result} ${ch >= 0 ? s.resultGood : s.resultBad}`}>
          <span>Together you kept <b><Money id="earned-week">{usd(c.value)}</Money></b> after food and labor</span>
          <span className={s.resultNum}>{usd(ch, true)} vs {vsPhrase(v.comparator)}</span>
          <Claim k={c.claim} />
        </div>
      )}
      <div className={s.links}>
        {v.history.length > 1 && <button type="button" className={s.linkBtn} aria-expanded={weeks} onClick={() => setWeeks((x) => !x)}><Icon name="ChartColumn" size={15} />{weeks ? 'Hide' : 'See'} the last {v.history.length} weeks<Icon name={weeks ? 'ChevronUp' : 'ChevronDown'} size={14} /></button>}
        <More>
          “Kept” is net sales minus food cost minus hourly labor. It isn’t profit: rent and other costs aren’t taken off. Sales, food and labor add up exactly to the change. That describes the week; it doesn’t prove what caused it, and none of it is a saving we claim. Each fix is the plan’s best ready action for that number, shown at the amount we’d plan on until it’s tested. Food cost is plates sold × recipe cost{c.status === 'estimated' ? '; labor isn’t measured yet, so it’s estimated' : ''}.
          {dec ? ` Sales ${usd(line('net').now)} from ${Math.round(line('covers').now).toLocaleString('en-US')} covers at ${cvMoney(line('check').now, { cents: true })} each. ${v.comparator.desc}.` : ''}
          {missing.length ? ` Not available yet: ${missing.map((x) => `${x.label.toLowerCase()} (${x.reason.replace(/\.$/, '').toLowerCase()})`).join('; ')}.` : ''}
          {avail.length > 1 && <span className={s.moreToggle}><Toggle label="Compare with" options={avail.map((x) => ({ value: x.id, label: VS[x.id] ? VS[x.id].replace(/^your /, '') : x.label }))} value={comparator || v.comparator?.id} onChange={setComparator} /></span>}
        </More>
      </div>
      {weeks && <Weeks v={v} />}
    </Step>
  );
}

/**
 * Keep next week green (Ramidu, 2026-11-18): the line next week has to clear, the record against
 * it, and what's protecting it. Every number is the page's own: the comparison's normal week,
 * the last weeks against it, verified run-rate, the plan's potential, and what's being watched.
 */
function GreenTarget({ v, plan }) {
  const g = v.green;
  if (!g) return null;
  const items = plan?.committed
    ? plan.items.filter((i) => i.status !== 'dropped')
    : v.plan.proposal.filter((p) => !p.blocked).slice(0, PLAN_TOP);
  const potential = items.reduce((t, i) => t + (i.conservative ?? i.value), 0);
  const watched = v.attention.length + v.inFlight.length;
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className={s.green}>
      <div className={s.greenRecord}>
        <span className={s.greenLbl}>Next week’s line</span>
        <span className={s.greenNum}>{usd(g.line)}<span className={s.unit}> kept</span></span>
        <div className={s.dots} role="img" aria-label={`${g.count} of the last ${g.of} weeks kept at least ${usd(g.line)}`}>
          {g.weeks.map((w) => <span key={w.iso} title={`Week of ${w.label}: ${usd(w.earned)}`} className={`${s.dot} ${w.green ? s.dotGood : s.dotBad} ${w.current ? s.dotNow : ''}`}>{w.green ? <Icon name="Check" size={12} /> : <Icon name="Minus" size={12} />}</span>)}
        </div>
        <span className={s.greenSub}><b>{g.count} of your last {g.of} weeks</b> were green. The last mark is this week.</span>
      </div>
      <ul className={s.guards} aria-label="What keeps next week green">
        <li>
          <span className={`${s.guardIcon} ${v.banked.week > 0 ? s.guardGood : ''}`}><Icon name="ShieldCheck" size={18} /></span>
          <span className={s.guardText}><b>{v.banked.week > 0 ? `${usd(v.banked.week)}/wk already locked in` : 'Nothing verified yet'}</b><span>{v.banked.week > 0 ? 'Changes that passed their test and keep paying' : 'Each change starts paying once its test passes'}</span></span>
        </li>
        <li>
          <span className={s.guardIcon}><Icon name="ClipboardCheck" size={18} /></span>
          <span className={s.guardText}><b>{items.length ? `${usd(potential)}/wk from this week’s plan` : 'No actions picked yet'}</b><span>{items.length ? `${items.length} action${items.length === 1 ? '' : 's'} below · potential until tested` : 'Pick one below'}</span></span>
        </li>
        <li>
          <button type="button" className={s.guardBtn} onClick={() => go('week-attention')}>
            <span className={s.guardIcon}><Icon name="Eye" size={18} /></span>
            <span className={s.guardText}><b>{watched ? `${watched} risk${watched === 1 ? '' : 's'} I’m watching` : 'Nothing at risk right now'}</b><span>{v.attention.length ? `${v.attention.length} need you · ${v.inFlight.length} test${v.inFlight.length === 1 ? '' : 's'} running` : `${v.inFlight.length} test${v.inFlight.length === 1 ? '' : 's'} running`}</span></span>
          </button>
        </li>
      </ul>
    </div>
  );
}

/* Step 2: keep next week green, by picking what to do. */
function StepPlan({ v, rec }) {
  const cv = useCv();
  const [revising, setRevising] = React.useState(false);
  const plan = rec.plan;
  React.useEffect(() => setRevising(false), [v.roomId, v.period?.start]);
  const committed = plan?.committed;
  const defaults = committed && revising ? [
    ...plan.items.filter((i) => i.status !== 'dropped' && !(plan.revisions?.dropped || []).some((d) => d.id === i.id)).map((i) => ({ id: i.id, owner: i.owner, due: i.due })),
    ...(plan.revisions?.added || []).map((a) => ({ id: a.id, owner: CV_ROOM.gm || '', due: addDays(v.period.end, 7) })),
  ] : null;
  const ready = v.plan.proposal.filter((p) => !p.blocked).length;
  const done = committed ? plan.items.filter((i) => i.status === 'done').length : 0;
  const live = committed ? plan.items.filter((i) => i.status !== 'dropped').length : 0;
  return (
    <Step n={2} id="week-plan" kicker="What to do this week"
      title={committed && !revising ? `Keeping next week green: ${done} of ${live} done` : v.green ? `Keep next week above ${usd(v.green.line)}` : v.plan.ranked.length ? 'Pick this week’s actions, then commit them' : 'Nothing clears the bar this week'}
      sub={committed && !revising ? `Committed ${stampDay(committed.committedAt)}${plan.committedBy ? ` by ${plan.committedBy}` : ''} · mark each one as it moves` : `${ready} ready · fits ${hrs(v.plan.hours)} of manager time · amounts are potential until tested`}
      right={<button type="button" className={s.linkBtn} onClick={() => cv.go('meeting')}>Take it to the meeting<Icon name="ArrowRight" size={14} /></button>}>
      <GreenTarget v={v} plan={plan} />
      {!plan ? (rec.error ? <span className="cv-small cv-muted">{`Couldn’t load the plan: ${rec.error}`}</span> : <span className="cv-skel cv-skel-line" role="status" aria-label="Loading" style={{ display: 'block', width: 'min(320px, 100%)' }} />)
        : committed && !revising ? <PlanCommitted v={v} rec={rec} plan={plan} onRevise={() => setRevising(true)} />
          : v.plan.ranked.length === 0 ? null
            : <PlanDraft key={`${v.roomId}:${revising}`} v={v} rec={rec} defaults={defaults} onCancel={revising ? () => setRevising(false) : null} />}
      <More label={`${v.exposure.count} more ideas are still open`}>
        Together they’re estimated at <Money id="exposure"><b className="cv-num">{usd(v.exposure.value)}/wk</b></Money>. That’s never counted as saved; each one has to be tested first.
      </More>
    </Step>
  );
}

/* Step 3: what's in the way. */
function StepBlockers({ v }) {
  const cv = useCv();
  const [all, setAll] = React.useState(false);
  const n = v.attention.length;
  const list = all ? v.attention : v.attention.slice(0, 4);
  return (
    <Step n={3} id="week-attention" kicker="Clear what’s in the way" title={n ? `${n} ${n === 1 ? 'thing needs' : 'things need'} you` : 'Nothing is in the way'}
      sub={n ? 'Each one holds back advice or a test. Tap to fix it.' : `All clear at ${v.short}.`}>
      {n > 0 && (
        <ul className={s.rowList}>
          {list.map((a) => (
            <li key={a.id}>
              <button type="button" className={s.rowBtn} onClick={() => cv.go(a.go, a.goId ? { id: a.goId } : undefined)}>
                <span className={`cv-q-ico ${a.tone === 'neutral' ? '' : a.tone}`} aria-hidden="true"><Icon name={a.icon} size={17} /></span>
                <span className={s.rowText}><span className={s.attTitle}>{a.title}</span><span className={s.rowSub}>{a.cta}</span></span>
                <Icon name="ChevronRight" size={16} className={s.rowChev} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {n > 4 && <button type="button" className={s.linkBtn} aria-expanded={all} onClick={() => setAll((x) => !x)}>{all ? 'Show fewer' : `Show all ${n}`}<Icon name={all ? 'ChevronUp' : 'ChevronDown'} size={14} /></button>}
    </Step>
  );
}

/* Step 4: are your changes working? */
function StepResults({ v }) {
  const cv = useCv();
  const b = v.banked;
  const lead = b.lead;
  const sample = v.sample;
  const m = (x) => cvMoney(sample ? Math.round(x) : x, { cents: !sample && x % 1 !== 0 });
  const tests = v.inFlight;
  return (
    <Step n={4} id="week-results" kicker="Are your changes working?"
      title={b.week > 0 ? `${m(b.week)}/wk confirmed so far` : 'Nothing confirmed yet'}
      sub={`${tests.length ? `${tests.length} test${tests.length === 1 ? '' : 's'} running · ` : ''}only verified changes count`}>
      <div className={s.results}>
        <div className={s.resultFigs}>
          <Claim k="book" />
          <div><span className={s.heroLbl}>This week</span><span className={s.trioNum}>{m(b.accrued)}</span></div>
          <div><span className={s.heroLbl}>To date</span><span className={s.trioNum}><Fig id="to-date" show={sample}>{m(b.toDate)}</Fig></span></div>
          {sample && lead && <HowWeKnow proof={CV_D.proofs.find((p) => p.id === lead.id)} />}
        </div>
        <div className={s.list}>
          {tests.length === 0 && <span className="cv-small cv-muted">No tests running. Commit an action in step 2, then test it.</span>}
          {tests.map((t) => {
            const d = t.day ?? Math.round((t.progress / 100) * 28);
            return (
              <div key={t.id} className={s.testRow}>
                <div className="cv-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', gap: 8 }}>
                  <span className={s.testTitle}>{t.title}</span>
                  <StateChip tone={t.waiting ? 'warn' : ''} icon={t.waiting ? 'Hourglass' : 'FlaskConical'}>{t.waiting ? 'Waiting on data' : `Day ${d} of 28`}</StateChip>
                </div>
                <TestTrack day={d} waiting={t.waiting} label={t.title} />
              </div>
            );
          })}
        </div>
      </div>
      {b.newly.length > 0 && <span className="cv-small"><Icon name="BadgeCheck" size={14} className="cv-up" /> Newly confirmed: {b.newly.map((x) => x.title).join('; ')}</span>}
      {b.suspended.length > 0 && <span className="cv-small"><Icon name="CirclePause" size={14} /> Paused: {b.suspended.map((x) => x.title).join('; ')}</span>}
      <div className={s.links}>
        <button type="button" className={s.linkBtn} onClick={() => (sample && lead ? cv.go('packet', { id: lead.id }) : cv.go(v.real ? 'windows' : 'proof'))}>See the proof<Icon name="ArrowRight" size={14} /></button>
        <More>
          {lead ? <>{lead.title}: we count the cautious end of what it measured ({m(lead.bookable)}/wk{lead.point != null ? ` of ${m(lead.point)}/wk` : ''}). </> : null}
          “This week” is what confirmed changes earned on this week’s days; “/wk” is their weekly rate. Estimates and changes in what you kept are never added here.
          {tests.map((t) => ` ${t.title}: ${t.next}; guardrails: ${t.guardrail}.`).join('')}
          {lead && sample && lead.lo != null && <span style={{ display: 'block', marginTop: 10 }}><Interval lo={lead.lo} pt={lead.point} hi={lead.hi} min={Math.round(lead.lo * 0.6)} max={Math.round(lead.hi * 1.25)} billedLabel="what we count" /></span>}
        </More>
      </div>
    </Step>
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
    <section className={`cv-card ${s.step}`} id="week-review" aria-labelledby="week-review-t">
      <div className={s.stepHead}>
        <span className={`${s.stepNum} ${mine ? s.guideDone : ''}`} aria-hidden="true">{mine ? <Icon name="Check" size={14} /> : 5}</span>
        <div className={s.stepText}>
          <span className={s.kicker}>Last step</span>
          <h3 id="week-review-t" className={s.stepTitle}>{mine ? 'Week reviewed' : 'Close out the week'}</h3>
          <p className={s.stepSub}>{mine ? `${stampDay(mine.at)}${by(key) ? ` by ${by(key)}` : ''}. Everyone with this room sees your note.` : 'Mark it reviewed with a line on what you decided. Everyone with this room sees it.'}</p>
        </div>
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
            <Button size="sm" variant="secondary" icon="ClipboardCheck" onClick={save}>{mine ? 'Save the note' : 'Mark the week reviewed'}</Button>
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
  useTodayTheme(false);
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
      <div className={`cv-page ${s.page}`} data-page="week">
        <PageHead over={CV_ROOM.name} q={q} />
        <Waiting v={v} />
      </div>
    );
  }
  const reviewed = v.period && reviews[v.period.start];
  const committed = !!rec.plan?.committed;
  const n = v.attention.length;
  const guide = [
    { id: 'week-why', label: 'How the week went', state: v.decomposition ? `${usd(v.decomposition.contribution.change, true)} vs ${vsPhrase(v.comparator)}` : 'Waiting on an earlier week', done: false },
    { id: 'week-plan', label: 'Keep next week green', state: committed ? 'Plan committed' : `${v.plan.proposal.filter((p) => !p.blocked).length} actions to commit`, done: committed },
    { id: 'week-attention', label: 'What’s in the way', state: n ? `${n} to clear` : 'Nothing', done: n === 0 },
    { id: 'week-results', label: 'Your results', state: v.banked.week > 0 ? `${usd(v.banked.week)}/wk confirmed` : `${v.inFlight.length} running`, done: false },
  ];
  return (
    <div className={`cv-page ${s.page}`} data-page="week">
      <header className={s.head}>
        <span className={s.context}>
          <span>{CV_ROOM.name} · Week of {v.period.label}{v.status === 'complete' ? '' : ' (in progress)'}</span>
          <span className={s.contextMute}>Data through {day(v.dataThrough)}</span>
          {v.contribution.status === 'estimated' && <StateChip tone="warn" icon="CircleDashed">Labor estimated</StateChip>}
          {reviewed && <StateChip tone="good" icon="ClipboardCheck">Week reviewed</StateChip>}
        </span>
        <h2 className={s.headline}>{answerOf(v)}</h2>
      </header>
      <Guide items={guide} />
      <StepWhy v={v} comparator={comparator} setComparator={setComparator} />
      <StepPlan v={v} rec={rec} />
      <StepBlockers v={v} />
      <StepResults v={v} />
      <CloseOut v={v} names={rec.names} />
      <DayByDay />
    </div>
  );
}

/** The daily table, for anyone who wants it; folded away by default. */
function DayByDay() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" className={s.linkBtn} style={{ alignSelf: 'center' }} aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <Icon name="CalendarRange" size={15} />{open ? 'Hide' : 'Show'} the week day by day<Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} />
      </button>
      {open && <DenseWeek />}
    </>
  );
}

export { CvThisWeek };
