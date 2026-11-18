'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { CV_D, CV_GROUP, CV_ROOM, Callout, Claim, PageHead, Pill, useCv } from '../core';
import { dataEnd } from '../../../lib/data/readers';
import {
  CAUSES, JUDGE_WEEKS, METHOD, METRIC, METRICS, METRIC_GROUPS, MIN_BASELINE, RUN,
  availableMetrics, cleanNotes, explainSignal, fmtChange, fmtMetric,
  isExplained, lastYearIndex, leaksOf, noteKey, rangesFor, signalKey, trendsCsv, trendsFor,
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
const tone = (key, v) => (v == null || Math.abs(v) < 0.05 ? 'cv-faint' : (v > 0) === METRIC[key].up ? 'cv-up' : 'cv-down');
const shortDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const isMoney = (key) => ['money', 'cents'].includes(METRIC[key]?.unit);
/** A value next to a limit it rounds to: one more decimal, so the value never reads the same as the limit. */
const fmtNear = (key, v, ref) => {
  const a = fmtMetric(key, v);
  const u = METRIC[key]?.unit;
  if (ref == null || a !== fmtMetric(key, ref) || !['pct', 'pct1', 'cents', 'minutes'].includes(u)) return a;
  const d = u === 'pct' ? 2 : 3;
  if (u === 'cents') return '$' + v.toFixed(d);
  if (u === 'minutes') return v.toFixed(d) + ' min';
  return v.toFixed(d) + '%';
};
/** The normal range, at the same precision as the value beside it. */
const rangeNear = (key, e, v) => {
  const tight = v != null && (fmtNear(key, v, e.ucl) !== fmtMetric(key, v) || fmtNear(key, v, e.lcl) !== fmtMetric(key, v));
  const f = (x) => (tight ? fmtNear(key, x, x) : fmtMetric(key, x));
  return f(e.lcl) + ' to ' + f(e.ucl);
};
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

/* ------------------------------------------------------------- leak watch */

/** What the dollar conversion needs from the room: dishes sold a week and the average wage. */
function ctxOf(d) {
  const staff = d?.room?.staff ?? [];
  const hours = staff.reduce((a, p) => a + (p.hours || 0), 0);
  return { dishes: d?.menu?.units || null, wage: hours ? staff.reduce((a, p) => a + (p.hours || 0) * (p.rate || 0), 0) / hours : null };
}
const usd = (v) => `$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
const signedUsd = (v) => `${v < 0 ? '−' : '+'}${usd(v)}`;

/**
 * The answer first: how much is leaking out of this room each week, how much
 * the changes that are working bring in, and the last 13 weeks in total.
 * Totals never count one move twice (see leaksOf).
 */
function LeakHero({ t, L, name }) {
  const have = Math.max(0, MIN_BASELINE + 1 - t.w.needWeeks);
  if (!t.w.ready) {
    return (
      <section className={`cv-card ${s.verdict}`} data-state="unknown">
        <div className={s.vPart}>
          <span className={s.vIcon}><Icon name="Hourglass" size={26} /></span>
          <span className="cv-col" style={{ gap: 4, minWidth: 0 }}>
            <span className={s.vWord}>Learning {name}&apos;s normal week</span>
            <p className={s.vNote}>Leak Watch needs {MIN_BASELINE + 1} weeks of this room&apos;s own data before it can tell a leak from an ordinary week.</p>
          </span>
        </div>
        <div className={s.vStat}>
          <span className="cv-xs cv-faint">History</span>
          <span className={s.big}>{have}<small> / {MIN_BASELINE + 1} weeks</small></span>
          <Progress have={have} need={MIN_BASELINE + 1} />
        </div>
      </section>
    );
  }
  const leaking = L.leakWeek > 0;
  const nLeaks = L.leaks.filter((e) => e.s.ongoing && e.counted).length;
  const nWins = L.wins.filter((e) => e.s.ongoing && e.counted).length;
  const net13 = L.win13 - L.leak13;
  const title = leaking ? <>{name} is losing about <span className={s.heroLoss}>{usd(L.leakWeek)}</span> a week</> : <>No slow leaks in {name} right now</>;
  const note = leaking
    ? `${plural(nLeaks, 'slow change')} ${nLeaks === 1 ? 'is' : 'are'} costing money every week, about ${usd(L.leak13)} over the last ${L.weeks} weeks. Fix the first one below.`
    : L.winWeek > 0
      ? `Nothing is costing money week after week. ${plural(nWins, 'change')} ${nWins === 1 ? 'is' : 'are'} bringing in about ${usd(L.winWeek)} a week: keep ${nWins === 1 ? 'it' : 'them'} going.`
      : 'Nothing is costing money week after week. Every number is back within its normal swings.';
  return (
    <section className={`cv-card ${s.verdict} ${s.hero}`} data-state={leaking ? 'slipping' : 'improving'} aria-labelledby="leak-answer">
      <div className={s.vPart}>
        <span className={`${s.vIcon} ${leaking ? 'cv-down' : 'cv-up'}`}><Icon name={leaking ? 'TrendingDown' : 'CircleCheck'} size={26} /></span>
        <span className="cv-col" style={{ gap: 6, minWidth: 0 }}>
          <span className={s.vWord} id="leak-answer">{title}</span>
          <p className={s.vNote}>{note}</p>
        </span>
      </div>
      <div className={s.heroFigs}>
        <div className={s.heroFig}>
          <span className={s.heroLabel}>Leaking now</span>
          <span className={`${s.big} ${leaking ? s.loss : ''}`}>{leaking ? `−${usd(L.leakWeek)}` : '$0'}<small> a week</small></span>
        </div>
        <div className={s.heroFig}>
          <span className={s.heroLabel}>Gaining now</span>
          <span className={`${s.big} ${L.winWeek > 0 ? s.gain : ''}`}>{L.winWeek > 0 ? `+${usd(L.winWeek)}` : '$0'}<small> a week</small></span>
        </div>
        <div className={s.heroFig}>
          <span className={s.heroLabel}>Last {L.weeks} weeks</span>
          <span className={`${s.big} ${net13 < 0 ? s.loss : net13 > 0 ? s.gain : ''}`}>{net13 ? signedUsd(net13) : '$0'}</span>
          <span className="cv-xs cv-faint">{usd(L.win13)} gained, {usd(L.leak13)} leaked</span>
        </div>
      </div>
      <span className={s.heroClaim}><Claim k="est" /><span>Estimates. Each change is measured against its own usual level, in contribution (what&apos;s left of sales after food and labor).</span></span>
    </section>
  );
}

/**
 * Normal noise: how much this room's contribution swings in an ordinary week,
 * so one bad week inside that band isn't mistaken for a leak.
 */
function NoiseLine({ t, name }) {
  const lim = t.metrics.earned.lim;
  if (!t.w.ready || !lim) return null;
  const last = t.metrics.earned.latest;
  const inside = last != null && last >= lim.lcl && last <= lim.ucl;
  return (
    <div className={`cv-card ${s.noise}`}>
      <span className={s.noiseIco}><Icon name="Activity" size={20} /></span>
      <span className="cv-col" style={{ gap: 4, minWidth: 0 }}>
        <span className={s.noiseTitle}>Normal ups and downs: {usd(lim.lcl)} to {usd(lim.ucl)} a week</span>
        <span className={s.headSub}>
          That&apos;s how far {name}&apos;s contribution swings in an ordinary week. One bad week inside that band is noise, not a leak: no need to react.
          {last != null && ` This week: ${usd(last)}, ${inside ? 'inside' : 'outside'} the band.`}
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- every room */

/**
 * The location switch: one location on the page at a time. Each button shows
 * whether that room is improving, steady or slipping and how many changes are
 * waiting, so the owner can see where to go next without opening each one.
 */
function LocationSwitch({ current, onPick }) {
  const rooms = CV_GROUP.rooms ?? [];
  if (rooms.length < 2) return null;
  return (
    <div className={s.locs} role="group" aria-label="Location">
      {rooms.map((d) => {
        const t = trendsFor(d.hist.rows);
        const L = leaksOf(t, ctxOf(d));
        const name = d.profile?.short || d.id;
        const kind = !t.w.ready ? 'wait' : L.leakWeek > 0 ? 'loss' : 'ok';
        const fig = kind === 'wait' ? 'Learning' : kind === 'loss' ? `−${usd(L.leakWeek)}/wk` : 'No leaks';
        return (
          <button key={d.id} type="button" className={s.loc} data-kind={kind} aria-pressed={d.id === current} onClick={() => onPick(d.id)}
            aria-label={`${name}: ${kind === 'loss' ? `losing about ${usd(L.leakWeek)} a week` : kind === 'ok' ? 'no slow leaks' : 'still learning its normal week'}`}>
            <span className={s.locIco}><Icon name={kind === 'loss' ? 'TrendingDown' : kind === 'ok' ? 'CircleCheck' : 'Hourglass'} size={16} /></span>
            <span className={s.locName}>{name}</span>
            <span className={s.locFig}>{fig}</span>
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

/** A plain title and sentence for one change: what happened, against what's normal. */
function plainOf(sig, rows) {
  const m = METRIC[sig.metric], e = sig.expected, f = (v) => fmtMetric(sig.metric, v);
  const name = { earned: 'Contribution', wcm: 'Margin per dish', exc: 'Voids and comps', covers: 'Guests', net: 'Sales' }[sig.metric] ?? m.label;
  if (sig.kind === 'shift') {
    return {
      title: `${name} ${sig.dir} for ${plural(sig.weeks, 'week')}`,
      text: `For ${sig.weeks} weeks in a row it has sat ${sig.dir === 'up' ? 'above' : 'below'} its usual average of ${f(e.mean)}, at about ${f(sig.avg)}. No single week looks odd, but a run this long isn't normal.`,
    };
  }
  const when = sig.weeks === 1 ? `in the week of ${rows[sig.i]?.label}` : `in ${sig.breaches} of ${sig.weeks} weeks to ${sig.ongoing ? 'this week' : rows[sig.to]?.label}`;
  return {
    title: `${name} ${sig.dir === 'up' ? 'jumped' : 'dropped'}`,
    text: `It ${sig.dir === 'up' ? 'reached' : 'fell to'} ${fmtNear(sig.metric, sig.value, sig.dir === 'up' ? e.ucl : e.lcl)} ${when}. A normal week is ${rangeNear(sig.metric, e, sig.value)}.`,
  };
}

