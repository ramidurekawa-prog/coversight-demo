'use client';

import * as React from 'react';

import { Button, Icon, Tabs } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { CV_D, CV_GROUP, CV_ROOM, Callout, Claim, PageHead, Pill } from '../core';
import { DenseTrends } from '../dense-sections';
import { CAUSES, JUDGE_WEEKS, METRIC, METRICS, MIN_BASELINE, RUN, cleanNotes, describeSignal, lastYearIndex, fmtMetric, groupSeries, isExplained, noteKey, signalKey, trendsCsv, trendsFor } from '../../../lib/data/page/trends';
import { Spark, TrendChart } from './trends-chart';
import s from './trends.module.css';

/* Trends: the room's weekly history judged against a baseline the recent weeks
 * didn't shape. Everything shown comes from lib/data/page/trends.js, the same
 * code the nightly `trends` job runs on the server, so the page and the
 * alerts always agree. Notes on unusual weeks save per room (`trends.notes`). */

const RANGES = [{ v: 52, label: '1 year' }, { v: 26, label: '6 months' }, { v: JUDGE_WEEKS, label: '13 weeks' }];
const HEADLINE = ['net', 'earned', 'prime', 'check'];
const TILE = { net: 'Net sales, this week', earned: 'Earned, this week', prime: 'Prime cost, this week', check: 'Average check, this week' };
const SERIES_COLOR = 'var(--cat-1)';
const LY_COLOR = 'var(--cat-3)';
const roomColor = (i) => `var(--cat-${(i % 3) + 1})`;

