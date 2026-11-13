'use client';

import * as React from 'react';

import { Button, Icon, Tabs } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { CV_D, CV_GROUP, CV_ROOM, Callout, Claim, PageHead, Pill, useCv } from '../core';
import { DenseTrends } from '../dense-sections';
import { dataEnd } from '../../../lib/data/readers';
import {
  CAUSES, JUDGE_WEEKS, METHOD, METRIC, METRICS, METRIC_GROUPS, MIN_BASELINE, RUN,
  availableMetrics, cleanNotes, describeSignal, directionOf, explainSignal, fmtChange, fmtMetric, groupTrend,
  isExplained, lastYearIndex, noteKey, rangesFor, signalKey, trendsCsv, trendsFor,
} from '../../../lib/data/page/trends';
import { Spark, TrendChart } from './trends-chart';
import s from './trends.module.css';

/* Trends: is the restaurant getting better or worse, and is anything unusual
 * enough to act on? Everything here comes from lib/data/page/trends.js, the
 * same code the nightly `trends` job runs on the server, so the page and the
 * alerts always agree. Notes on changes save per room (`trends.notes`).
 * The first screen is three answers (direction, the biggest real change,
 * whether to act); the chart and the list of changes come next; every other
 * measure and the monthly view sit behind disclosures. */

const SERIES_COLOR = 'var(--cat-1)';
const CMP_COLOR = 'var(--cat-3)';
const roomColor = (i) => `var(--cat-${(i % 3) + 1})`;
const SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low', info: 'Good news' };
const SEV_CLASS = { high: s.sevHigh, medium: s.sevMedium, low: s.sevLow, info: s.sevInfo };
const tone = (key, v) => (v == null || Math.abs(v) < 0.05 ? 'cv-faint' : (v > 0) === METRIC[key].up ? 'cv-up' : 'cv-down');
const shortDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');

