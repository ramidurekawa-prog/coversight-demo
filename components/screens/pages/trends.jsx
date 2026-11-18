'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { CV_D, CV_GROUP, CV_ROOM, Callout, Claim, PageHead, Pill, useCv } from '../core';
import { dataEnd } from '../../../lib/data/readers';
import {
  CAUSES, JUDGE_WEEKS, METHOD, METRIC, METRICS, METRIC_GROUPS, MIN_BASELINE, RUN,
  availableMetrics, cleanNotes, directionOf, explainSignal, fmtChange, fmtMetric,
  isExplained, lastYearIndex, noteKey, rangesFor, signalKey, trendsCsv, trendsFor,
} from '../../../lib/data/page/trends';
import { Spark, TrendChart } from './trends-chart';
import { useTodayTheme } from './today.themes';
import s from './trends.module.css';

/* Trends: is the restaurant getting better or worse, and what should I do?
 * Built to be read in seconds: one verdict, four big numbers, one chart, and a
 * card per change with one thing to do. The reasoning (usual range, evidence,
 * arithmetic, notes) is one tap away on each card, and the method sits in
 * "About this data". Everything comes from lib/data/page/trends.js, the same
 * code the nightly `trends` job runs, so the page and the alerts agree.
 * Notes save per room (`trends.notes`). */