const pctChange = (a, b) => (a == null || b == null || !b ? null : ((a - b) / Math.abs(b)) * 100);
/** Change for a share-of-sales metric is in points, not percent of a percent. */
function change(key, a, b) {
  if (a == null || b == null) return null;
  const u = METRIC[key].unit;
  if (u === 'pct' || u === 'pct1') { const d = a - b; return { v: d, text: Math.abs(d) < 0.05 ? 'level' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pts` }; }
  const p = pctChange(a, b);
  return p == null ? null : { v: p, text: Math.abs(p) < 0.05 ? 'level' : `${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%` };
}
const tone = (key, v) => (v == null || Math.abs(v) < 0.05 ? 'cv-faint' : (v > 0) === METRIC[key].up ? 'cv-up' : 'cv-down');

function Delta({ metric, a, b, suffix }) {
  const c = change(metric, a, b);
  if (!c) return <span className="cv-xs cv-faint">No comparable week{suffix ? ` ${suffix}` : ''}</span>;
  return <span className={`${s.delta} ${tone(metric, c.v)}`}>{Math.abs(c.v) >= 0.05 && <Icon name={c.v > 0 ? 'ArrowUp' : 'ArrowDown'} size={12} />}{c.text}<span className="cv-faint" style={{ fontFamily: 'var(--font-sans)', fontWeight: 500 }}>&nbsp;{suffix}</span></span>;
}

function Seg({ value, onChange, items, label }) {
  return (
    <div className={s.seg} role="group" aria-label={label}>
      {items.map((it) => <button key={it.v} type="button" aria-pressed={it.v === value} onClick={() => onChange(it.v)}>{it.dot && <i className={`${s.dot} ${it.dot === 'bad' ? s.dotBad : s.dotGood}`} />}{it.label}</button>)}
    </div>
  );
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Where each week sits, for the tooltip and the week panel. */
function zoneOf(t, i) {
  if (i < t.w.from) return 'Sample week, not judged';
  if (!t.w.ready) return 'Building the baseline';
  return i < t.w.baseTo ? 'Baseline week' : 'Judged week';
}

/* ------------------------------------------------------------- signals */

function NoteForm({ note, onSave, onRemove, onCancel }) {
  const [cause, setCause] = React.useState(note?.cause ?? '');
  const [text, setText] = React.useState(note?.text ?? '');
  const hint = CAUSES.find((c) => c.value === cause)?.hint;
  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (cause) onSave({ cause, text: text.trim() }); }}>
      <div className={s.causes} role="group" aria-label="What caused it">
        {CAUSES.map((c) => <button key={c.value} type="button" className={s.cause} aria-pressed={cause === c.value} onClick={() => setCause(c.value)}>{c.label}</button>)}
      </div>
      {hint && <span className="cv-xs cv-faint">{hint}</span>}
      <textarea className={s.textarea} maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened? (optional, kept with the week for the weekly meeting and the export)" aria-label="Note" />
      <div className="cv-row" style={{ gap: 8 }}>
        <Button size="sm" type="submit" disabled={!cause}>Save note</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        {note && <Button size="sm" variant="ghost" icon="Trash2" onClick={onRemove} style={{ marginLeft: 'auto' }}>Remove</Button>}
        <span className="cv-xs cv-faint" style={{ marginLeft: note ? 0 : 'auto' }}>{text.length}/280</span>
      </div>
    </form>
  );
}

function SignalRow({ sig, t, note, on, editing, onPick, onEdit, onSave, onRemove, onCancel }) {
  const rows = t.rows;
  const d = describeSignal(sig, rows, t.metrics[sig.metric].lim);
  const explained = isExplained(note);
  const kind = sig.good ? 'good' : explained ? 'done' : 'bad';
  const cause = note && CAUSES.find((c) => c.value === note.cause);
  return (
    <div className={s.sig} data-on={on}>
      <button type="button" className={s.sigHead} onClick={onPick} aria-label={`${d.title}. Show on the chart`}>
        <span className={`${s.sigIco} ${s[kind]}`}><Icon name={explained ? 'CircleCheck' : sig.dir === 'up' ? 'TrendingUp' : 'TrendingDown'} size={15} /></span>
        <span className="cv-col" style={{ gap: 3 }}>
          <span className="cv-row" style={{ gap: 8, justifyContent: 'space-between' }}><span className={s.sigTitle}>{d.title}</span>{['money', 'cents'].includes(METRIC[sig.metric].unit) && <Claim k={t.metrics[sig.metric].claim} />}</span>
          <span className={s.sigBody}>{d.body}</span>
        </span>
      </button>
      <div className={s.sigMeta}>
        {sig.good ? <Pill tone="good" icon="TrendingUp">Good news</Pill> : cause ? <Pill tone={explained ? 'neutral' : 'warn'} icon={explained ? 'CircleCheck' : 'Hourglass'}>{cause.label}</Pill> : <Pill tone="bad" icon="TriangleAlert">Not explained</Pill>}
        {sig.ongoing && <span className="cv-xs cv-faint">Still going this week</span>}
        {!editing && <Button size="sm" variant="ghost" icon="PencilLine" onClick={onEdit} style={{ marginLeft: 'auto' }}>{note ? 'Edit note' : 'Explain'}</Button>}
      </div>
      {note?.text && !editing && <span className={s.noteText}>“{note.text}” · {new Date(note.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
      {editing && <NoteForm note={note} onSave={onSave} onRemove={onRemove} onCancel={onCancel} />}
    </div>
  );
}

function Signals({ t, notes, setNotes, focus, onPick }) {
  const [editing, setEditing] = React.useState(null);
  const [showGood, setShowGood] = React.useState(false);
  const keyed = t.signals.map((sig) => ({ sig, key: signalKey(sig, t.rows) }));
  const bad = keyed.filter((x) => !x.sig.good);
  const open = bad.filter((x) => !isExplained(notes[x.key]));
  const good = keyed.filter((x) => x.sig.good);
  const list = [...open, ...bad.filter((x) => isExplained(notes[x.key])), ...(showGood ? good : [])];
  const save = (sig, key) => (v) => {
    setNotes((cur) => ({ ...cur, [key]: { ...v, at: new Date().toISOString() } }), `Trends note: ${METRIC[sig.metric].label}, week of ${t.rows[sig.from]?.label} (${CAUSES.find((c) => c.value === v.cause)?.label})`);
    setEditing(null);
  };
  const remove = (sig, key) => () => {
    setNotes((cur) => { const next = { ...cur }; delete next[key]; return next; }, `Trends note removed: ${METRIC[sig.metric].label}, week of ${t.rows[sig.from]?.label}`);
    setEditing(null);
  };
  return (
    <section className="cv-card" aria-labelledby="trends-signals">
      <div className="cv-card-head">
        <span className="cv-col" style={{ gap: 2 }}>
          <span className="cv-h4" id="trends-signals">Worth a look</span>
          <span className="cv-xs cv-faint">{t.w.ready ? `The last ${t.metrics.net.vals.length - t.w.judgeFrom} weeks against the ${t.w.baseTo - t.w.baseFrom} before them` : 'Waiting for enough weeks'}</span>
        </span>
        {t.w.ready && <Pill tone={open.length ? 'warn' : 'good'} icon={open.length ? 'TriangleAlert' : 'CircleCheck'}>{open.length ? `${open.length} to explain` : 'All explained'}</Pill>}
      </div>
      {!t.w.ready ? (
        <span className="cv-small cv-muted">Limits need {MIN_BASELINE} weeks of this room&apos;s own data before anything can be judged; {t.w.needWeeks} more {t.w.needWeeks === 1 ? 'week' : 'weeks'} to go. Until then the charts show the weeks as they come in.</span>
      ) : (
        <div className={s.sigList}>
          {list.map(({ sig, key }) => (
            <SignalRow key={key} sig={sig} t={t} note={notes[key]} on={focus === key} editing={editing === key}
              onPick={() => onPick(sig, key)} onEdit={() => { setEditing(key); onPick(sig, key); }} onSave={save(sig, key)} onRemove={remove(sig, key)} onCancel={() => setEditing(null)} />
          ))}
          {!bad.length && <div className={s.sig}><span className="cv-small cv-muted">Nothing in the bad direction: every measure has stayed inside its limits, with no long run on the wrong side of its average.</span></div>}
          {good.length > 0 && <button type="button" className={s.more} onClick={() => setShowGood((v) => !v)} aria-expanded={showGood}>{showGood ? 'Hide good news' : `Show ${good.length} good-news ${good.length === 1 ? 'signal' : 'signals'}`}</button>}
        </div>
      )}
      <span className="cv-xs cv-faint">A signal is a week outside its limits (the baseline average ± 3 standard deviations) or {RUN} weeks in a row on one side of the average. Unexplained ones in the bad direction are sent to the room each night, once.</span>
    </section>
  );
}

/* ------------------------------------------------------------- the week */

function WeekPanel({ t, i, metric, setMetric, notes, onClose }) {
  const r = t.rows[i];
  const weekNotes = METRICS.map((m) => ({ m, n: notes[noteKey(r.iso, m.key)] })).filter((x) => x.n);
  const flagged = new Map();
  t.signals.forEach((sig) => { if (i >= sig.from && i <= sig.to) flagged.set(sig.metric, sig.good ? 'good' : 'bad'); });
  return (
    <div className={s.week} aria-live="polite">
      <div className="cv-row" style={{ justifyContent: 'space-between' }}>
        <span className="cv-row" style={{ gap: 8 }}>
          <span className="cv-h4">Week of {r.label}{r.year ? `, ${r.year}` : ''}</span>
          <Pill tone="neutral" icon={r.own ? 'Database' : 'Info'}>{r.own ? 'Your data' : 'Sample data'}</Pill>
          <span className="cv-xs cv-faint">{zoneOf(t, i)}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={onClose}>Back to this week</Button>
      </div>
      <div className={s.weekGrid}>
        {METRICS.map((m) => {
          const x = t.metrics[m.key];
          const v = x.vals[i];
          const flag = flagged.get(m.key);
          return (
            <button key={m.key} type="button" className={s.weekCell} aria-pressed={metric === m.key} onClick={() => setMetric(m.key)}>
              <span className="cv-xs cv-faint cv-row" style={{ gap: 6 }}>{flag && <i className={`${s.dot} ${flag === 'bad' ? s.dotBad : s.dotGood}`} />}{m.label}</span>
              <span className={s.weekVal}>{fmtMetric(m.key, v)}</span>
              {x.lim && v != null ? <Delta metric={m.key} a={v} b={x.lim.mean} suffix="vs baseline" /> : <span className="cv-xs cv-faint">{v == null ? 'Not in your data yet' : 'No baseline yet'}</span>}
            </button>
          );
        })}
      </div>
      {weekNotes.map(({ m, n }) => <span key={m.key} className="cv-xs cv-muted"><b>{m.label}:</b> {CAUSES.find((c) => c.value === n.cause)?.label}{n.text ? `. ${n.text}` : ''}</span>)}
    </div>
  );
}

/* ------------------------------------------------------------- the page */

function RoomView({ t, notes, setNotes }) {
  const n = t.rows.length;
  const [metric, setMetric] = React.useState('net');
  const [range, setRange] = React.useState(52);
  const [sel, setSel] = React.useState(null);
  const [focus, setFocus] = React.useState(null);
  const [ly, setLy] = React.useState(false);
  const selected = sel != null && sel < n ? sel : null;
  const start = Math.max(0, n - range);
  const m = METRIC[metric];
  const x = t.metrics[metric];
  const marks = {};
  t.signals.filter((sig) => sig.metric === metric).forEach((sig) => { for (let k = sig.from; k <= sig.to; k++) if (x.vals[k] != null && (k >= t.w.judgeFrom || sig.kind === 'shift')) marks[k] = sig.good ? 'good' : 'bad'; });
  const noted = new Set(t.signals.filter((sig) => sig.metric === metric && notes[signalKey(sig, t.rows)]).map((sig) => sig.from));
  const lyVals = t.rows.map((_, i) => { const j = lastYearIndex(t.rows, i, t.w); return j == null ? null : x.vals[j]; });
  const hasLy = lyVals.filter((v) => v != null).length >= 4;
  const pick = (sig, key) => {
    setMetric(sig.metric);
    setFocus(key);
    setSel(sig.to);
    if (sig.from < start) setRange(52);
  };
  const series = [{ key: metric, label: m.label, color: SERIES_COLOR, vals: x.vals }];
  if (ly && hasLy) series.push({ key: 'ly', label: 'Same week last year', color: LY_COLOR, vals: lyVals, dash: '5 4', thin: true });
  const fmt = (v, axis) => (axis && m.unit === 'money' ? fmtMetric(metric, Math.round(v / 100) * 100) : fmtMetric(metric, v));
  return (
    <>
      <div className="cv-grid g4">
        {HEADLINE.map((k) => {
          const mm = METRIC[k], xx = t.metrics[k];
          const recent = xx.vals.slice(-JUDGE_WEEKS);
          const ongoing = t.signals.find((sig) => sig.metric === k && sig.ongoing);
          const lastMark = ongoing ? (ongoing.good ? 'good' : 'bad') : null;
          const status = xx.inside == null ? 'No limits yet' : !xx.inside ? 'Outside limits' : ongoing ? `${ongoing.weeks} weeks ${ongoing.dir === 'up' ? 'above' : 'below'} average` : 'Inside limits';
          const lyLabel = xx.lyI != null ? t.rows[xx.lyI]?.label : null;
          return (
            <button key={k} type="button" className={s.tile} aria-pressed={metric === k} onClick={() => { setMetric(k); setFocus(null); }}>
              <span className={s.tileHead}><span className="cv-xs cv-faint">{TILE[k]}</span><Claim k={xx.claim} /></span>
              <span className="cv-fig md">{fmtMetric(k, xx.latest)}</span>
              <Spark vals={recent} lim={xx.lim} mark={lastMark} />
              <span className={s.tileFoot}>
                <Delta metric={k} a={xx.latest} b={xx.ly} suffix={lyLabel ? `vs ${lyLabel} last year` : 'last year'} />
                <span className={`cv-xs ${lastMark === 'bad' ? 'cv-down' : lastMark === 'good' ? 'cv-up' : 'cv-faint'}`}>{status}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className={s.main}>
        <section className="cv-card" aria-labelledby="trends-chart">
          <div className="cv-card-head">
            <span className="cv-col" style={{ gap: 2 }}>
              <span className="cv-h4" id="trends-chart">{m.label}, weekly</span>
              <span className="cv-xs cv-faint">{m.help}</span>
            </span>
            <Claim k={x.claim} />
          </div>
          <div className={s.toolbar}>
            <Seg label="Measure" value={metric} onChange={(v) => { setMetric(v); setFocus(null); }}
              items={METRICS.map((mm) => { const sg = t.signals.filter((sig) => sig.metric === mm.key); return { v: mm.key, label: mm.short, dot: sg.some((q) => !q.good && !isExplained(notes[signalKey(q, t.rows)])) ? 'bad' : null }; })} />
            <Seg label="Range" value={range} onChange={setRange} items={RANGES.map((r) => ({ v: r.v, label: r.label }))} />
          </div>
          <TrendChart labels={t.rows.map((r) => r.label)} series={series} lim={x.lim} start={start} baseTo={t.w.ready ? t.w.baseTo : null} sampleTo={t.w.from}
            marks={marks} noted={noted} selected={selected} onSelect={setSel} fmt={fmt} height={280}
            ariaLabel={`${m.label} by week, ${t.rows[start]?.label} to ${t.rows[n - 1]?.label}. Use the arrow keys to move between weeks.`}
            tip={{ title: (i) => `Week of ${t.rows[i].label}`, extra: (i) => <span className="cv-faint">{zoneOf(t, i)}{marks[i] ? ` · ${marks[i] === 'bad' ? 'signal' : 'good signal'}` : ''}</span> }} />
          <div className="cv-row" style={{ justifyContent: 'space-between' }}>
            <div className="cv-legend">
              <span><i className={s.legendLine} style={{ borderColor: SERIES_COLOR }} />{m.label}</span>
              {x.lim && <span><i className={s.legendBand} />Control limits (baseline ± 3σ)</span>}
              {Object.values(marks).includes('bad') && <span><i className={`${s.dot} ${s.dotBad}`} />Signal, wrong direction</span>}
              {Object.values(marks).includes('good') && <span><i className={`${s.dot} ${s.dotGood}`} />Signal, good direction</span>}
              {ly && hasLy && <span><i className={s.legendLine} style={{ borderColor: LY_COLOR, borderTopStyle: 'dashed' }} />Same week last year</span>}
            </div>
            {hasLy && <label className="cv-xs cv-muted cv-row" style={{ gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={ly} onChange={(e) => setLy(e.target.checked)} />Compare with last year</label>}
          </div>
          {selected != null
            ? <WeekPanel t={t} i={selected} metric={metric} setMetric={setMetric} notes={notes} onClose={() => { setSel(null); setFocus(null); }} />
            : <span className="cv-xs cv-faint">Click a week, or focus the chart and use the arrow keys, to see every measure for that week.</span>}
        </section>
        <Signals t={t} notes={notes} setNotes={setNotes} focus={focus} onPick={pick} />
      </div>

      <section className="cv-card" aria-labelledby="trends-all">
        <div className="cv-card-head">
          <span className="cv-col" style={{ gap: 2 }}>
            <span className="cv-h4" id="trends-all">Every measure, last {JUDGE_WEEKS} weeks</span>
            <span className="cv-xs cv-faint">The shaded band is each measure&apos;s control limits. Pick one to chart it above.</span>
          </span>
        </div>
        <div className={s.minis}>
          {METRICS.map((mm) => {
            const xx = t.metrics[mm.key];
            const ongoing = t.signals.find((sig) => sig.metric === mm.key && sig.ongoing);
            const mark = ongoing ? (ongoing.good ? 'good' : 'bad') : null;
            return (
              <button key={mm.key} type="button" className={s.mini} aria-pressed={metric === mm.key} onClick={() => { setMetric(mm.key); setFocus(null); window.scrollTo?.({ top: 0, behavior: 'smooth' }); }}>
                <span className={s.miniHead}><span className="cv-xs cv-muted">{mm.label}</span>{mm.unit === 'money' || mm.unit === 'cents' ? <Claim k={xx.claim} /> : null}</span>
                <span className={s.miniHead}><span className={s.miniVal}>{fmtMetric(mm.key, xx.latest)}</span>{xx.lim && xx.latest != null ? <Delta metric={mm.key} a={xx.latest} b={xx.lim.mean} suffix="vs baseline" /> : <span className="cv-xs cv-faint">{xx.latest == null ? 'Not in your data yet' : 'No baseline yet'}</span>}</span>
                <Spark vals={xx.vals.slice(-JUDGE_WEEKS)} lim={xx.lim} mark={mark} ariaLabel={`${mm.label}, last ${JUDGE_WEEKS} weeks`} />
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

function GroupView({ onOpen }) {
  const rooms = groupSeries(CV_GROUP.rooms);
  const labels = rooms[0]?.labels ?? [];
  const [sel, setSel] = React.useState(null);
  const series = rooms.map((r, i) => ({ key: r.id, label: r.name, color: roomColor(i), vals: r.perSeat }));
  const fmt = (v) => fmtMetric('net', v);
  return (
    <>
      <section className="cv-card" aria-labelledby="trends-group">
        <div className="cv-card-head">
          <span className="cv-col" style={{ gap: 2 }}>
            <span className="cv-h4" id="trends-group">Earned per seat, weekly, {rooms.length === 1 ? 'one room' : `all ${rooms.length} rooms`}</span>
            <span className="cv-xs cv-faint">Per seat, so rooms of different sizes compare fairly. Weeks before a room&apos;s own data starts are left out.</span>
          </span>
          <Claim k={rooms.some((r) => r.own) ? 'mod' : 'obs'} />
        </div>
        <TrendChart labels={labels} series={series} selected={sel} onSelect={setSel} fmt={fmt} height={280} ariaLabel="Earned per seat by room, weekly. Use the arrow keys to move between weeks." tip={{ title: (i) => `Week of ${labels[i]}` }} />
        <div className="cv-legend">{series.map((sr) => <span key={sr.key}><i className={s.legendLine} style={{ borderColor: sr.color }} />{sr.label}</span>)}</div>
      </section>
      <section className="cv-card flush" aria-label="Rooms compared">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Rooms compared">
          <table className="cv-table">
            <thead><tr><th>Room</th><th className="r">Seats</th><th className="r">Earned per seat, this week</th><th className="r">Last 13 weeks</th><th className="r">Baseline</th><th className="r">Change</th><th className="r">To explain</th><th /></tr></thead>
            <tbody>{rooms.map((r) => {
              const open = r.t.signals.filter((sig) => !sig.good && !isExplained(cleanNotes(engine.saved('trends.notes', r.id))[signalKey(sig, r.t.rows)])).length;
              return (
                <tr key={r.id}>
                  <td><b>{r.name}</b>{r.own ? <span className="cv-xs cv-faint"> · your data</span> : null}</td>
                  <td className="r cv-num">{r.seats}</td>
                  <td className="r cv-num">{fmt(r.latest)}</td>
                  <td className="r cv-num">{fmt(r.recentMean)}</td>
                  <td className="r cv-num">{fmt(r.baseMean)}</td>
                  <td className="r">{r.recentMean != null && r.baseMean != null ? <Delta metric="earned" a={r.recentMean} b={r.baseMean} /> : <span className="cv-xs cv-faint">—</span>}</td>
                  <td className="r cv-num">{r.t.w.ready ? open : '—'}</td>
                  <td className="r"><button type="button" className={s.rankBtn} onClick={() => onOpen(r.id)}>Open</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function CvTrends() {
  const eng = useEngine();
  const [view, setView] = React.useState('room');
  const [rawNotes, setNotes] = useSaved('trends.notes', {});
  const notes = React.useMemo(() => cleanNotes(rawNotes), [rawNotes]);
  const rows = CV_D.hist.rows;
  const t = React.useMemo(() => trendsFor(rows), [rows]);
  const first = rows[0], last = rows[rows.length - 1];
  const own = CV_D.room.fromToast;
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
      <PageHead over={`Trends · ${CV_ROOM.name} · ${rows.length} weeks, ${first?.label ?? ''} ${first?.year ?? ''} to ${last?.label ?? ''} ${last?.year ?? ''}`} q="Is this room getting better or worse, and is any of it unusual?"
        sub={own
          ? `Judged on your own Toast weeks only (${t.w.trusted} so far, to ${own.end}). Earlier weeks are the sample's and are shown greyed, never used to set your limits.`
          : 'A year of weekly history. Seasonality is expected; what matters is a week outside its control limits, judged against a baseline the recent weeks didn’t shape.'}
        right={<>
          {multi && <Tabs value={view} onChange={setView} tabs={[{ value: 'room', label: CV_ROOM.short }, { value: 'group', label: 'All rooms' }]} />}
          <Button variant="secondary" size="sm" icon="Download" onClick={exportCsv}>CSV</Button>
        </>} />
      {view === 'room' || !multi
        ? <RoomView key={eng.room} t={t} notes={notes} setNotes={setNotes} />
        : <GroupView onOpen={(id) => { engine.setRoom(id); setView('room'); }} />}
      <Callout icon="Info">{own
        ? <>Food cost on your own weeks is net sales × this room&apos;s food rate until supplier invoices are in, so food, prime cost and earned are <b>Modelled</b>. Weighted margin per dish and past weeks&apos; register exceptions aren&apos;t in Toast&apos;s exports yet and stay blank rather than show the sample&apos;s.</>
        : <>History here is the sample group&apos;s, with the same seasonality every year: a December peak, a January dip, Thanksgiving and Christmas. Hand-entered data changes the live week only; past weeks are closed. Connect Toast and this page judges your own weeks instead.</>}</Callout>
      <DenseTrends />
    </div>
  );
}

export { CvTrends };