function Delta({ metric, a, b, suffix }) {
  const c = fmtChange(metric, a, b);
  if (!c) return <span className="cv-xs cv-faint">No comparable week{suffix ? ` ${suffix}` : ''}</span>;
  return <span className={`${s.delta} ${tone(metric, c.v)}`}>{Math.abs(c.v) >= 0.05 && <Icon name={c.v > 0 ? 'ArrowUp' : 'ArrowDown'} size={12} />}{c.text}{suffix && <span className="cv-faint" style={{ fontFamily: 'var(--font-sans)', fontWeight: 500 }}>&nbsp;{suffix}</span>}</span>;
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
        return ms.length ? <optgroup key={g} label={g}>{ms.map((m) => <option key={m.key} value={m.key}>{m.label}{flagged.has(m.key) ? ' (to explain)' : ''}</option>)}</optgroup> : null;
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

/* ------------------------------------------------------------- answers */

function Answers({ t, notes, onInvestigate }) {
  const dir = directionOf(t);
  const bad = t.signals.filter((x) => !x.good);
  const top = bad[0];
  const open = bad.filter((x) => !isExplained(notes[signalKey(x, t.rows)]) && x.severity !== 'low');
  const topD = top && describeSignal(top, t.rows, t.metrics[top.metric].lim);
  const dirWord = { improving: 'Improving', steady: 'Steady', slipping: 'Slipping', unknown: 'Not enough history yet' }[dir.state];
  const dirIcon = { improving: 'TrendingUp', steady: 'CircleMinus', slipping: 'TrendingDown', unknown: 'Hourglass' }[dir.state];
  return (
    <div className={s.answers}>
      <section className={`cv-card ${s.answer}`} aria-labelledby="trends-dir">
        <span className={s.answerHead} style={{ justifyContent: 'space-between' }}><span className="cv-xs cv-faint" id="trends-dir">Direction</span><Claim k={t.metrics.earned.claim} /></span>
        <span className={`${s.answerHead} ${dir.state === 'improving' ? 'cv-up' : dir.state === 'slipping' ? 'cv-down' : ''}`}><Icon name={dirIcon} size={20} /><span className={s.answerState}>{dirWord}</span></span>
        {dir.state === 'unknown'
          ? <span className="cv-small cv-muted">Coversight needs {MIN_BASELINE + 1} weeks of this room&apos;s own data to judge a direction; {t.w.needWeeks} more {t.w.needWeeks === 1 ? 'week' : 'weeks'} to go.</span>
          : <span className="cv-small cv-muted">Contribution after food and labour averaged <b>{fmtMetric('earned', dir.recent)}</b> a week over the last {dir.weeks} weeks, <span className={dir.state === 'steady' ? '' : tone('earned', dir.change?.v)}>{dir.change?.text}</span> on the {dir.baseWeeks} weeks before{dir.state === 'steady' ? ', within ordinary week-to-week variation' : ''}.</span>}
        {dir.yoy
          ? <span className="cv-xs cv-faint">Same {dir.yoy.weeks} weeks last year: {fmtMetric('earned', dir.yoy.then)} a week (<Delta metric="earned" a={dir.yoy.now} b={dir.yoy.then} />).</span>
          : dir.state !== 'unknown' && <span className="cv-xs cv-faint">Compared with earlier weeks, not the same weeks last year, so part of it may be seasonal.</span>}
      </section>
      <section className={`cv-card ${s.answer}`} aria-labelledby="trends-top">
        <span className={s.answerHead} style={{ justifyContent: 'space-between' }}><span className="cv-xs cv-faint" id="trends-top">Biggest change</span>{top && <span className={`${s.sev} ${SEV_CLASS[top.severity]}`}>{SEV_LABEL[top.severity]}</span>}</span>
        {!t.w.ready ? <span className="cv-small cv-muted">Nothing is judged until the baseline has {MIN_BASELINE} weeks.</span>
          : top ? <>
            <span className={s.answerState}>{topD.title}</span>
            <span className="cv-small cv-muted">{topD.body}</span>
          </> : <>
            <span className={s.answerState}>Nothing unusual</span>
            <span className="cv-small cv-muted">Performance remains within its usual range.</span>
          </>}
      </section>
      <section className={`cv-card ${s.answer}`} aria-labelledby="trends-act">
        <span className={s.answerHead}><span className="cv-xs cv-faint" id="trends-act">Action</span></span>
        {open.length ? <>
          <span className={`${s.answerHead} cv-down`}><Icon name="TriangleAlert" size={18} /><span className={s.answerState}>{open.length === 1 ? 'One change to look into' : `${open.length} changes to look into`}</span></span>
          <span className="cv-small cv-muted">Look at the weeks, then explain it or act. Until it&apos;s explained, the room gets one alert for it.</span>
          <div><Button size="sm" iconRight="ArrowRight" onClick={() => onInvestigate(open[0])}>Investigate {METRIC[open[0].metric].label.toLowerCase()}</Button></div>
        </> : <>
          <span className={`${s.answerHead} cv-up`}><Icon name="CircleCheck" size={18} /><span className={s.answerState}>No action needed</span></span>
          <span className="cv-small cv-muted">{!t.w.ready ? 'Nothing can be judged yet.' : bad.length ? 'Every change in the wrong direction is explained or minor.' : 'Nothing has moved the wrong way beyond ordinary variation.'}</span>
        </>}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- changes */

function NoteForm({ note, onSave, onRemove, onCancel }) {
  const [cause, setCause] = React.useState(note?.cause ?? '');
  const [text, setText] = React.useState(note?.text ?? '');
  const hint = CAUSES.find((c) => c.value === cause)?.hint;
  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (cause) onSave({ cause, text: text.trim() }); }}>
      <div className={s.causes} role="group" aria-label="What explains it">
        {CAUSES.map((c) => <button key={c.value} type="button" className={s.cause} aria-pressed={cause === c.value} onClick={() => setCause(c.value)}>{c.label}</button>)}
      </div>
      {hint && <span className="cv-xs cv-faint">{hint}</span>}
      <textarea className={s.textarea} maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened? (optional; kept with the weeks and in the export)" aria-label="Note" />
      <div className="cv-row" style={{ gap: 8 }}>
        <Button size="sm" type="submit" disabled={!cause}>Save note</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        {note && <Button size="sm" variant="ghost" icon="Trash2" onClick={onRemove} style={{ marginLeft: 'auto' }}>Remove</Button>}
        <span className="cv-xs cv-faint" style={{ marginLeft: note ? 0 : 'auto' }}>{text.length}/280</span>
      </div>
    </form>
  );
}

const PAGE_NAME = { daily: 'Daily', menu: 'Menu', week: 'This week', labour: 'Labour', purchasing: 'Purchasing', kitchen: 'Kitchen', controls: 'Controls' };