// Persimmon & Ink (Today's look): navy for structure and data, persimmon only for the action,
// green for good, amber for caution, red only when it's genuinely critical.
const SERIES_COLOR = 'var(--fg-1)';
const CMP_COLOR = 'var(--fg-3)';
const SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low', info: 'Good news' };
const SEV_CLASS = { high: s.sevHigh, medium: s.sevMedium, low: s.sevLow, info: s.sevInfo };
const tone = (key, v) => (v == null || Math.abs(v) < 0.05 ? 'cv-faint' : (v > 0) === METRIC[key].up ? 'cv-up' : 'cv-down');
const shortDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const isMoney = (key) => ['money', 'cents'].includes(METRIC[key]?.unit);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** One thing to do for a change in the wrong direction, and where to do it. */
const TODO = {
  net: { label: 'Check daily sales', page: 'daily' },
  covers: { label: 'Check daily covers', page: 'daily' },
  check: { label: 'Review menu prices', page: 'menu' },
  earned: { label: 'See which cost moved', page: 'week' },
  prime: { label: 'Check labor and food', page: 'labour' },
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
function RangeBar({ value, lim, tone: kind }) {
  if (value == null || !lim) return null;
  const lo0 = Math.min(lim.lcl, value), hi0 = Math.max(lim.ucl, value);
  const pad = (hi0 - lo0) * 0.08 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  const p = (v) => ((v - lo) / (hi - lo)) * 100;
  return (
    <span className={s.range} aria-hidden="true">
      <span className={s.rangeBand} style={{ left: `${p(lim.lcl)}%`, width: `${p(lim.ucl) - p(lim.lcl)}%` }} />
      <span className={s.rangeMean} style={{ left: `${p(lim.mean)}%` }} />
      <span className={`${s.rangeDot} ${kind === 'good' ? s.dotGood : kind === 'crit' ? s.dotCrit : s.dotBad}`} style={{ left: `${p(value)}%` }} />
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

/** One plain sentence on what the verdict means. */
function verdictNote(dir, t) {
  if (dir.state === 'unknown') return `Each week is compared with this room's own usual. That takes ${MIN_BASELINE + 1} weeks of its data to learn.`;
  const what = 'Contribution (sales minus food and labor)';
  const ch = dir.change?.text ?? '';
  if (dir.state === 'improving') return `${what} is ${ch} on its usual, more than normal week-to-week swings, so the gain is real.${dir.yoy ? '' : ' Some of it may be seasonal.'}`;
  if (dir.state === 'slipping') return `${what} is ${ch} on its usual, a bigger drop than normal week-to-week swings. Start with the first thing to look at.`;
  return `${what} is within normal week-to-week swings of its usual${t.signals.some((x) => !x.good) ? '. One measure below is still worth a look.' : '.'}`;
}

function Verdict({ t, notes, onInvestigate, name }) {
  const dir = directionOf(t);
  const st = STATE[dir.state];
  const open = t.signals.filter((x) => !x.good && x.severity !== 'low' && !isExplained(notes[signalKey(x, t.rows)]));
  const word = { improving: 'is improving', steady: 'is steady', slipping: 'is slipping', unknown: 'is still building its history' }[dir.state];
  return (
    <section className={`cv-card ${s.verdict}`} data-state={dir.state} aria-label={`${name}: the answer`}>
      <div className={s.vPart}>
        <span className={`${s.vIcon} ${st.cls}`}><Icon name={st.icon} size={26} /></span>
        <span className="cv-col" style={{ gap: 4, minWidth: 0 }}>
          <span className={s.vWord}>{name} {word}</span>
          <p className={s.vNote}>{verdictNote(dir, t)}</p>
        </span>
      </div>
      <div className={s.vAct}>
        {open.length ? (
          <>
            <span className={`${s.vCount} ${open.some((x) => x.severity === 'high') ? s.crit : s.caution}`}><Icon name="TriangleAlert" size={18} />{plural(open.length, 'thing')} to look at</span>
            <Button className={s.cta} iconRight="ArrowRight" onClick={() => onInvestigate(open[0])}>{METRIC[open[0].metric].short} first</Button>
          </>
        ) : (
          <span className={`${s.vCount} cv-up`}><Icon name="CircleCheck" size={18} />{t.w.ready ? 'Nothing to act on' : 'Nothing judged yet'}</span>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- every room */

/**
 * One card per room: is it getting better or worse, contribution a week, the
 * last 13 weeks, and how many changes are waiting. Tap a card to open that room
 * below. Every figure is the same trendsFor() the room view and the job use.
 */
function RoomCards({ current, onPick }) {
  const rooms = CV_GROUP.rooms ?? [];
  const cards = rooms.map((d) => {
    const t = trendsFor(d.hist.rows);
    const dir = directionOf(t);
    const nb = cleanNotes(engine.saved('trends.notes', d.id));
    const open = t.signals.filter((sig) => !sig.good && sig.severity !== 'low' && !isExplained(nb[signalKey(sig, t.rows)])).length;
    const x = t.metrics.earned;
    const value = dir.state === 'unknown' ? x.latest : dir.recent;
    return { d, t, dir, open, x, value };
  });
  const total = cards.every((k) => k.value != null) ? cards.reduce((a, k) => a + k.value, 0) : null;
  const n = (t) => t.rows.length;
  return (
    <section aria-labelledby="trends-rooms" className={s.rooms}>
      <div className={s.roomsHead}>
        <span className="cv-h4" id="trends-rooms">{rooms.length === 1 ? 'Your room' : `Your ${rooms.length} rooms`}</span>
        {rooms.length > 1 && total != null && <span className={s.headSub}>{fmtMetric('earned', total)} a week in contribution together</span>}
      </div>
      <div className={s.roomGrid}>
        {cards.map(({ d, t, dir, open, x, value }) => {
          const st = STATE[dir.state];
          return (
            <button key={d.id} type="button" className={s.roomCard} data-state={dir.state} aria-pressed={d.id === current} onClick={() => onPick(d.id)}>
              <span className={s.roomTop}>
                <span className={s.roomName}>{d.profile?.short || d.id}{t.w.own ? '' : <span className={s.wk}> · sample</span>}</span>
                <span className={`${s.roomState} ${st.cls}`}><Icon name={st.icon} size={16} />{st.word}</span>
              </span>
              <span className={s.roomFig}>{fmtMetric('earned', value)}<small> a week</small></span>
              <span className={s.roomLine}>
                {dir.state !== 'unknown' ? <Delta metric="earned" a={dir.recent} b={dir.base} suffix="vs usual" neutral={dir.state === 'steady'} /> : <span className="cv-xs cv-faint">{plural(t.w.needWeeks, 'more week')} to go</span>}
                <Claim k={x.claim} />
              </span>
              <Spark vals={x.vals.slice(Math.max(t.w.from, n(t) - JUDGE_WEEKS))} lim={x.lim} height={30} ariaLabel={`Contribution, last ${JUDGE_WEEKS} weeks`} />
              <span className={s.roomFoot}>
                {!t.w.ready ? <span className="cv-faint">Not judged yet</span>
                  : open ? <span className={s.caution}><Icon name="TriangleAlert" size={15} />{plural(open, 'thing')} to look at</span>
                    : <span className={s.allClear}><Icon name="CircleCheck" size={15} />All clear</span>}
                {d.id === current ? <span className={s.viewing}>Showing below</span> : <span className={s.viewing}>Open <Icon name="ArrowRight" size={14} /></span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
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

/** What to look for next week, for one change. Thresholds only; never a cause. */
function watchText(sig) {
  const m = METRIC[sig.metric], e = sig.expected, f = (v) => fmtMetric(sig.metric, v);
  if (sig.good) return `Next week: does it hold? If it stays ${sig.dir === 'up' ? `above ${f(e.mean)}` : `below ${f(e.mean)}`}, note what changed so you can keep doing it.`;
  if (sig.kind === 'shift') return `Next week: watch for ${m.short.toLowerCase()} back ${sig.dir === 'up' ? 'below' : 'above'} its average of ${f(e.mean)}. ${sig.ongoing ? 'Until then it has settled at a new level.' : 'It has already moved back.'}`;
  const edge = sig.dir === 'up' ? e.ucl : e.lcl;
  if (!sig.ongoing) return `It's back inside its usual range now. Another week ${sig.dir === 'up' ? 'over' : 'under'} ${f(edge)} would make it a pattern, not a one-off.`;
  if (sig.weeks > 1) return `It's been ${sig.dir === 'up' ? 'high' : 'low'} for ${sig.weeks} weeks. Next week: back ${sig.dir === 'up' ? 'under' : 'over'} ${f(edge)} would be the first sign it's recovering.`;
  return `Next week: back ${sig.dir === 'up' ? 'under' : 'over'} ${f(edge)} means it was a one-off. Another week past it means something has changed.`;
}

function ChangeCard({ sig, t, note, open, editing, onPick, onToggle, onEdit, onSave, onRemove, onCancel, onCompare }) {
  const cv = useCv();
  const rows = t.rows;
  const m = METRIC[sig.metric];
  const explained = isExplained(note);
  const kind = sig.good ? 'good' : explained ? 'done' : sig.severity === 'high' ? 'crit' : 'bad';
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
      <RangeBar value={shown} lim={sig.expected} tone={sig.good ? 'good' : sig.severity === 'high' ? 'crit' : 'bad'} />
      <p className={s.cardWatch}><Icon name="Eye" size={15} /><span>{watchText(sig)}</span></p>
      <div className={s.cardAct}>
        {sig.good ? <Pill tone="good" icon="TrendingUp">Good news</Pill>
          : cause ? <Pill tone={explained ? 'neutral' : 'warn'} icon={explained ? 'CircleCheck' : 'Hourglass'}>{cause.label}</Pill>
            : todo && <Button size="sm" variant="secondary" iconRight="ArrowRight" onClick={() => cv.go(todo.page)}>{todo.label}</Button>}
        <span className={s.cardLinks}>
          <button type="button" className={s.linkBtn} onClick={onToggle} aria-expanded={open}>Why?</button>
          {!editing && <button type="button" className={s.linkBtn} onClick={onEdit}>{note ? 'Edit note' : 'Explain'}</button>}
        </span>
      </div>
      {note?.text && !editing && <span className={s.noteText}>“{note.text}”</span>}
      {open && why && (
        <div className={s.details}>
          <p className={s.cardWhat}>{m.help}</p>
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
  return (
    <section className="cv-card" aria-labelledby="trends-signals">
      <div className="cv-card-head">
        <span className="cv-h4" id="trends-signals">What to look at</span>
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

/* ------------------------------------------------------------- next week */

/**
 * What to watch next week: the line each open change has to get back inside,
 * then the floor for contribution and sales. Thresholds come from the same
 * usual ranges the flags use, so "watch" and "flag" always agree.
 */
function LookAhead({ t, notes, onPick }) {
  if (!t.w.ready) return null;
  const items = [];
  const seen = new Set();
  const open = t.signals.filter((x) => !x.good && !isExplained(notes[signalKey(x, t.rows)]) && (x.ongoing || x.to >= t.rows.length - 4));
  for (const sig of open) {
    if (seen.has(sig.metric)) continue;
    seen.add(sig.metric);
    const e = sig.expected, f = (v) => fmtMetric(sig.metric, v);
    const line = sig.kind === 'shift' ? e.mean : sig.dir === 'up' ? e.ucl : e.lcl;
    items.push({ key: sig.metric, tone: sig.severity === 'high' ? 'crit' : 'bad', label: METRIC[sig.metric].short, fig: `${sig.dir === 'up' ? 'Under' : 'Over'} ${f(line)}`, text: sig.kind === 'shift' ? `Back across its average would end the run.` : 'Back inside its usual range would make it a one-off.' });
  }
  for (const k of ['earned', 'net', 'covers']) {
    const x = t.metrics[k];
    if (items.length >= 4 || seen.has(k) || !x.available || !x.lim) continue;
    const up = METRIC[k].up;
    items.push({ key: k, tone: 'ok', label: METRIC[k].short, fig: `${up ? 'Above' : 'Under'} ${fmtMetric(k, up ? x.lim.lcl : x.lim.ucl)}`, text: `A normal week stays ${up ? 'above' : 'under'} this.` });
  }
  if (!items.length) return null;
  return (
    <section className="cv-card" aria-labelledby="trends-ahead">
      <div className="cv-card-head">
        <span className="cv-col" style={{ gap: 2 }}>
          <span className="cv-h4" id="trends-ahead">What to watch next week</span>
          <span className={s.headSub}>The lines that tell you whether a change is real or a one-off.</span>
        </span>
      </div>
      <div className={s.ahead}>
        {items.slice(0, 4).map((it) => (
          <button key={it.key} type="button" className={s.aheadItem} data-tone={it.tone} onClick={() => onPick(it.key)}>
            <span className={s.aheadLabel}>{it.label}</span>
            <span className={s.aheadFig}>{it.fig}</span>
            <span className={s.aheadText}>{it.text}</span>
          </button>
        ))}
      </div>
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
  t.signals.filter((sig) => sig.metric === m.key).forEach((sig) => { for (let k = sig.from; k <= sig.to; k++) if (x.vals[k] != null && !t.holidays[k].length) marks[k] = sig.good ? 'good' : sig.severity === 'high' ? 'crit' : 'bad'; });
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
      <Verdict t={t} notes={notes} name={CV_ROOM.short || CV_ROOM.name} onInvestigate={(sig) => pick(sig, signalKey(sig, t.rows))} />

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
            tip={{ title: (i) => `Week of ${shortDate(t.rows[i].iso) || t.rows[i].label}`, extra: (i) => <span className="cv-faint">{t.holidays[i].length ? t.holidays[i].join(', ') : marks[i] ? (marks[i] === 'good' ? 'Unusual, good direction' : 'Unusual, wrong direction') : x.lim && x.vals[i] != null ? <Delta metric={m.key} a={x.vals[i]} b={x.lim.mean} suffix="vs usual" /> : zoneOf(t, i)}</span> }} />
          <div className={s.chartFoot}>
            <div className="cv-legend">
              {x.lim && <span><i className={s.legendBand} />Usual range</span>}
              {Object.values(marks).includes('crit') && <span><i className={`${s.dot} ${s.dotCrit}`} />Wrong way, high</span>}
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
          {selected == null && <p className={s.howTo}>{x.lim ? 'Grey band: this room’s usual range. Colored dots: weeks flagged as unusual.' : 'The usual range appears once there are enough weeks.'} Tap a week for every number.</p>}
          {table && <DataTable t={t} metric={m.key} start={start} end={end} cmp={cmp} />}
          {selected != null && <WeekPanel t={t} i={selected} metric={m.key} setMetric={pickMetric} notes={notes} metrics={metrics} onClose={() => setSel(null)} />}
        </section>
        <Changes t={t} notes={notes} setNotes={setNotes} focus={focus} setFocus={setFocus} onPick={pick} onCompare={compare} />
      </div>

      <LookAhead t={t} notes={notes} onPick={(k) => { pickMetric(k); toChart(); }} />

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

/* ------------------------------------------------------------- the page */

function CvTrends() {
  useTodayTheme(false); // the app's chosen palette, same as Today
  const eng = useEngine();
  const [rawNotes, setNotes] = useSaved('trends.notes', {});
  const notes = React.useMemo(() => cleanNotes(rawNotes), [rawNotes]);
  const rows = CV_D.hist.rows;
  const t = React.useMemo(() => trendsFor(rows), [rows]);
  const own = CV_D.room.fromToast;
  const last = t.rows[t.rows.length - 1];
  const multi = (CV_GROUP.rooms?.length ?? 0) > 1;
  const exportCsv = () => {
    if (multi) {
      const text = CV_GROUP.rooms.map((d, k) => trendsCsv(trendsFor(d.hist.rows), cleanNotes(engine.saved('trends.notes', d.id)), d.profile?.name ?? d.id, { header: k === 0 })).join('');
      download(`trends-all-rooms-${last?.iso ?? 'weeks'}.csv`, text);
    } else {
      download(`trends-${CV_ROOM.short || eng.room}-${last?.iso ?? 'weeks'}.csv`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-'), trendsCsv(t, notes, CV_ROOM.name));
    }
  };
  return (
    <div className={`cv-page wide ${s.page}`}>
      <PageHead over={`Trend Watch · ${own ? 'your Toast data' : 'sample data'} through ${shortDate(last?.iso)}`}
        q="Catch a slide before it costs you"
        sub="Every room, every week, against its own usual. Only real changes get flagged."
        right={<Button variant="secondary" size="sm" icon="Download" onClick={exportCsv}>CSV</Button>} />
      <RoomCards current={eng.room} onPick={(id) => engine.setRoom(id)} />
      <RoomView key={eng.room} t={t} notes={notes} setNotes={setNotes} />
    </div>
  );
}

export { CvTrends };
