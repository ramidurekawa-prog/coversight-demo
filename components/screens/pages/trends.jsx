'use client';

import * as React from 'react';

import { Button, Icon, Tabs } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { CV_D, CV_GROUP, CV_ROOM, Callout, Claim, PageHead, Pill, useCv } from '../core';
import { DenseTrends } from '../dense-sections';
import { dataEnd } from '../../../lib/data/readers';
import {
  CAUSES, JUDGE_WEEKS, METHOD, METRIC, METRICS, METRIC_GROUPS, MIN_BASELINE, RUN,
  availableMetrics, cleanNotes, directionOf, explainSignal, fmtChange, fmtMetric, groupTrend,
  isExplained, lastYearIndex, noteKey, rangesFor, signalKey, trendsCsv, trendsFor,
} from '../../../lib/data/page/trends';
import { Spark, TrendChart } from './trends-chart';
import s from './trends.module.css';

/* Trends: is the restaurant getting better or worse, and what should I do?
 * Built to be read in seconds: one verdict, four big numbers, one chart, and a
 * card per change with one thing to do. The reasoning (usual range, evidence,
 * arithmetic, notes) is one tap away on each card, and the method sits in
 * "About this data". Everything comes from lib/data/page/trends.js, the same
 * code the nightly `trends` job runs, so the page and the alerts agree.
 * Notes save per room (`trends.notes`). */

const SERIES_COLOR = 'var(--cat-1)';
const CMP_COLOR = 'var(--cat-3)';
const roomColor = (i) => `var(--cat-${(i % 3) + 1})`;
const SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low', info: 'Good news' };
const SEV_CLASS = { high: s.sevHigh, medium: s.sevMedium, low: s.sevLow, info: s.sevInfo };
const tone = (key, v) => (v == null || Math.abs(v) < 0.05 ? 'cv-faint' : (v > 0) === METRIC[key].up ? 'cv-up' : 'cv-down');
const shortDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const isMoney = (key) => ['money', 'cents'].includes(METRIC[key]?.unit);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The four numbers an owner looks at first; the rest are one tap away. */
const HEADLINE = ['earned', 'net', 'covers', 'prime'];

/** One thing to do for a change in the wrong direction, and where to do it. */
const TODO = {
  net: { label: 'Check daily sales', page: 'daily' },
  covers: { label: 'Check daily covers', page: 'daily' },
  check: { label: 'Review menu prices', page: 'menu' },
  earned: { label: 'See which cost moved', page: 'week' },
  prime: { label: 'Check labour and food', page: 'labour' },
  food: { label: 'Check food buying', page: 'purchasing' },
  labour: { label: 'Check the schedule', page: 'labour' },
  ot: { label: 'Check overtime', page: 'labour' },
  turn: { label: 'Check the kitchen', page: 'kitchen' },
  exc: { label: 'Check voids and comps', page: 'controls' },
  wcm: { label: 'Review dish margins', page: 'menu' },
};

function Delta({ metric, a, b, suffix, neutral, big }) {
  const c = fmtChange(metric, a, b);
  if (!c) return <span className="cv-xs cv-faint">No comparison yet</span>;
  return (
    <span className={`${s.delta} ${big ? s.deltaBig : ''} ${neutral ? 'cv-muted' : tone(metric, c.v)}`}>
      {Math.abs(c.v) >= 0.05 && <Icon name={c.v > 0 ? 'ArrowUp' : 'ArrowDown'} size={big ? 15 : 12} />}{c.text}
      {suffix && <span className={s.deltaSuffix}>&nbsp;{suffix}</span>}
    </span>
  );
}

function Seg({ value, onChange, items, label }) {
  return (
    <div className={s.seg} role="group" aria-label={label}>
      {items.map((it) => <button key={it.v} type="button" aria-pressed={it.v === value} onClick={() => onChange(it.v)}>{it.label}</button>)}
    </div>
  );
}