function ChangeRow({ e, t, note, primary, open, editing, onToggle, onEdit, onSave, onRemove, onCancel }) {
  const cv = useCv();
  const sig = e.s;
  const rows = t.rows;
  const m = METRIC[sig.metric];
  const x = t.metrics[sig.metric];
  const explained = isExplained(note);
  const kind = sig.good ? 'good' : explained ? 'done' : sig.severity === 'high' ? 'crit' : 'bad';
  const cause = note && CAUSES.find((c) => c.value === note.cause);
  const shown = sig.kind === 'limit' ? sig.value : sig.avg;
  const why = open ? explainSignal(sig, t, { proofs: CV_D.proofs, candidates: CV_D.candidates }) : null;
  const todo = TODO[sig.metric];
  const plain = plainOf(sig, rows);
  const n = rows.length;
  const start = Math.max(t.w.from, Math.min(sig.from - 12, n - 26));
  const marks = {};
  for (let k = sig.from; k <= sig.to; k++) if (x.vals[k] != null && !t.holidays[k].length) marks[k] = kind === 'done' ? 'bad' : kind;
  const fmt = (v, axis) => (axis && m.unit === 'money' ? fmtMetric(m.key, Math.round(v / 100) * 100) : fmtMetric(m.key, v));
  return (
    <div className={s.change} data-kind={kind}>
      <div className={s.changeMain}>
        <span className={`${s.sigIco} ${s[kind]}`}><Icon name={explained ? 'CircleCheck' : sig.dir === 'up' ? 'TrendingUp' : 'TrendingDown'} size={18} /></span>
        <div className={s.changeText}>
          <span className={s.changeTitleRow}>
            <span className={s.cardTitle}>{plain.title}</span>
            <span className={`${s.sev} ${sig.good ? s.sevInfo : sig.ongoing ? s.sevHigh : s.sevLow}`}>{sig.good ? (sig.ongoing ? 'Still working' : 'Ended') : sig.ongoing ? 'Still leaking' : 'Stopped'}</span>
          </span>
          <p className={s.changeSentence}>{plain.text}</p>
          <div className={s.changeDo}>
            {sig.good ? <span className={s.doGood}><Icon name="CircleCheck" size={16} />Find out what went right and keep doing it.</span>
              : cause ? <Pill tone={explained ? 'neutral' : 'warn'} icon={explained ? 'CircleCheck' : 'Hourglass'}>{cause.label}</Pill>
                : todo && <><span className={s.doLabel}>What to do</span><Button size="sm" variant={primary ? 'primary' : 'secondary'} className={primary ? s.ctaSm : undefined} iconRight="ArrowRight" onClick={() => cv.go(todo.page)}>{todo.label}</Button></>}
            <span className={s.cardLinks}>
              <button type="button" className={s.linkBtn} onClick={onToggle} aria-expanded={open}>{open ? 'Hide the weeks' : 'Show the weeks'}<Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={15} /></button>
              {!editing && <button type="button" className={s.linkBtn} onClick={onEdit}>{note ? 'Edit note' : 'I know why'}</button>}
            </span>
          </div>
          {note?.text && !editing && <span className={s.noteText}>“{note.text}”</span>}
        </div>
        <div className={s.changeFig}>
          {e.$ ? (
            <>
              <span className={`${s.cardVal} ${sig.good ? s.gain : s.loss}`}>{signedUsd(e.$.perWeek)}<small> a week</small></span>
              <span className="cv-xs cv-faint">{sig.ongoing ? `about ${usd(e.$.soFar)} ${sig.good ? 'gained' : 'lost'} so far` : `${usd(e.$.soFar)} ${sig.good ? 'gained' : 'lost'} while it lasted`}</span>
              {!e.counted && <span className="cv-xs cv-faint">{sig.good ? 'Part of a bigger gain' : 'Part of a bigger leak'}: counted once</span>}
            </>
          ) : <span className="cv-xs cv-faint">Not counted in dollars</span>}
          <Claim k={e.$?.claim ?? x.claim} />
        </div>
      </div>
      {editing && <NoteForm note={note} onSave={onSave} onRemove={onRemove} onCancel={onCancel} />}
      {open && why && (
        <div className={s.details}>
          <TrendChart labels={rows.map((rw) => rw.label)} series={[{ key: m.key, label: m.short, color: SERIES_COLOR, vals: x.vals }]} lim={x.lim} start={start} end={n - 1}
            marks={marks} fmt={fmt} height={200} ariaLabel={`${m.label} by week, with the flagged weeks marked`}
            tip={{ title: (i) => `Week of ${shortDate(rows[i].iso) || rows[i].label}` }} />
          <div className={s.detailFig}>
            <span className="cv-xs cv-faint">{sig.kind === 'limit' ? 'Furthest week' : 'Average over these weeks'}</span>
            <span className={s.detailVal}>{fmtNear(sig.metric, shown, sig.kind === 'limit' ? (sig.dir === 'up' ? sig.expected.ucl : sig.expected.lcl) : null)}</span>
            <span className="cv-xs cv-faint">normal {rangeNear(sig.metric, sig.expected, sig.kind === 'limit' ? sig.value : null)}</span>
            <RangeBar value={shown} lim={sig.expected} tone={kind === 'done' ? 'bad' : kind} />
          </div>
          <p className={s.cardWatch}><Icon name="Eye" size={15} /><span>{watchText(sig)}</span></p>
          {e.$ && <p className={s.cardWhat}><b>How the dollars are worked out:</b> {e.$.basis}, over {plural(e.$.weeks, 'week')}. An estimate, not a cause.</p>}
          <p className={s.cardWhat}><b>{m.label}:</b> {m.help}</p>
          {why.arithmetic.length > 0 && <div className={s.why}><b>What moved</b><ul>{why.arithmetic.map((v) => <li key={v}>{v}</li>)}</ul></div>}
          {why.possible.length > 0 && <div className={s.why}><b>Worth checking</b><ul>{why.possible.map((v) => <li key={v}>{v}</li>)}</ul></div>}
          {why.related.length > 0 && <div className={s.why}><b>Changes on the same lever</b><ul>{why.related.map((pr) => <li key={pr.id}>{pr.title} ({pr.outcome}{pr.since ? `, since ${pr.since}` : ''}), measured on Proof</li>)}</ul></div>}
          <span className="cv-xs cv-faint">How sure: {sig.z} standard deviations from the usual, against {sig.n} past weeks{sig.limited ? ' (limited history)' : ''}. The figures alone can&apos;t prove the cause.</span>
          {why.finding && <div className={s.acts}><Button size="sm" variant="ghost" icon="ListChecks" onClick={() => cv.go('finding', { id: why.finding.id })}>Open the finding</Button></div>}
        </div>
      )}
    </div>
  );
}