function SignalRow({ sig, t, note, open, editing, onPick, onToggle, onEdit, onSave, onRemove, onCancel, onCompare }) {
  const cv = useCv();
  const rows = t.rows;
  const m = METRIC[sig.metric];
  const lim = t.metrics[sig.metric].lim;
  const d = describeSignal(sig, rows, lim);
  const why = explainSignal(sig, t, { proofs: CV_D.proofs, candidates: CV_D.candidates });
  const explained = isExplained(note);
  const kind = sig.good ? 'good' : explained ? 'done' : 'bad';
  const cause = note && CAUSES.find((c) => c.value === note.cause);
  const money = m.unit === 'money' || m.unit === 'cents';
  return (
    <div className={s.sig} data-on={open}>
      <button type="button" className={s.sigHead} onClick={onToggle} aria-expanded={open}>
        <span className={`${s.sigIco} ${s[kind]}`}><Icon name={explained ? 'CircleCheck' : sig.dir === 'up' ? 'TrendingUp' : 'TrendingDown'} size={15} /></span>
        <span className="cv-col" style={{ gap: 3, flex: 1 }}>
          <span className="cv-row" style={{ gap: 8, justifyContent: 'space-between' }}><span className={s.sigTitle}>{d.title}</span><span className={`${s.sev} ${SEV_CLASS[sig.severity]}`}>{SEV_LABEL[sig.severity]}</span></span>
          <span className={s.sigBody}>{d.body}</span>
        </span>
      </button>
      <div className={s.sigMeta}>
        {sig.good ? <Pill tone="good" icon="TrendingUp">Good direction</Pill> : cause ? <Pill tone={explained ? 'neutral' : 'warn'} icon={explained ? 'CircleCheck' : 'Hourglass'}>{cause.label}</Pill> : <Pill tone="bad" icon="TriangleAlert">Not explained</Pill>}
        {sig.ongoing && <span className="cv-xs cv-faint">Still going this week</span>}
        {money && <Claim k={t.metrics[sig.metric].claim} />}
      </div>
      {note?.text && !editing && <span className={s.noteText}>“{note.text}”{note.at ? ` · ${new Date(note.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span>}
      {open && (
        <div className={s.details}>
          <dl className={s.facts}>
            <dt>Period</dt><dd>{rows[sig.from]?.label} to {rows[sig.to]?.label} ({sig.weeks} {sig.weeks === 1 ? 'week' : 'weeks'})</dd>
            <dt>{sig.kind === 'limit' ? 'Furthest week' : 'Average'}</dt><dd>{fmtMetric(sig.metric, sig.kind === 'limit' ? sig.value : sig.avg)}</dd>
            <dt>Usual range</dt><dd>{fmtMetric(sig.metric, sig.expected.lcl)} to {fmtMetric(sig.metric, sig.expected.ucl)} (average {fmtMetric(sig.metric, sig.expected.mean)})</dd>
            <dt>Size</dt><dd>{sig.z} standard deviations from the average</dd>
            <dt>Evidence</dt><dd>{sig.kind === 'limit' ? `${sig.breaches} ${sig.breaches === 1 ? 'week' : 'weeks'} outside the range` : `${sig.weeks} weeks in a row on one side (the rule is ${RUN})`}, against {sig.n} baseline weeks{sig.limited ? '; limited history, so severity is capped' : ''}</dd>
            <dt>Data</dt><dd>{t.w.own ? 'Your Toast data' : 'Sample data'}{t.metrics[sig.metric].claim === 'mod' ? ', food modelled' : ''}</dd>
          </dl>
          <div className={s.why}>
            {why.arithmetic.length > 0 && <><b>What moved (arithmetic)</b><ul>{why.arithmetic.map((x) => <li key={x}>{x}</li>)}</ul></>}
            {why.possible.length > 0 && <><b>Worth checking (not established)</b><ul>{why.possible.map((x) => <li key={x}>{x}</li>)}</ul></>}
            {why.related.length > 0 && <><b>Changes on the same lever</b><ul>{why.related.map((p) => <li key={p.id}>{p.title} ({p.outcome}{p.since ? `, since ${p.since}` : ''}). Its effect is measured on Proof, not here.</li>)}</ul></>}
            <span className="cv-faint">Coversight can&apos;t tell the cause from these figures alone.</span>
          </div>
          <div className={s.acts}>
            <Button size="sm" variant="secondary" icon="Search" onClick={onPick}>Investigate</Button>
            <Button size="sm" variant="ghost" icon="GitCompareArrows" onClick={onCompare}>Compare periods</Button>
            {why.finding && <Button size="sm" variant="ghost" icon="ListChecks" onClick={() => cv.go('finding', { id: why.finding.id })}>Review finding</Button>}
            {m.page && <Button size="sm" variant="ghost" icon="Database" onClick={() => cv.go(m.page)}>Open {PAGE_NAME[m.page] ?? m.page}</Button>}
            {!editing && <Button size="sm" variant="ghost" icon="PencilLine" onClick={onEdit}>{note ? 'Edit note' : 'Explain'}</Button>}
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
  return (
    <section className="cv-card" aria-labelledby="trends-signals">
      <div className="cv-card-head">
        <span className="cv-col" style={{ gap: 2 }}>
          <span className="cv-h4" id="trends-signals">Meaningful changes</span>
          <span className="cv-xs cv-faint">{t.w.ready ? `The last ${t.rows.length - t.w.judgeFrom} weeks against the ${t.w.baseTo - t.w.baseFrom} before them` : 'Waiting for enough weeks'}</span>
        </span>
        {t.w.ready && <Pill tone={unexplained.length ? 'warn' : 'good'} icon={unexplained.length ? 'TriangleAlert' : 'CircleCheck'}>{unexplained.length ? `${unexplained.length} not explained` : 'All explained'}</Pill>}
      </div>
      {!t.w.ready ? (
        <span className="cv-small cv-muted">Limits need {MIN_BASELINE} weeks of this room&apos;s own data before anything can be judged; {t.w.needWeeks} more {t.w.needWeeks === 1 ? 'week' : 'weeks'} to go. Until then the chart shows the weeks as they come in.</span>
      ) : (
        <div className={s.sigList}>
          {list.map(({ sig, key }) => (
            <SignalRow key={key} sig={sig} t={t} note={notes[key]} open={focus === key} editing={editing === key}
              onPick={() => onPick(sig, key)} onToggle={() => { if (focus === key) setFocus(null); else onPick(sig, key); }} onCompare={() => onCompare(sig)}
              onEdit={() => setEditing(key)} onSave={save(sig, key)} onRemove={remove(sig, key)} onCancel={() => setEditing(null)} />
          ))}
          {!bad.length && <div className={s.sig}><span className="cv-small cv-muted">Performance remains within its usual range: nothing has left its limits or run long on the wrong side of its average.</span></div>}
          {good.length > 0 && <button type="button" className={s.more} onClick={() => setShowGood((v) => !v)} aria-expanded={showGood}>{showGood ? 'Hide good-direction changes' : `Show ${good.length} good-direction ${good.length === 1 ? 'change' : 'changes'}`}</button>}
        </div>
      )}
      <span className="cv-xs cv-faint">A change is a week outside its usual range (baseline average ± 3 standard deviations) or {RUN} weeks in a row on one side of the average. Holiday weeks and weeks with no sales are never flagged. Medium and high ones that nobody has explained are sent to the room once.</span>
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
      <div className="cv-row" style={{ justifyContent: 'space-between' }}>
        <span className="cv-row" style={{ gap: 8 }}>
          <span className="cv-h4">Week of {shortDate(r.iso) || r.label}</span>
          <Pill tone="neutral" icon={r.own ? 'Database' : 'Info'}>{r.own ? 'Your data' : 'Sample data'}</Pill>
          <span className="cv-xs cv-faint">{zoneOf(t, i)}{t.holidays[i].length ? ` · ${t.holidays[i].join(', ')}` : ''}</span>
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
              <span className="cv-xs cv-faint cv-row" style={{ gap: 6 }}>{flag && <i className={`${s.dot} ${flag === 'bad' ? s.dotBad : s.dotGood}`} />}{m.label}</span>
              <span className={s.weekVal}>{fmtMetric(m.key, v)}</span>
              {x.lim && v != null ? <Delta metric={m.key} a={v} b={x.lim.mean} suffix="vs baseline" /> : <span className="cv-xs cv-faint">{v == null ? 'No value this week' : 'No baseline yet'}</span>}
            </button>
          );
        })}
      </div>
      {weekNotes.map(({ m, n }) => <span key={m.key} className="cv-xs cv-muted"><b>{m.label}:</b> {CAUSES.find((c) => c.value === n.cause)?.label}{n.text ? `. ${n.text}` : ''}</span>)}
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
  const [metric, setMetric] = React.useState(metrics[0]?.key ?? 'net');
  const [range, setRange] = React.useState(ranges.at(-1)?.v ?? n);
  const [custom, setCustom] = React.useState(null); // { from, to } row indexes
  const [cmpMode, setCmp] = React.useState('none');
  const [sel, setSel] = React.useState(null);
  const [focus, setFocus] = React.useState(null);
  const [table, setTable] = React.useState(false);
  const chartRef = React.useRef(null);
  const m = METRIC[metric] ?? METRIC.net;
  const x = t.metrics[m.key];
  const end = custom ? custom.to : n - 1;
  const start = Math.max(t.w.from, custom ? custom.from : n - range);
  const selected = sel != null && sel < n ? sel : null;
  const marks = {};
  t.signals.filter((sig) => sig.metric === m.key).forEach((sig) => { for (let k = sig.from; k <= sig.to; k++) if (x.vals[k] != null && !t.holidays[k].length) marks[k] = sig.good ? 'good' : 'bad'; });
  const noted = new Set(t.signals.filter((sig) => sig.metric === m.key && notes[signalKey(sig, t.rows)]).map((sig) => sig.from));
  const lyVals = t.rows.map((_, i) => { const j = lastYearIndex(t.rows, i, t.w); return j == null ? null : x.vals[j]; });
  const hasLy = lyVals.slice(start, end + 1).filter((v) => v != null).length >= 4;
  const span = end - start + 1;
  const prevVals = t.rows.map((_, i) => (i - span >= t.w.from ? x.vals[i - span] : null));
  const hasPrev = prevVals.slice(start, end + 1).some((v) => v != null);
  const cmp = cmpMode === 'ly' && hasLy ? { label: 'Same week last year', vals: lyVals } : cmpMode === 'prev' && hasPrev ? { label: `${span} weeks earlier`, vals: prevVals } : null;
  const events = [
    ...t.holidays.map((h, i) => (h.length ? { i, kind: 'holiday', label: h.join(', ') } : null)).filter(Boolean),
    ...CV_D.proofs.filter((p) => (p.outcome === 'verified' || p.outcome === 'limited') && p.since).map((p) => {
      let i = -1;
      for (let k = n - 1; k >= t.w.from; k--) if (t.rows[k].label === p.since) { i = k; break; }
      return i < 0 ? null : { i, kind: 'proof', label: `Verified change started: ${p.title}` };
    }).filter(Boolean),
  ];
  const pick = (sig, key) => {
    setMetric(sig.metric);
    setFocus(key);
    setSel(sig.to);
    if (sig.from < start || sig.to > end) { setCustom(null); setRange(ranges.at(-1)?.v ?? n); }
  };
  const investigate = (sig, key) => { pick(sig, key); chartRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); };
  const compare = (sig) => { investigate(sig, signalKey(sig, t.rows)); setCmp(hasLy ? 'ly' : 'prev'); };
  const series = [{ key: m.key, label: m.label, color: SERIES_COLOR, vals: x.vals }];
  if (cmp) series.push({ key: 'cmp', label: cmp.label, color: CMP_COLOR, vals: cmp.vals, dash: '5 4', thin: true });
  const fmt = (v, axis) => (axis && m.unit === 'money' ? fmtMetric(m.key, Math.round(v / 100) * 100) : fmtMetric(m.key, v));
  const flaggedMetrics = new Set(t.signals.filter((q) => !q.good && !isExplained(notes[signalKey(q, t.rows)])).map((q) => q.metric));
  const trusted = t.rows.map((r, i) => ({ i, r })).filter(({ i }) => i >= t.w.from);
  const unitLabel = { money: 'US$ per week', cents: 'US$', count: 'per week', pct: '% of net sales', pct1: '% of net sales', mins: 'minutes per week', minutes: 'minutes' }[m.unit];
  const dataThrough = dataEnd(CV_D.room);
  return (
    <>
      <Answers t={t} notes={notes} onInvestigate={(sig) => investigate(sig, signalKey(sig, t.rows))} />

      <div className={s.main}>
        <section className="cv-card" aria-labelledby="trends-chart" ref={chartRef}>
          <div className="cv-card-head">
            <span className="cv-col" style={{ gap: 2 }}>
              <span className="cv-h4" id="trends-chart">{m.label}, weekly</span>
              <span className="cv-xs cv-faint">{m.help}</span>
            </span>
            <Claim k={x.claim} />
          </div>
          <div className={s.toolbar}>
            <MetricSelect id="trends-metric" value={m.key} onChange={(k) => { setMetric(k); setFocus(null); }} metrics={metrics} flagged={flaggedMetrics} />
            <Seg label="Range" value={custom ? 'custom' : range} onChange={(v) => { if (v === 'custom') setCustom({ from: Math.max(t.w.from, n - Math.min(13, t.w.trusted)), to: n - 1 }); else { setCustom(null); setRange(v); } }}
              items={[...ranges.map((r) => ({ v: r.v, label: r.label })), ...(t.w.trusted > 2 ? [{ v: 'custom', label: 'Custom' }] : [])]} />
          </div>
          {custom && (
            <div className="cv-row" style={{ gap: 8 }}>
              <label className="cv-xs cv-muted" htmlFor="trends-from">From</label>
              <select id="trends-from" className={s.select} value={custom.from} onChange={(e) => setCustom((c) => ({ from: +e.target.value, to: Math.max(+e.target.value + 1, c.to) }))}>
                {trusted.slice(0, -1).map(({ i, r }) => <option key={i} value={i}>{shortDate(r.iso) || r.label}</option>)}
              </select>
              <label className="cv-xs cv-muted" htmlFor="trends-to">to</label>
              <select id="trends-to" className={s.select} value={custom.to} onChange={(e) => setCustom((c) => ({ from: Math.min(c.from, +e.target.value - 1), to: +e.target.value }))}>
                {trusted.slice(1).map(({ i, r }) => <option key={i} value={i}>{shortDate(r.iso) || r.label}</option>)}
              </select>
            </div>
          )}
          <TrendChart labels={t.rows.map((r) => r.label)} series={series} lim={x.lim} start={start} end={end} baseTo={t.w.ready ? t.w.baseTo : null}
            marks={marks} noted={noted} events={events} selected={selected} onSelect={setSel} fmt={fmt} height={280} yLabel={unitLabel}
            ariaLabel={`${m.label} by week, ${shortDate(t.rows[start]?.iso)} to ${shortDate(t.rows[end]?.iso)}, in ${unitLabel}. Use the arrow keys to move between weeks; the data table has every value.`}
            tip={{ title: (i) => `Week of ${shortDate(t.rows[i].iso) || t.rows[i].label}`, extra: (i) => <span className="cv-faint">{zoneOf(t, i)}{t.holidays[i].length ? ` · ${t.holidays[i].join(', ')}` : ''}{marks[i] ? ` · ${marks[i] === 'bad' ? 'wrong-direction change' : 'good-direction change'}` : ''}</span> }} />
          <div className="cv-row" style={{ justifyContent: 'space-between' }}>
            <div className="cv-legend">
              <span><i className={s.legendLine} style={{ borderColor: SERIES_COLOR }} />{m.label}</span>
              {x.lim && <span><i className={s.legendBand} />Usual range (baseline ± 3σ)</span>}
              {Object.values(marks).includes('bad') && <span><i className={`${s.dot} ${s.dotBad}`} />Wrong-direction change</span>}
              {Object.values(marks).includes('good') && <span><i className={`${s.dot} ${s.dotGood}`} />Good-direction change</span>}
              {cmp && <span><i className={s.legendLine} style={{ borderColor: CMP_COLOR, borderTopStyle: 'dashed' }} />{cmp.label}</span>}
              {events.some((e) => e.kind === 'holiday' && e.i >= start && e.i <= end) && <span><i className={s.legendHoliday} />Holiday week</span>}
              {events.some((e) => e.kind === 'proof' && e.i >= start && e.i <= end) && <span><i className={s.legendProof} />Verified change started</span>}
            </div>
            {(hasPrev || hasLy) && <Seg label="Compare with" value={cmpMode} onChange={setCmp} items={[{ v: 'none', label: 'No comparison' }, ...(hasPrev ? [{ v: 'prev', label: 'Previous period' }] : []), ...(hasLy ? [{ v: 'ly', label: 'Last year' }] : [])]} />}
          </div>
          <div className={s.prov}>
            <span><b>Source</b> {t.w.own ? 'your Toast data' : 'sample group'}</span>
            <span><b>Data through</b> {shortDate(dataThrough || t.rows[n - 1]?.iso)}</span>
            <span><b>Baseline</b> {x.lim ? `${x.lim.n} weeks${x.lim.limited ? ' (limited)' : ''}, holidays left out` : 'not enough weeks yet'}</span>
            <span><b>Method</b> {METHOD}</span>
            <button type="button" className={s.rankBtn} onClick={() => setTable((v) => !v)} aria-expanded={table}>{table ? 'Hide data table' : 'Show data table'}</button>
          </div>
          {table && <DataTable t={t} metric={m.key} start={start} end={end} cmp={cmp} />}
          {selected != null && <WeekPanel t={t} i={selected} metric={m.key} setMetric={setMetric} notes={notes} metrics={metrics} onClose={() => setSel(null)} />}
        </section>
        <Changes t={t} notes={notes} setNotes={setNotes} focus={focus} setFocus={setFocus} onPick={pick} onCompare={compare} />
      </div>

      <details className={`cv-card ${s.disclosure}`}>
        <summary><Icon name="ChevronDown" size={16} className={s.chev} />Every measure, last {Math.min(JUDGE_WEEKS, t.w.trusted)} weeks<span className="cv-xs cv-faint" style={{ fontWeight: 400 }}>· {metrics.length} with data</span></summary>
        <div className={s.minis}>
          {metrics.map((mm) => {
            const xx = t.metrics[mm.key];
            const ongoing = t.signals.find((sig) => sig.metric === mm.key && sig.ongoing);
            const mark = ongoing ? (ongoing.good ? 'good' : 'bad') : null;
            return (
              <button key={mm.key} type="button" className={s.mini} aria-pressed={m.key === mm.key} onClick={() => { setMetric(mm.key); setFocus(null); chartRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }}>
                <span className={s.miniHead}><span className="cv-xs cv-muted">{mm.label}</span>{mm.unit === 'money' || mm.unit === 'cents' ? <Claim k={xx.claim} /> : null}</span>
                <span className={s.miniHead}><span className={s.miniVal}>{fmtMetric(mm.key, xx.latest)}</span>{xx.lim && xx.latest != null ? <Delta metric={mm.key} a={xx.latest} b={xx.lim.mean} suffix="vs baseline" /> : <span className="cv-xs cv-faint">{xx.latest == null ? 'No value this week' : 'No baseline yet'}</span>}</span>
                <Spark vals={xx.vals.slice(Math.max(t.w.from, n - JUDGE_WEEKS))} lim={xx.lim} mark={mark} ariaLabel={`${mm.label}, last ${JUDGE_WEEKS} weeks`} />
              </button>
            );
          })}
        </div>
        {METRICS.length > metrics.length && <span className="cv-xs cv-faint">Not shown until there&apos;s data for them: {METRICS.filter((mm) => !metrics.includes(mm)).map((mm) => mm.label.toLowerCase()).join(', ')}.</span>}
      </details>
    </>
  );
}

/* ------------------------------------------------------------- the group */

const GROUP_METRICS = ['net', 'covers', 'check', 'prime', 'food', 'labour', 'earned'];

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
  const groupNow = g.total ? g.total.at(-1) : null;
  return (
    <>
      <section className="cv-card" aria-labelledby="trends-group">
        <div className="cv-card-head">
          <span className="cv-col" style={{ gap: 2 }}>
            <span className="cv-h4" id="trends-group">{perSeat ? 'Contribution after food and labour, per seat' : mDef.label}, weekly, {rooms.length === 1 ? 'one room' : `${rooms.length} rooms`}</span>
            <span className="cv-xs cv-faint">{perSeat ? 'Per seat, so rooms of different sizes compare fairly.' : g.weighted ? 'The group line is weighted by sales (Σ part ÷ Σ sales), not an average of the rooms.' : 'Each room on its own line; the table below adds them up.'} Weeks are matched on their start date, and a week missing for any room is left out of the group figure.</span>
          </span>
          <span className="cv-row" style={{ gap: 8 }}>
            <select className={s.select} value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Measure">
              {GROUP_METRICS.map((k) => <option key={k} value={k}>{k === 'earned' ? 'Contribution per seat' : METRIC[k].label}</option>)}
            </select>
            <Claim k={rooms.some((d) => d.hist.rows.at(-1)?.own) && mDef.food ? 'mod' : 'obs'} />
          </span>
        </div>
        <TrendChart labels={g.labels} series={series} selected={sel} onSelect={setSel} fmt={fmt} height={280} ariaLabel={`${perSeat ? 'Contribution per seat' : mDef.label} by room, weekly. Use the arrow keys to move between weeks; the data table has every value.`} tip={{ title: (i) => `Week of ${shortDate(g.isos[i])}` }} />
        <div className="cv-row" style={{ justifyContent: 'space-between' }}>
          <div className="cv-legend">{series.map((sr) => <span key={sr.key}><i className={s.legendLine} style={{ borderColor: sr.color, ...(sr.dash ? { borderTopStyle: 'dashed', borderTopWidth: 3 } : {}) }} />{sr.label}</span>)}</div>
          <button type="button" className={s.rankBtn} onClick={() => setTable((v) => !v)} aria-expanded={table}>{table ? 'Hide data table' : 'Show data table'}</button>
        </div>
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
      <section className="cv-card flush" aria-label="Rooms compared">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Rooms compared">
          <table className="cv-table">
            <thead><tr><th>Room</th><th className="r">This week</th><th className="r">Last 13 weeks</th><th className="r">Baseline</th><th className="r">Change</th><th className="r">To explain</th><th><span className="cv-xs cv-faint">Open</span></th></tr></thead>
            <tbody>{rooms.map((d) => {
              const t = trendsFor(d.hist.rows);
              const x = t.metrics[metric];
              const div = perSeat ? seats[d.id] : 1;
              const recent = t.w.ready ? x.vals.slice(t.w.judgeFrom).filter((v) => v != null) : [];
              const rMean = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length / div : null;
              const bMean = x.lim ? x.lim.mean / div : null;
              const nb = notesFor(d.id);
              const open = t.signals.filter((sig) => !sig.good && sig.severity !== 'low' && !isExplained(nb[signalKey(sig, t.rows)])).length;
              return (
                <tr key={d.id}>
                  <td><b>{d.profile?.short || d.id}</b><span className="cv-xs cv-faint"> · {t.w.own ? 'your data' : 'sample'}</span></td>
                  <td className="r cv-num">{fmt(x.latest == null ? null : x.latest / div)}</td>
                  <td className="r cv-num">{fmt(rMean)}</td>
                  <td className="r cv-num">{fmt(bMean)}</td>
                  <td className="r">{rMean != null && bMean != null ? <Delta metric={metric} a={rMean} b={bMean} /> : <span className="cv-xs cv-faint">—</span>}</td>
                  <td className="r cv-num">{t.w.ready ? open : '—'}</td>
                  <td className="r"><button type="button" className={s.rankBtn} onClick={() => onOpen(d.id)} aria-label={`Open ${d.profile?.short || d.id}`}>Open</button></td>
                </tr>
              );
            })}</tbody>
            {!perSeat && groupNow != null && (
              <tfoot><tr style={{ fontWeight: 600 }}><td>Group{g.excluded.length ? ' (your rooms only)' : ''}</td><td className="r cv-num">{fmtMetric(metric, groupNow)}</td><td colSpan={5} className="cv-xs cv-faint">{g.weighted ? 'Weighted by sales' : 'Sum of rooms'}</td></tr></tfoot>
            )}
          </table>
        </div>
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
      <PageHead over={`Trends · ${CV_ROOM.name} · ${t.w.trusted} weeks of ${own ? 'your Toast data' : 'sample data'}, ${shortDate(first?.iso)} to ${shortDate(last?.iso)}`}
        q="Is the restaurant getting better or worse?"
        sub="Only meaningful changes are highlighted."
        right={<>
          {multi && <Tabs value={view} onChange={setView} tabs={[{ value: 'room', label: CV_ROOM.short }, { value: 'group', label: 'All rooms' }]} />}
          <Button variant="secondary" size="sm" icon="Download" onClick={exportCsv}>CSV</Button>
        </>} />
      {view === 'room' || !multi
        ? <RoomView key={eng.room} t={t} notes={notes} setNotes={setNotes} />
        : <GroupView onOpen={(id) => { engine.setRoom(id); setView('room'); }} />}
      <Callout icon="Info">{own
        ? <>Judged on your own Toast weeks only; the sample&apos;s weeks are never shown or used for your limits. Food on your weeks is net sales × this room&apos;s food rate until supplier invoices are in, so food, prime cost and contribution are <b>Modelled</b>. Measures Toast&apos;s exports don&apos;t carry stay hidden rather than show sample values.</>
        : <>This is the sample group&apos;s history. Hand-entered data changes the live week only; past weeks are closed. Connect Toast and this page judges your own weeks instead, starting once {MIN_BASELINE + 1} of them are in.</>}</Callout>
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