/** Metrics as a grouped select: only what the room has data for. */
function MetricSelect({ value, onChange, metrics, id, flagged = new Set() }) {
  return (
    <select id={id} className={s.select} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Measure">
      {METRIC_GROUPS.map((g) => {
        const ms = metrics.filter((m) => m.group === g);
        return ms.length ? <optgroup key={g} label={g}>{ms.map((m) => <option key={m.key} value={m.key}>{m.label}{flagged.has(m.key) ? ' (to look at)' : ''}</option>)}</optgroup> : null;
      })}
    </select>
  );
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Where each week sits, for the tooltip, the table and the week panel. */
function zoneOf(t, i) {
  if (t.closed[i]) return 'No sales: closed or missing';
  if (!t.w.ready) return 'Building the baseline';
  if (i < t.w.baseTo) return t.holidays[i].length ? 'Baseline week (holiday, left out)' : 'Baseline week';
  return t.holidays[i].length ? 'Judged week (holiday, not flagged)' : 'Judged week';
}

/** Where a value sits against its usual range: band, average tick, dot. */
function RangeBar({ value, lim, good }) {
  if (value == null || !lim) return null;
  const lo0 = Math.min(lim.lcl, value), hi0 = Math.max(lim.ucl, value);
  const pad = (hi0 - lo0) * 0.08 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  const p = (v) => ((v - lo) / (hi - lo)) * 100;
  return (
    <span className={s.range} aria-hidden="true">
      <span className={s.rangeBand} style={{ left: `${p(lim.lcl)}%`, width: `${p(lim.ucl) - p(lim.lcl)}%` }} />
      <span className={s.rangeMean} style={{ left: `${p(lim.mean)}%` }} />
      <span className={`${s.rangeDot} ${good ? s.dotGood : s.dotBad}`} style={{ left: `${p(value)}%` }} />
    </span>
  );
}

/** A bar that fills as the baseline weeks come in. */
function Progress({ have, need }) {
  const pct = Math.max(4, Math.min(100, (have / need) * 100));
  return <span className={s.progress} role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={have} aria-label="Weeks of history"><span style={{ width: `${pct}%` }} /></span>;
}

/* ------------------------------------------------------------- verdict */

const STATE = {
  improving: { word: 'Improving', icon: 'TrendingUp', cls: 'cv-up' },
  steady: { word: 'Steady', icon: 'CircleMinus', cls: '' },
  slipping: { word: 'Slipping', icon: 'TrendingDown', cls: 'cv-down' },
  unknown: { word: 'Building history', icon: 'Hourglass', cls: '' },
};

function Verdict({ t, notes, onInvestigate }) {
  const dir = directionOf(t);
  const st = STATE[dir.state];
  const open = t.signals.filter((x) => !x.good && x.severity !== 'low' && !isExplained(notes[signalKey(x, t.rows)]));
  const have = Math.max(0, MIN_BASELINE + 1 - t.w.needWeeks);
  return (
    <section className={`cv-card ${s.verdict}`} data-state={dir.state} aria-label="The answer">
      <div className={s.vPart}>
        <span className={`${s.vIcon} ${st.cls}`}><Icon name={st.icon} size={26} /></span>
        <span className="cv-col" style={{ gap: 2 }}>
          <span className={`${s.vWord} ${st.cls}`}>{st.word}</span>
          <span className="cv-xs cv-faint">{dir.state === 'unknown' ? `${plural(t.w.needWeeks, 'more week')} of data to go` : dir.state === 'steady' ? 'Within normal ups and downs' : `Last ${dir.weeks} weeks vs the ${dir.baseWeeks} before`}</span>
        </span>
      </div>
      {dir.state === 'unknown' ? (
        <div className={s.vStat}>
          <span className="cv-xs cv-faint">History</span>
          <span className={s.big}>{have}<small> / {MIN_BASELINE + 1} weeks</small></span>
          <Progress have={have} need={MIN_BASELINE + 1} />
        </div>
      ) : (
        <>
          <div className={s.vStat}>
            <span className="cv-xs cv-faint cv-row" style={{ gap: 6 }}>Contribution a week <Claim k={t.metrics.earned.claim} /></span>
            <span className={s.big}>{fmtMetric('earned', dir.recent)}</span>
            <Delta metric="earned" a={dir.recent} b={dir.base} suffix="vs usual" neutral={dir.state === 'steady'} big />
          </div>
          {dir.yoy && (
            <div className={s.vStat}>
              <span className="cv-xs cv-faint">Same weeks last year</span>
              <span className={s.big}>{fmtMetric('earned', dir.yoy.then)}</span>
              <Delta metric="earned" a={dir.yoy.now} b={dir.yoy.then} suffix="now vs then" big />
            </div>
          )}
        </>
      )}
      <div className={s.vAct}>
        {open.length ? (
          <>
            <span className={`${s.vCount} cv-down`}><Icon name="TriangleAlert" size={18} />{plural(open.length, 'thing')} to look at</span>
            <Button size="sm" iconRight="ArrowRight" onClick={() => onInvestigate(open[0])}>{METRIC[open[0].metric].short} first</Button>
          </>
        ) : (
          <span className={`${s.vCount} cv-up`}><Icon name="CircleCheck" size={18} />{t.w.ready ? 'Nothing to act on' : 'Nothing judged yet'}</span>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- big numbers */

function Tiles({ t, metric, onPick }) {
  const avail = availableMetrics(t);
  const keys = [...HEADLINE.filter((k) => t.metrics[k].available), ...avail.map((m) => m.key).filter((k) => !HEADLINE.includes(k))].slice(0, 4);
  const n = t.rows.length;
  return (
    <div className={s.tiles}>
      {keys.map((k) => {
        const m = METRIC[k];
        const x = t.metrics[k];
        const sig = t.signals.find((q) => q.metric === k && q.ongoing);
        const mark = sig ? (sig.good ? 'good' : 'bad') : null;
        return (
          <button key={k} type="button" className={s.tile} aria-pressed={metric === k} onClick={() => onPick(k)}>
            <span className={s.tileHead}>
              <span className="cv-xs cv-muted cv-row" style={{ gap: 6 }}>{mark && <i className={`${s.dot} ${mark === 'bad' ? s.dotBad : s.dotGood}`} aria-label={mark === 'bad' ? 'Unusual, wrong direction' : 'Unusual, good direction'} />}{m.short}<span className={s.wk}> · this week</span></span>
              {isMoney(k) && <Claim k={x.claim} />}
            </span>
            <span className={s.tileVal}>{fmtMetric(k, x.latest)}</span>
            {x.lim && x.latest != null ? <Delta metric={k} a={x.latest} b={x.lim.mean} suffix="vs usual" /> : <span className="cv-xs cv-faint">{x.latest == null ? 'No value this week' : 'No usual range yet'}</span>}
            <Spark vals={x.vals.slice(Math.max(t.w.from, n - JUDGE_WEEKS))} lim={x.lim} mark={mark} height={34} ariaLabel={`${m.label}, last ${JUDGE_WEEKS} weeks`} />
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- changes */

function NoteForm({ note, onSave, onRemove, onCancel }) {
  const [cause, setCause] = React.useState(note?.cause ?? '');
  const [text, setText] = React.useState(note?.text ?? '');
  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (cause) onSave({ cause, text: text.trim() }); }}>
      <span className="cv-xs cv-muted">What explains it?</span>
      <div className={s.causes} role="group" aria-label="What explains it">
        {CAUSES.map((c) => <button key={c.value} type="button" className={s.cause} aria-pressed={cause === c.value} title={c.hint} onClick={() => setCause(c.value)}>{c.label}</button>)}
      </div>
      <textarea className={s.textarea} maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
      <div className="cv-row" style={{ gap: 8 }}>
        <Button size="sm" type="submit" disabled={!cause}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        {note && <Button size="sm" variant="ghost" icon="Trash2" onClick={onRemove} style={{ marginLeft: 'auto' }}>Remove</Button>}
        <span className="cv-xs cv-faint" style={{ marginLeft: note ? 0 : 'auto' }}>{text.length}/280</span>
      </div>
    </form>
  );
}

function ChangeCard({ sig, t, note, open, editing, onPick, onToggle, onEdit, onSave, onRemove, onCancel, onCompare }) {
  const cv = useCv();
  const rows = t.rows;
  const m = METRIC[sig.metric];
  const explained = isExplained(note);
  const kind = sig.good ? 'good' : explained ? 'done' : 'bad';
  const cause = note && CAUSES.find((c) => c.value === note.cause);
  const shown = sig.kind === 'limit' ? sig.value : sig.avg;
  const why = open ? explainSignal(sig, t, { proofs: CV_D.proofs, candidates: CV_D.candidates }) : null;
  const todo = TODO[sig.metric];
  const when = sig.weeks === 1 ? `Week of ${rows[sig.from]?.label}` : `${sig.weeks} weeks${sig.ongoing ? ', still going' : `, to ${rows[sig.to]?.label}`}`;
  return (
    <div className={s.card} data-kind={kind} data-on={open || editing}>
      <button type="button" className={s.cardHead} onClick={onPick} aria-label={`Show ${m.label} on the chart`}>
        <span className={`${s.sigIco} ${s[kind]}`}><Icon name={explained ? 'CircleCheck' : sig.dir === 'up' ? 'TrendingUp' : 'TrendingDown'} size={15} /></span>
        <span className="cv-col" style={{ gap: 1, flex: 1, minWidth: 0 }}>
          <span className={s.cardTitle}>{m.short} {sig.kind === 'shift' ? `shifted ${sig.dir}` : sig.dir === 'up' ? 'high' : 'low'}</span>
          <span className="cv-xs cv-faint">{when}</span>
        </span>
        <span className={`${s.sev} ${SEV_CLASS[sig.severity]}`}>{SEV_LABEL[sig.severity]}</span>
      </button>
      <div className={s.cardNum}>
        <span className={s.cardVal}>{fmtMetric(sig.metric, shown)}</span>
        <span className="cv-xs cv-faint">{sig.kind === 'shift' ? 'average' : sig.dir === 'up' ? 'highest' : 'lowest'} · usual {fmtMetric(sig.metric, sig.expected.lcl)} to {fmtMetric(sig.metric, sig.expected.ucl)}</span>
        {isMoney(sig.metric) && <Claim k={t.metrics[sig.metric].claim} />}
      </div>
      <RangeBar value={shown} lim={sig.expected} good={sig.good} />
      <div className={s.cardAct}>
        {sig.good ? <Pill tone="good" icon="TrendingUp">Good news</Pill>
          : cause ? <Pill tone={explained ? 'neutral' : 'warn'} icon={explained ? 'CircleCheck' : 'Hourglass'}>{cause.label}</Pill>
            : todo && <Button size="sm" variant={sig.severity === 'low' ? 'secondary' : 'primary'} iconRight="ArrowRight" onClick={() => cv.go(todo.page)}>{todo.label}</Button>}
        <span className={s.cardLinks}>
          <button type="button" className={s.linkBtn} onClick={onToggle} aria-expanded={open}>Why?</button>
          {!editing && <button type="button" className={s.linkBtn} onClick={onEdit}>{note ? 'Edit note' : 'Explain'}</button>}
        </span>
      </div>
      {note?.text && !editing && <span className={s.noteText}>“{note.text}”</span>}
      {open && why && (
        <div className={s.details}>
          <dl className={s.facts}>
            <dt>Weeks</dt><dd>{rows[sig.from]?.label} to {rows[sig.to]?.label} ({plural(sig.weeks, 'week')})</dd>
            <dt>Usual</dt><dd>{fmtMetric(sig.metric, sig.expected.lcl)} to {fmtMetric(sig.metric, sig.expected.ucl)}, average {fmtMetric(sig.metric, sig.expected.mean)}</dd>
            <dt>Size</dt><dd>{sig.z} standard deviations</dd>
            <dt>Evidence</dt><dd>{sig.kind === 'limit' ? `${plural(sig.breaches, 'week')} outside the range` : `${sig.weeks} weeks in a row on one side (rule: ${RUN})`}, {sig.n} baseline weeks{sig.limited ? ', limited history' : ''}</dd>
            <dt>Data</dt><dd>{t.w.own ? 'Your Toast data' : 'Sample data'}{t.metrics[sig.metric].claim === 'mod' ? ', food modelled' : ''}</dd>
          </dl>
          {why.arithmetic.length > 0 && <div className={s.why}><b>What moved</b><ul>{why.arithmetic.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {why.possible.length > 0 && <div className={s.why}><b>Worth checking</b><ul>{why.possible.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {why.related.length > 0 && <div className={s.why}><b>Changes on the same lever</b><ul>{why.related.map((p) => <li key={p.id}>{p.title} ({p.outcome}{p.since ? `, since ${p.since}` : ''}), measured on Proof</li>)}</ul></div>}
          <span className="cv-xs cv-faint">The figures alone can&apos;t prove the cause.</span>
          <div className={s.acts}>
            <Button size="sm" variant="ghost" icon="GitCompareArrows" onClick={onCompare}>Compare</Button>
            {why.finding && <Button size="sm" variant="ghost" icon="ListChecks" onClick={() => cv.go('finding', { id: why.finding.id })}>Finding</Button>}
          </div>
        </div>
      )}
      {editing && <NoteForm note={note} onSave={onSave} onRemove={onRemove} onCancel={onCancel} />}
    </div>
  );
}

function Changes({ t, notes, setNotes, focus, setFocus, onPick, onCompare }) {
  const [editing, setEditing] = React.useState(null);
  const [showGood, setShowGood] = React.useState(false);
  const keyed = t.signals.map((sig) => ({ sig, key: signalKey(sig, t.rows) }));
  const bad = keyed.filter((x) => !x.sig.good);
  const unexplained = bad.filter((x) => !isExplained(notes[x.key]));
  const good = keyed.filter((x) => x.sig.good);
  const list = [...unexplained, ...bad.filter((x) => isExplained(notes[x.key])), ...(showGood ? good : [])];
  const save = (sig, key) => (v) => {
    setNotes((cur) => ({ ...cleanNotes(cur), [key]: { ...v, at: new Date().toISOString() } }), `Trends note: ${METRIC[sig.metric].label}, week of ${t.rows[sig.from]?.label} (${CAUSES.find((c) => c.value === v.cause)?.label})`);
    setEditing(null);
  };
  const remove = (sig, key) => () => {
    setNotes((cur) => { const next = { ...cleanNotes(cur) }; delete next[key]; return next; }, `Trends note removed: ${METRIC[sig.metric].label}, week of ${t.rows[sig.from]?.label}`);
    setEditing(null);
  };
  const have = Math.max(0, MIN_BASELINE - t.w.needWeeks);
  const toAct = unexplained.filter((x) => x.sig.severity !== 'low').length; // same count as the verdict and the alerts
  return (
    <section className="cv-card" aria-labelledby="trends-signals">
      <div className="cv-card-head">
        <span className="cv-h4" id="trends-signals">What to look at</span>
        {t.w.ready && <Pill tone={toAct ? 'warn' : 'good'} icon={toAct ? 'TriangleAlert' : 'CircleCheck'}>{toAct ? `${toAct} to act on` : 'All clear'}</Pill>}
      </div>
      {!t.w.ready ? (
        <div className={s.empty}>
          <Icon name="Hourglass" size={28} />
          <span className={s.emptyBig}>{have} of {MIN_BASELINE} weeks</span>
          <Progress have={have} need={MIN_BASELINE} />
          <span className="cv-xs cv-faint">Changes are flagged once there&apos;s enough history.</span>
        </div>
      ) : (
        <div className={s.cards}>
          {list.map(({ sig, key }) => (
            <ChangeCard key={key} sig={sig} t={t} note={notes[key]} open={focus === key} editing={editing === key}
              onPick={() => onPick(sig, key)} onToggle={() => setFocus(focus === key ? null : key)} onCompare={() => onCompare(sig)}
              onEdit={() => setEditing(key)} onSave={save(sig, key)} onRemove={remove(sig, key)} onCancel={() => setEditing(null)} />
          ))}
          {!bad.length && (
            <div className={s.empty}>
              <span className="cv-up"><Icon name="CircleCheck" size={28} /></span>
              <span className={s.emptyBig}>Nothing unusual</span>
              <span className="cv-xs cv-faint">Every measure is inside its usual range.</span>
            </div>
          )}
          {good.length > 0 && <button type="button" className={s.more} onClick={() => setShowGood((v) => !v)} aria-expanded={showGood}>{showGood ? 'Hide good news' : `Show ${good.length} good news`}</button>}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- the week */

function WeekPanel({ t, i, metric, setMetric, notes, metrics, onClose }) {
  const r = t.rows[i];
  const weekNotes = METRICS.map((m) => ({ m, n: notes[noteKey(r.iso, m.key)] })).filter((x) => x.n);
  const flagged = new Map();
  t.signals.forEach((sig) => { if (i >= sig.from && i <= sig.to) flagged.set(sig.metric, sig.good ? 'good' : 'bad'); });
  return (
    <div className={s.week} aria-live="polite">
      <div className="cv-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span className="cv-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="cv-h4">Week of {shortDate(r.iso) || r.label}</span>
          {t.holidays[i].length > 0 && <Pill tone="neutral" icon="CalendarDays">{t.holidays[i].join(', ')}</Pill>}
        </span>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <div className={s.weekGrid}>
        {metrics.map((m) => {
          const x = t.metrics[m.key];
          const v = x.vals[i];
          const flag = flagged.get(m.key);
          return (
            <button key={m.key} type="button" className={s.weekCell} aria-pressed={metric === m.key} onClick={() => setMetric(m.key)}>
              <span className="cv-xs cv-faint cv-row" style={{ gap: 6 }}>{flag && <i className={`${s.dot} ${flag === 'bad' ? s.dotBad : s.dotGood}`} />}{m.short}</span>
              <span className={s.weekVal}>{fmtMetric(m.key, v)}</span>
              {x.lim && v != null ? <Delta metric={m.key} a={v} b={x.lim.mean} suffix="vs usual" /> : <span className="cv-xs cv-faint">—</span>}
            </button>
          );
        })}
      </div>
      {weekNotes.map(({ m, n }) => <span key={m.key} className="cv-xs cv-muted"><b>{m.short}:</b> {CAUSES.find((c) => c.value === n.cause)?.label}{n.text ? `. ${n.text}` : ''}</span>)}
    </div>
  );
}

/** The numbers behind the chart, for screen readers and anyone who prefers a table. */
function DataTable({ t, metric, start, end, cmp }) {
  const x = t.metrics[metric];
  const idx = [];
  for (let i = end; i >= start; i--) idx.push(i);
  return (
    <div className="cv-tablewrap" tabIndex={0} role="group" aria-label={`${METRIC[metric].label} by week`}>
      <table className="cv-table">
        <thead><tr><th>Week of</th><th className="r">{METRIC[metric].label}</th>{cmp && <th className="r">{cmp.label}</th>}<th className="r">Usual range</th><th>Status</th></tr></thead>
        <tbody>{idx.map((i) => {
          const v = x.vals[i];
          const sig = t.signals.find((q) => q.metric === metric && i >= q.from && i <= q.to);
          return (
            <tr key={i}>
              <td style={{ whiteSpace: 'nowrap' }}>{shortDate(t.rows[i].iso) || t.rows[i].label}{t.holidays[i].length ? <span className="cv-xs cv-faint"> · {t.holidays[i].join(', ')}</span> : null}</td>
              <td className="r cv-num">{fmtMetric(metric, v)}</td>
              {cmp && <td className="r cv-num">{fmtMetric(metric, cmp.vals[i])}</td>}
              <td className="r cv-num">{x.lim ? `${fmtMetric(metric, x.lim.lcl)} to ${fmtMetric(metric, x.lim.ucl)}` : '—'}</td>
              <td className="cv-xs">{v == null ? 'Gap' : sig && !t.holidays[i].length ? `${sig.good ? 'Good-direction' : 'Wrong-direction'} change` : zoneOf(t, i)}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- the room */

function RoomView({ t, notes, setNotes }) {
  const n = t.rows.length;
  const metrics = availableMetrics(t);
  const ranges = rangesFor(t);
  const [metric, setMetric] = React.useState(metrics.find((mm) => mm.key === 'earned')?.key ?? metrics[0]?.key ?? 'net');
  const [range, setRange] = React.useState(ranges.at(-1)?.v ?? n);
  const [cmpMode, setCmp] = React.useState('none');
  const [sel, setSel] = React.useState(null);
  const [focus, setFocus] = React.useState(null);
  const [table, setTable] = React.useState(false);
  const chartRef = React.useRef(null);
  const m = METRIC[metric] ?? METRIC.net;
  const x = t.metrics[m.key];
  const end = n - 1;
  const start = Math.max(t.w.from, n - range);
  const selected = sel != null && sel < n ? sel : null;
  const marks = {};
  t.signals.filter((sig) => sig.metric === m.key).forEach((sig) => { for (let k = sig.from; k <= sig.to; k++) if (x.vals[k] != null && !t.holidays[k].length) marks[k] = sig.good ? 'good' : 'bad'; });
  const noted = new Set(t.signals.filter((sig) => sig.metric === m.key && notes[signalKey(sig, t.rows)]).map((sig) => sig.from));
  const lyVals = t.rows.map((_, i) => { const j = lastYearIndex(t.rows, i, t.w); return j == null ? null : x.vals[j]; });
  const hasLy = lyVals.slice(start, end + 1).filter((v) => v != null).length >= 4;
  const span = end - start + 1;
  const prevVals = t.rows.map((_, i) => (i - span >= t.w.from ? x.vals[i - span] : null));
  const hasPrev = prevVals.slice(start, end + 1).some((v) => v != null);
  const cmp = cmpMode === 'ly' && hasLy ? { label: 'Last year', vals: lyVals } : cmpMode === 'prev' && hasPrev ? { label: `${span} weeks earlier`, vals: prevVals } : null;
  const events = [
    ...t.holidays.map((h, i) => (h.length ? { i, kind: 'holiday', label: h.join(', ') } : null)).filter(Boolean),
    ...CV_D.proofs.filter((p) => (p.outcome === 'verified' || p.outcome === 'limited') && p.since).map((p) => {
      let i = -1;
      for (let k = n - 1; k >= t.w.from; k--) if (t.rows[k].label === p.since) { i = k; break; }
      return i < 0 ? null : { i, kind: 'proof', label: `Verified change started: ${p.title}` };
    }).filter(Boolean),
  ];
  const toChart = () => chartRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const pickMetric = (k) => { setMetric(k); setFocus(null); };
  const pick = (sig, key) => {
    setMetric(sig.metric);
    setFocus(key);
    setSel(sig.to);
    if (sig.from < start) setRange(ranges.at(-1)?.v ?? n);
    toChart();
  };
  const compare = (sig) => { pick(sig, signalKey(sig, t.rows)); setCmp(hasLy ? 'ly' : 'prev'); };
  const series = [{ key: m.key, label: m.short, color: SERIES_COLOR, vals: x.vals }];
  if (cmp) series.push({ key: 'cmp', label: cmp.label, color: CMP_COLOR, vals: cmp.vals, dash: '5 4', thin: true });
  const fmt = (v, axis) => (axis && m.unit === 'money' ? fmtMetric(m.key, Math.round(v / 100) * 100) : fmtMetric(m.key, v));
  const flaggedMetrics = new Set(t.signals.filter((q) => !q.good && !isExplained(notes[signalKey(q, t.rows)])).map((q) => q.metric));
  const unitLabel = { money: 'US$ per week', cents: 'US$', count: 'per week', pct: '% of net sales', pct1: '% of net sales', mins: 'minutes per week', minutes: 'minutes' }[m.unit];
  const dataThrough = dataEnd(CV_D.room);
  const rangeItems = ranges.map((r) => ({ v: r.v, label: r.label.replace(/^All (\d+) weeks$/, 'All') }));
  return (
    <>
      <Verdict t={t} notes={notes} onInvestigate={(sig) => pick(sig, signalKey(sig, t.rows))} />
      <Tiles t={t} metric={m.key} onPick={pickMetric} />

      <div className={s.main}>
        <section className="cv-card" aria-labelledby="trends-chart" ref={chartRef}>
          <div className={s.toolbar}>
            <span className="cv-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <MetricSelect id="trends-metric" value={m.key} onChange={pickMetric} metrics={metrics} flagged={flaggedMetrics} />
              <Claim k={x.claim} />
            </span>
            <Seg label="Range" value={range} onChange={setRange} items={rangeItems} />
          </div>
          <span className="sr-only" id="trends-chart">{m.label}, weekly</span>
          <TrendChart labels={t.rows.map((r) => r.label)} series={series} lim={x.lim} start={start} end={end} baseTo={t.w.ready ? t.w.baseTo : null}
            marks={marks} noted={noted} events={events} selected={selected} onSelect={setSel} fmt={fmt} height={300} yLabel={unitLabel}
            ariaLabel={`${m.label} by week, ${shortDate(t.rows[start]?.iso)} to ${shortDate(t.rows[end]?.iso)}, in ${unitLabel}. Use the arrow keys to move between weeks; the data table has every value.`}
            tip={{ title: (i) => `Week of ${shortDate(t.rows[i].iso) || t.rows[i].label}`, extra: (i) => <span className="cv-faint">{t.holidays[i].length ? t.holidays[i].join(', ') : marks[i] ? (marks[i] === 'bad' ? 'Unusual, wrong direction' : 'Unusual, good direction') : x.lim && x.vals[i] != null ? <Delta metric={m.key} a={x.vals[i]} b={x.lim.mean} suffix="vs usual" /> : zoneOf(t, i)}</span> }} />
          <div className={s.chartFoot}>
            <div className="cv-legend">
              {x.lim && <span><i className={s.legendBand} />Usual range</span>}
              {Object.values(marks).includes('bad') && <span><i className={`${s.dot} ${s.dotBad}`} />Wrong way</span>}
              {Object.values(marks).includes('good') && <span><i className={`${s.dot} ${s.dotGood}`} />Good way</span>}
              {cmp && <span><i className={s.legendLine} style={{ borderColor: CMP_COLOR, borderTopStyle: 'dashed' }} />{cmp.label}</span>}
              {events.some((e) => e.kind === 'holiday' && e.i >= start) && <span><i className={s.legendHoliday} />Holiday</span>}
              {events.some((e) => e.kind === 'proof' && e.i >= start) && <span><i className={s.legendProof} />Verified change</span>}
            </div>
            <span className="cv-row" style={{ gap: 8 }}>
              {(hasPrev || hasLy) && <Seg label="Compare with" value={cmpMode} onChange={setCmp} items={[{ v: 'none', label: 'No compare' }, ...(hasPrev ? [{ v: 'prev', label: 'Before' }] : []), ...(hasLy ? [{ v: 'ly', label: 'Last year' }] : [])]} />}
              <Button size="sm" variant="ghost" icon="FileSpreadsheet" aria-pressed={table} aria-label={table ? 'Hide data table' : 'Show data table'} title="Data table" onClick={() => setTable((v) => !v)} />
            </span>
          </div>
          {selected == null && <span className="cv-xs cv-faint">Tap a week for every measure.</span>}
          {table && <DataTable t={t} metric={m.key} start={start} end={end} cmp={cmp} />}
          {selected != null && <WeekPanel t={t} i={selected} metric={m.key} setMetric={pickMetric} notes={notes} metrics={metrics} onClose={() => setSel(null)} />}
        </section>
        <Changes t={t} notes={notes} setNotes={setNotes} focus={focus} setFocus={setFocus} onPick={pick} onCompare={compare} />
      </div>

      {metrics.length > 4 && (
        <details className={`cv-card ${s.disclosure}`}>
          <summary><Icon name="ChevronDown" size={16} className={s.chev} />All {metrics.length} measures</summary>
          <div className={s.minis}>
            {metrics.map((mm) => {
              const xx = t.metrics[mm.key];
              const ongoing = t.signals.find((sig) => sig.metric === mm.key && sig.ongoing);
              const mark = ongoing ? (ongoing.good ? 'good' : 'bad') : null;
              return (
                <button key={mm.key} type="button" className={s.mini} aria-pressed={m.key === mm.key} onClick={() => { pickMetric(mm.key); toChart(); }}>
                  <span className={s.miniHead}><span className="cv-xs cv-muted">{mm.short}</span>{isMoney(mm.key) ? <Claim k={xx.claim} /> : null}</span>
                  <span className={s.miniHead}><span className={s.miniVal}>{fmtMetric(mm.key, xx.latest)}</span>{xx.lim && xx.latest != null ? <Delta metric={mm.key} a={xx.latest} b={xx.lim.mean} /> : <span className="cv-xs cv-faint">—</span>}</span>
                  <Spark vals={xx.vals.slice(Math.max(t.w.from, n - JUDGE_WEEKS))} lim={xx.lim} mark={mark} ariaLabel={`${mm.label}, last ${JUDGE_WEEKS} weeks`} />
                </button>
              );
            })}
          </div>
        </details>
      )}

      <details className={`cv-card ${s.disclosure}`}>
        <summary><Icon name="ChevronDown" size={16} className={s.chev} />About this data</summary>
        <div className={s.about}>
          <dl className={s.facts}>
            <dt>Source</dt><dd>{t.w.own ? 'Your Toast data, your own weeks only' : 'The sample group'}</dd>
            <dt>Data through</dt><dd>{shortDate(dataThrough || t.rows[n - 1]?.iso)}</dd>
            <dt>Usual range</dt><dd>{x.lim ? `Average ± 3 standard deviations of ${x.lim.n} baseline weeks${x.lim.limited ? ' (limited history)' : ''}` : 'Not enough weeks yet'}</dd>
            <dt>Flagged when</dt><dd>A week leaves its usual range, or {RUN} weeks in a row sit on one side of the average. Holiday and no-sales weeks are never flagged.</dd>
            <dt>Alerts</dt><dd>Medium and high changes nobody has explained are sent to the room once.</dd>
            <dt>Method</dt><dd>{METHOD}</dd>
          </dl>
          <span className="cv-xs cv-muted">{t.w.own
            ? <>The sample&apos;s weeks are never shown or used. Food is net sales × this room&apos;s food rate until supplier invoices are in, so food, prime cost and contribution are <b>Modelled</b>. Contribution is before rent and overheads: it is not profit.</>
            : <>Sample history. Connect Toast and this page judges your own weeks, once {MIN_BASELINE + 1} are in. Contribution is before rent and overheads: it is not profit.</>}</span>
        </div>
      </details>
    </>
  );
}

/* ------------------------------------------------------------- the group */

const GROUP_METRICS = ['net', 'earned', 'covers', 'check', 'prime', 'food', 'labour'];

function GroupView({ onOpen }) {
  const rooms = CV_GROUP.rooms;
  const [metric, setMetric] = React.useState('net');
  const [sel, setSel] = React.useState(null);
  const [table, setTable] = React.useState(false);
  const perSeat = metric === 'earned';
  const g = React.useMemo(() => groupTrend(rooms, metric), [rooms, metric]);
  const seats = Object.fromEntries(rooms.map((d) => [d.id, d.profile?.seats || 1]));
  const mDef = METRIC[metric];
  const showTotal = !!g.total && !perSeat && mDef.agg !== 'sum';
  const series = g.series.map((r, i) => ({ key: r.id, label: r.name, color: roomColor(i), vals: perSeat ? r.vals.map((v) => (v == null ? null : v / seats[r.id])) : r.vals, thin: showTotal }));
  if (showTotal) series.push({ key: 'total', label: 'Group (weighted)', color: 'var(--fg-1)', vals: g.total, dash: '7 3', bold: true });
  const fmt = (v) => (v == null ? '—' : perSeat ? `${fmtMetric('earned', v)}/seat` : fmtMetric(metric, v));
  const n = g.isos.length;
  const notesFor = (id) => cleanNotes(engine.saved('trends.notes', id));
  const claim = rooms.some((d) => d.hist.rows.at(-1)?.own) && mDef.food ? 'mod' : 'obs';
  const cards = rooms.map((d, k) => {
    const t = trendsFor(d.hist.rows);
    const x = t.metrics[metric];
    const div = perSeat ? seats[d.id] : 1;
    const recent = t.w.ready ? x.vals.slice(t.w.judgeFrom).filter((v) => v != null) : [];
    const rMean = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length / div : null;
    const bMean = x.lim ? x.lim.mean / div : null;
    const nb = notesFor(d.id);
    const open = t.signals.filter((sig) => !sig.good && sig.severity !== 'low' && !isExplained(nb[signalKey(sig, t.rows)])).length;
    const latest = x.latest == null ? null : x.latest / div;
    return { d, k, t, x, div, rMean, bMean, open, latest };
  });
  const top = Math.max(...cards.map((c) => Math.abs(c.latest ?? 0)), 1);
  const groupNow = g.total ? g.total.at(-1) : null;
  return (
    <>
      <div className={s.toolbar}>
        <Seg label="Measure" value={metric} onChange={setMetric} items={GROUP_METRICS.map((k) => ({ v: k, label: k === 'earned' ? 'Contribution/seat' : METRIC[k].short }))} />
        <Claim k={claim} />
      </div>
      <div className={s.tiles}>
        {!perSeat && groupNow != null && (
          <div className={`${s.tile} ${s.tileStatic}`}>
            <span className={s.tileHead}><span className="cv-xs cv-muted">Group · this week{g.excluded.length ? ' (your rooms)' : ''}</span></span>
            <span className={s.tileVal}>{fmtMetric(metric, groupNow)}</span>
            <span className="cv-xs cv-faint">{g.weighted ? 'Weighted by sales' : 'All rooms added up'}</span>
          </div>
        )}
        {cards.map(({ d, k, t, x, div, rMean, bMean, open, latest }) => (
          <button key={d.id} type="button" className={s.tile} onClick={() => onOpen(d.id)} aria-label={`Open ${d.profile?.short || d.id}`}>
            <span className={s.tileHead}>
              <span className="cv-xs cv-muted cv-row" style={{ gap: 6 }}><i className={s.dot} style={{ background: roomColor(k) }} />{d.profile?.short || d.id}{t.w.own ? '' : ' · sample'}</span>
              {t.w.ready && (open ? <Pill tone="warn" icon="TriangleAlert">{open}</Pill> : <span className="cv-up"><Icon name="CircleCheck" size={15} /></span>)}
            </span>
            <span className={s.tileVal}>{fmt(latest)}</span>
            <span className={s.bar}><span style={{ width: `${Math.max(2, (Math.abs(latest ?? 0) / top) * 100)}%`, background: roomColor(k) }} /></span>
            {rMean != null && bMean != null ? <Delta metric={metric} a={rMean} b={bMean} suffix={`last ${JUDGE_WEEKS} wks vs usual`} /> : <span className="cv-xs cv-faint">Building history</span>}
            <Spark vals={x.vals.slice(Math.max(t.w.from, t.rows.length - JUDGE_WEEKS)).map((v) => (v == null ? null : v / div))} lim={x.lim && { mean: x.lim.mean / div, ucl: x.lim.ucl / div, lcl: x.lim.lcl / div }} color={roomColor(k)} height={30} />
          </button>
        ))}
      </div>
      <section className="cv-card" aria-labelledby="trends-group">
        <div className="cv-card-head">
          <span className="cv-h4" id="trends-group">{perSeat ? 'Contribution per seat' : mDef.label}, weekly</span>
          <Button size="sm" variant="ghost" icon="FileSpreadsheet" aria-pressed={table} aria-label={table ? 'Hide data table' : 'Show data table'} title="Data table" onClick={() => setTable((v) => !v)} />
        </div>
        <TrendChart labels={g.labels} series={series} selected={sel} onSelect={setSel} fmt={fmt} height={300} ariaLabel={`${perSeat ? 'Contribution per seat' : mDef.label} by room, weekly. Use the arrow keys to move between weeks; the data table has every value.`} tip={{ title: (i) => `Week of ${shortDate(g.isos[i])}` }} />
        <div className="cv-legend">{series.map((sr) => <span key={sr.key}><i className={s.legendLine} style={{ borderColor: sr.color, ...(sr.dash ? { borderTopStyle: 'dashed', borderTopWidth: 3 } : {}) }} />{sr.label}</span>)}</div>
        {g.excluded.length > 0 && <Callout icon="Info">{g.excluded.map((e) => e.name).join(', ')}: {g.excluded[0].why}.</Callout>}
        {table && (
          <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Weekly values by room">
            <table className="cv-table">
              <thead><tr><th>Week of</th>{g.series.map((r) => <th key={r.id} className="r">{r.name}</th>)}{!perSeat && g.total && <th className="r">Group{g.weighted ? ' (weighted)' : ' total'}</th>}</tr></thead>
              <tbody>{g.isos.map((_, k) => n - 1 - k).map((i) => (
                <tr key={g.isos[i]}><td style={{ whiteSpace: 'nowrap' }}>{shortDate(g.isos[i])}</td>{series.filter((sr) => sr.key !== 'total').map((sr) => <td key={sr.key} className="r cv-num">{fmt(sr.vals[i])}</td>)}{!perSeat && g.total && <td className="r cv-num">{fmtMetric(metric, g.total[i])}</td>}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------- the page */

function CvTrends() {
  const eng = useEngine();
  const [view, setView] = React.useState('room');
  const [rawNotes, setNotes] = useSaved('trends.notes', {});
  const notes = React.useMemo(() => cleanNotes(rawNotes), [rawNotes]);
  const rows = CV_D.hist.rows;
  const t = React.useMemo(() => trendsFor(rows), [rows]);
  const own = CV_D.room.fromToast;
  const first = t.rows[t.w.from], last = t.rows[t.rows.length - 1];
  const multi = (CV_GROUP.rooms?.length ?? 0) > 1;
  const exportCsv = () => {
    if (view === 'group' && multi) {
      const text = CV_GROUP.rooms.map((d, k) => trendsCsv(trendsFor(d.hist.rows), cleanNotes(engine.saved('trends.notes', d.id)), d.profile?.name ?? d.id, { header: k === 0 })).join('');
      download(`trends-all-rooms-${last?.iso ?? 'weeks'}.csv`, text);
    } else {
      download(`trends-${CV_ROOM.short || eng.room}-${last?.iso ?? 'weeks'}.csv`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-'), trendsCsv(t, notes, CV_ROOM.name));
    }
  };
  return (
    <div className="cv-page wide">
      <PageHead over={`Trends · ${CV_ROOM.name} · ${own ? 'your Toast data' : 'sample data'}, ${shortDate(first?.iso)} to ${shortDate(last?.iso)}`}
        q="Getting better or worse?"
        right={<>
          {multi && <Tabs value={view} onChange={setView} tabs={[{ value: 'room', label: CV_ROOM.short }, { value: 'group', label: 'All rooms' }]} />}
          <Button variant="secondary" size="sm" icon="Download" onClick={exportCsv}>CSV</Button>
        </>} />
      {view === 'room' || !multi
        ? <RoomView key={eng.room} t={t} notes={notes} setNotes={setNotes} />
        : <GroupView onOpen={(id) => { engine.setRoom(id); setView('room'); }} />}
      {!own && (
        <details className={`cv-card ${s.disclosure}`}>
          <summary><Icon name="ChevronDown" size={16} className={s.chev} />Month by month against last year</summary>
          <DenseTrends />
        </details>
      )}
    </div>
  );
}

export { CvTrends };