function LeakList({ items, t, notes, setNotes, name, good }) {
  const [editing, setEditing] = React.useState(null);
  const [open, setOpen] = React.useState(null);
  const [showEnded, setShowEnded] = React.useState(false);
  const keyed = items.map((e) => ({ e, key: signalKey(e.s, t.rows) }));
  // Up front: what's still going and counted in the total. Behind a click: what ended, and moves that are part of a bigger one.
  const live = keyed.filter((x) => x.e.s.ongoing && (x.e.counted || !x.e.$));
  const ended = keyed.filter((x) => !live.includes(x));
  const list = [...live, ...(showEnded ? ended : [])];
  const firstKey = good ? null : live.find((x) => !isExplained(notes[x.key]))?.key;
  const save = (sig, key) => (v) => {
    setNotes((cur) => ({ ...cleanNotes(cur), [key]: { ...v, at: new Date().toISOString() } }), `Trends note: ${METRIC[sig.metric].label}, week of ${t.rows[sig.from]?.label} (${CAUSES.find((c) => c.value === v.cause)?.label})`);
    setEditing(null);
  };
  const remove = (sig, key) => () => {
    setNotes((cur) => { const next = { ...cleanNotes(cur) }; delete next[key]; return next; }, `Trends note removed: ${METRIC[sig.metric].label}, week of ${t.rows[sig.from]?.label}`);
    setEditing(null);
  };
  return (
    <div className={s.changes}>
      {list.map(({ e, key }) => (
        <ChangeRow key={key} e={e} t={t} note={notes[key]} primary={key === firstKey} open={open === key} editing={editing === key}
          onToggle={() => setOpen(open === key ? null : key)}
          onEdit={() => setEditing(key)} onSave={save(e.s, key)} onRemove={remove(e.s, key)} onCancel={() => setEditing(null)} />
      ))}
      {!live.length && (
        <div className={`cv-card ${s.emptyRow}`}>
          <span className={good ? '' : 'cv-up'}><Icon name={good ? 'CircleMinus' : 'CircleCheck'} size={22} /></span>
          <span>{good ? `Nothing in ${name} is running above its usual right now.` : `Nothing in ${name} is leaking right now.`}</span>
        </div>
      )}
      {ended.length > 0 && <button type="button" className={s.more} onClick={() => setShowEnded((v) => !v)} aria-expanded={showEnded}>{showEnded ? 'Show less' : `Show ${ended.length} more: ${[ended.some((x) => x.e.s.ongoing) && 'part of the same change', ended.some((x) => !x.e.s.ongoing) && `${good ? 'ended' : 'stopped'} in the last ${t.rows.length - t.w.judgeFrom} weeks`].filter(Boolean).join(', or ')}`}</button>}
    </div>
  );
}

/** A numbered step heading, so the page reads top to bottom. */
function Step({ n, title, sub, id }) {
  return (
    <div className={s.step}>
      <span className={s.stepNum} aria-hidden="true">{n}</span>
      <span className="cv-col" style={{ gap: 2, minWidth: 0 }}>
        <h3 className={s.stepTitle} id={id}>{title}</h3>
        {sub && <span className={s.headSub}>{sub}</span>}
      </span>
    </div>
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
  const L = React.useMemo(() => leaksOf(t, ctxOf(CV_D)), [t]);
  const metrics = availableMetrics(t);
  const ranges = rangesFor(t);
  const [metric, setMetric] = React.useState(metrics.find((mm) => mm.key === 'earned')?.key ?? metrics[0]?.key ?? 'net');
  const [range, setRange] = React.useState(ranges.at(-1)?.v ?? n);
  const [cmpMode, setCmp] = React.useState('none');
  const [sel, setSel] = React.useState(null);
  const [focus, setFocus] = React.useState(null);
  const [table, setTable] = React.useState(false);
  const [explore, setExplore] = React.useState(false);
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
  const roomName = CV_ROOM.short || CV_ROOM.name;
  return (
    <>
      <LeakHero t={t} L={L} name={roomName} />

      {t.w.ready && (
        <>
          <Step n={1} id="trends-leaks" title="Leaks to fix" sub="Slow changes costing money every week, biggest first. Each one has one thing to do." />
          <LeakList items={L.leaks} t={t} notes={notes} setNotes={setNotes} name={roomName} />

          <Step n={2} id="trends-wins" title="What's working" sub="Changes bringing in more than usual. Find out why, so you keep them." />
          <LeakList items={L.wins} t={t} notes={notes} setNotes={setNotes} name={roomName} good />

          <NoiseLine t={t} name={roomName} />
        </>
      )}

      <details className={`cv-card ${s.disclosure}`} open={explore} onToggle={(e) => setExplore(e.currentTarget.open)}>
        <summary><Icon name="ChevronDown" size={16} className={s.chev} />Explore any number, week by week</summary>
        <div className={s.explore} ref={chartRef}>
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
        </div>
      </details>

      <details className={`cv-card ${s.disclosure}`}>
        <summary><Icon name="ChevronDown" size={16} className={s.chev} />About this data</summary>
        <div className={s.about}>
          <dl className={s.facts}>
            <dt>Source</dt><dd>{t.w.own ? 'Your Toast data, your own weeks only' : 'The sample group'}</dd>
            <dt>Data through</dt><dd>{shortDate(dataThrough || t.rows[n - 1]?.iso)}</dd>
            <dt>Usual range</dt><dd>{x.lim ? `Average ± 3 standard deviations of ${x.lim.n} baseline weeks${x.lim.limited ? ' (limited history)' : ''}` : 'Not enough weeks yet'}</dd>
            <dt>Flagged when</dt><dd>A week leaves its usual range, or {RUN} weeks in a row sit on one side of the average. Holiday and no-sales weeks are never flagged.</dd>
            <dt>Dollars</dt><dd>Each change against its usual level, in contribution: cost shares × that week&apos;s sales, guests × what a guest usually leaves, margin per dish × dishes sold. Where two changes overlap (food and prime cost), only the bigger is added. Estimates, not causes.</dd>
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
      <PageHead over={`Leak Watch · ${own ? 'your Toast data' : 'sample data'} through ${shortDate(last?.iso)}`}
        q="Catch the slow leaks before your P&L does"
        sub="Small changes look fine week to week, then cost thousands by the time the monthly P&L arrives. Leak Watch puts each one in dollars and tells you what to do."
        right={<Button variant="secondary" size="sm" icon="Download" onClick={exportCsv}>CSV</Button>} />
      <LocationSwitch current={eng.room} onPick={(id) => engine.setRoom(id)} />
      <RoomView key={eng.room} t={t} notes={notes} setNotes={setNotes} />
    </div>
  );
}

export { CvTrends };
