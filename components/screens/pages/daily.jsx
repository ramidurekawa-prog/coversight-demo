'use client';

import * as React from 'react';

import { Button, Icon, Tabs } from '../../kit';
import { useEngine, useSaved } from '../../engine';
import { CV_D, CV_GROUP, CV_ROOM, Callout, Claim, PageHead, Pill, cvMoney, useCv } from '../core';
import { densify } from '../../../lib/data/dense';
import { COMPARISONS, DEFAULT_DAYPARTS, addDays, calendar, change, compareDay, daysCsv, explainDay, fromSample, heatGrid, lastYear, months, rangeTotals, ratio, weekdayBaseline } from '../../../lib/data/page/daily';
import { DayChart } from './daily-chart';
import { Checks, DayItems, DayNote, DayParts, Delta, Fold, Hours, MoneyBreakdown } from './daily-day';
import { readDailyFiles, useDailyData } from './daily-store';
import s from './daily.module.css';

/* Daily detail: what happened on one restaurant day, and what to do about it.
 * Visual first: big numbers, charts you can point at and tap, one next step;
 * every table and definition sits one click away. A room's own days come from
 * its Toast data and are never filled in; the sample group says it's sample
 * everywhere it matters. */

const $ = (v) => (v == null ? '—' : cvMoney(Math.round(v)));
const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const $c = (v) => (v == null ? '—' : cvMoney(v, { cents: true }));
const monthName = (k, opts = { month: 'short', year: 'numeric' }) => new Date(`${k}-15T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
const dayName = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const longDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const compact = (v) => (v >= 10000 ? `$${(v / 1000).toFixed(0)}k` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);
const signed$ = (v) => `${v >= 0 ? '+' : '−'}${cvMoney(Math.abs(Math.round(v)))}`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const METRICS = {
  net: { label: 'Net sales', fmt: $, get: (d) => d.net },
  covers: { label: 'Covers', fmt: n0, get: (d) => d.covers },
  check: { label: 'Avg check', fmt: (v) => (v == null ? '—' : cvMoney(v, { cents: true })), get: (d) => d.check },
  labour: { label: 'Labour %', fmt: (v) => (v == null ? '—' : `${v.toFixed(1)}%`), get: (d) => (d.labour != null && d.net ? (d.labour / d.net) * 100 : null), needs: 'labour' },
  earned: { label: 'After food & labour', fmt: $, get: (d) => d.earned, needs: 'earned' },
};
const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['364', '1 year'], ['728', '2 years'], ['custom', 'Custom']];
const HEAT = [['covers', 'Covers'], ['sales', 'Sales'], ['splh', 'Sales per labour hour', 'labourHours'], ['cps', 'Covers per server', 'servers'], ['ticketMin', 'Ticket min', 'ticket'], ['seatUse', 'Seats used', 'seatUse']];

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The same weekday over the 8 weeks to this day, as a little line; a week not held is a gap. */
function Spark({ vals, w = 96, h = 30 }) {
  const ok = vals.filter((v) => v != null);
  if (ok.length < 2) return null;
  const lo = Math.min(...ok), hi = Math.max(...ok), sp = hi - lo || 1;
  const x = (i) => (i / (vals.length - 1)) * (w - 6) + 3, y = (v) => h - 4 - ((v - lo) / sp) * (h - 8);
  const d = vals.map((v, i) => (v == null ? '' : `${i && vals[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(' ');
  const last = vals.at(-1);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ flex: 'none' }}>
      <path d={d} fill="none" stroke="var(--cat-1)" strokeWidth="1.5" opacity="0.6" />
      {last != null && <circle cx={x(vals.length - 1)} cy={y(last)} r="3.5" fill="var(--accent)" />}
    </svg>
  );
}

/** A headline number: big figure, change against the comparison, and this weekday's last 8 weeks. Tap to chart it below. */
function Tile({ label, value, word, delta, sub, spark, sample, pressed, onClick }) {
  return (
    <button type="button" className={s.tile} aria-pressed={onClick ? pressed : undefined} onClick={onClick} disabled={!onClick} title={onClick ? 'Show this on the history chart' : undefined}>
      <span className={s.kpiTop}><span className="cv-xs cv-faint" style={{ fontWeight: 600 }}>{label}</span>{sample ? <Pill icon="FlaskConical">Sample</Pill> : <Claim k="obs" />}</span>
      <span className={word ? s.kpiWord : 'cv-fig lg'}>{value}</span>
      <span className={s.tileFoot}>
        <span className="cv-col" style={{ gap: 4, minWidth: 0 }}>{delta && <span className={s.bigDelta}>{delta}</span>}<span className={s.tileSub}>{sub}</span></span>
        {spark && <Spark vals={spark} />}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ what to do */

/** One next step for the day, from what moved most. Suggestions to look, never claims about why. */
function nextStep({ day, base, why, dev, own, notes, iso, cmpLabel }) {
  if (day.complete === false) return { text: 'This day was still open when it was read. Check back after close for final numbers.', icon: 'Clock' };
  if (!base || !why) return { text: 'There’s nothing to compare this day with yet. Pick another comparison above.', icon: 'Info' };
  const lp = (d) => ratio(d.labour, d.net);
  const labPts = day.labour != null && base.labour != null && lp(day) != null && lp(base) != null ? (lp(day) - lp(base)) * 100 : null;
  if (labPts != null && labPts > 3) return { text: `Labour was ${labPts.toFixed(1)} points of sales above ${cmpLabel}. Check the hours where staff outnumbered guests.`, act: 'hours', btn: 'See the hours', icon: 'Users' };
  if (day.voids != null && base.voids != null && day.voids - base.voids > 50) return { text: `${$(day.voids)} was voided after it reached the kitchen (usually ${$(base.voids)}). Go through those checks with the kitchen.`, act: own ? 'checks' : 'hours', btn: own ? 'See the checks' : 'See the hours', icon: 'Ban' };
  if (day.discounts - (base.discounts ?? 0) > 50 && change(day.discounts, base.discounts) > 0.5) return { text: `Discounts were ${$(day.discounts)} (usually ${$(base.discounts)}). See which checks carried them.`, act: own ? 'checks' : 'money', btn: own ? 'See the checks' : 'See the money', icon: 'Receipt' };
  if (why.flat) return { text: `A normal ${day.dow}. Nothing here needs action.`, icon: 'CircleCheck', good: true };
  const down = why.dNet < 0;
  const coversLed = Math.abs(why.coversEffect ?? 0) >= Math.abs(why.checkEffect ?? 0);
  if (down && coversLed) return notes[iso] ? { text: `Fewer guests than ${cmpLabel}. The note says: “${notes[iso].text}”`, act: 'hours', btn: 'See when it was quiet', icon: 'Users' } : { text: `Fewer guests than ${cmpLabel}. If something was different, add a note so this day isn’t treated as normal.`, act: 'note', btn: 'Add a note', icon: 'StickyNote' };
  if (down) return { text: `Guests spent less each (${$c(day.check)} vs ${$c(base.check)}). Look at what sold.`, act: own ? 'sold' : 'money', btn: own ? 'See what sold' : 'See the money', icon: 'Receipt' };
  return notes[iso] ? { text: `A strong ${day.dow}, ${signed$(why.dNet)} on ${cmpLabel}. Noted: “${notes[iso].text}”`, icon: 'TrendingUp', good: true } : { text: `A strong ${day.dow}, ${signed$(why.dNet)} on ${cmpLabel}. Note what was different so you can repeat it.`, act: 'note', btn: 'Add a note', icon: 'TrendingUp', good: true };
}

function Bridge({ why }) {
  if (why.coversEffect == null || why.checkEffect == null) return null;
  const max = Math.max(1, Math.abs(why.coversEffect), Math.abs(why.checkEffect));
  const bar = (v) => ({ left: v >= 0 ? '50%' : `${50 - (Math.abs(v) / max) * 50}%`, width: `${(Math.abs(v) / max) * 50}%`, background: v >= 0 ? 'var(--money-up)' : 'var(--money-down)' });
  return (
    <div className={s.bridge} role="img" aria-label={`Covers account for ${signed$(why.coversEffect)} and average check for ${signed$(why.checkEffect)}`}>
      <span className="cv-xs cv-faint">More/fewer guests</span><span className={s.bridgeTrack}><span className={s.bridgeFill} style={bar(why.coversEffect)} /></span><span className="cv-num cv-xs" style={{ textAlign: 'right' }}>{signed$(why.coversEffect)}</span>
      <span className="cv-xs cv-faint">Spend per guest</span><span className={s.bridgeTrack}><span className={s.bridgeFill} style={bar(why.checkEffect)} /></span><span className="cv-num cv-xs" style={{ textAlign: 'right' }}>{signed$(why.checkEffect)}</span>
    </div>
  );
}

/* ------------------------------------------------------------ load exports */
function LoadExports({ data, onDone, onCancel }) {
  const [over, setOver] = React.useState(false);
  const [read, setRead] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const ref = React.useRef(null);
  const onFiles = async (list) => {
    if (!list?.length) return;
    setBusy('read'); setErr(null); setRead(null);
    try { setRead(await readDailyFiles(list)); } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('save'); setErr(null);
    try { onDone(await data.upload(read.days, (done, total) => setBusy(`save ${done}/${total}`))); } catch (e) { setErr(e.message); setBusy(null); }
  };
  const partial = read?.ok ? read.days.filter((d) => !d.complete).length : 0;
  return (
    <section className="cv-card" aria-labelledby="daily-load">
      <div className="cv-card-head">
        <span className="cv-h4" id="daily-load">Load your Toast exports</span>
        <button className="iconbtn" onClick={onCancel} aria-label="Close"><Icon name="X" size={18} /></button>
      </div>
      {!read?.ok && (
        <div role="button" tabIndex={0} aria-label="Drop Toast export files here, or press Enter to choose them" className={`${s.drop} ${over ? s.over : ''}`}
          onClick={() => ref.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ref.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}>
          <Icon name="Upload" size={22} />
          <span className="cv-h4">{busy === 'read' ? 'Reading…' : 'Drop the files here, or click to choose'}</span>
          <span className="cv-xs cv-faint">OrderDetails.csv, plus ItemSelectionDetails, TimeEntries and PaymentDetails if you have them (CSV, .xlsx or a zip)</span>
          <input ref={ref} type="file" multiple accept=".csv,.tsv,.txt,.xlsx,.zip" onChange={(e) => onFiles(e.target.files)} style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
        </div>
      )}
      <Fold label="Where to find these in Toast">
        <span className="cv-small cv-muted">In Toast Web, Reports → Data exports, download the files for the days you want, or the whole zip. Coversight reads them in this browser and keeps one summary and the checks for each business day. Days your Toast sync already holds are never replaced.</span>
      </Fold>
      {read && !read.ok && <Callout tone="warn" icon="TriangleAlert">{read.error}</Callout>}
      {read?.ok && (
        <div className="cv-col" style={{ gap: 10 }}>
          <Callout icon="CircleCheck"><span><b>{read.days.length} days</b>, {dayName(read.first)} to {dayName(read.last)}.{!read.kinds.includes('time') ? ' No labour without TimeEntries.' : ''}{!read.kinds.includes('items') ? ' No dishes without ItemSelectionDetails.' : ''}{partial ? ` ${partial} still trading: shown as partial.` : ''}{read.unknown.length ? ` Not read: ${read.unknown.join(', ')}.` : ''}</span></Callout>
          <div className="cv-row" style={{ gap: 8 }}>
            <Button icon="Check" disabled={!!busy} onClick={save}>{busy?.startsWith('save') ? `Saving… ${busy.slice(5)}` : `Save ${read.days.length} days`}</Button>
            <Button variant="secondary" disabled={!!busy} onClick={() => setRead(null)}>Choose other files</Button>
          </div>
        </div>
      )}
      {err && <Callout tone="warn" icon="TriangleAlert">Not saved: {err}. Nothing was lost; try again.</Callout>}
    </section>
  );
}

/* ------------------------------------------------------------ month calendar */
function MonthCalendar({ view, month, setMonth, monthKeys, notes, pick, picked }) {
  const byIso = React.useMemo(() => new Map(view.days.map((d) => [d.iso, d])), [view.days]);
  const cells = calendar(month);
  const inMonth = view.days.filter((d) => d.iso.startsWith(month));
  const max = Math.max(1, ...inMonth.map((d) => d.net));
  const i = monthKeys.indexOf(month);
  return (
    <section className="cv-card">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 2 }}>
          <span className="cv-over">Calendar</span>
          <span className={s.take}>{monthName(month, { month: 'long', year: 'numeric' })}: {$(inMonth.reduce((a, d) => a + d.net, 0))}</span>
        </div>
        <div className="cv-row nowrap" style={{ gap: 2 }}>
          <button className="iconbtn" disabled={i <= 0} onClick={() => setMonth(monthKeys[i - 1])} aria-label="Previous month"><Icon name="ChevronLeft" size={18} /></button>
          <select className="input" style={{ width: 'auto', height: 32 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            {[...monthKeys].reverse().map((k) => <option key={k} value={k}>{monthName(k)}</option>)}
          </select>
          <button className="iconbtn" disabled={i >= monthKeys.length - 1} onClick={() => setMonth(monthKeys[i + 1])} aria-label="Next month"><Icon name="ChevronRight" size={18} /></button>
        </div>
      </div>
      <div className={s.calHead} aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}</div>
      <div className={s.cal} role="grid" aria-label={`Days in ${monthName(month, { month: 'long', year: 'numeric' })}`}>
        {cells.map((iso, k) => {
          if (!iso) return <span key={`b${k}`} className={`${s.cell} ${s.blank}`} aria-hidden="true" />;
          const d = byIso.get(iso);
          const dn = +iso.slice(8);
          if (!d) return <span key={iso} className={`${s.cell} ${s.empty}`} role="gridcell" aria-label={`${dayName(iso)}: no data held`}><span className={s.cellDate}>{dn}</span><span className="cv-xs">no data</span></span>;
          const base = weekdayBaseline(view.days, iso, 8, byIso);
          const dv = base ? change(d.net, base.net) : null;
          return (
            <button key={iso} type="button" role="gridcell" className={`${s.cell} ${picked === iso ? s.on : ''}`} onClick={() => pick(iso)} aria-pressed={picked === iso}
              aria-label={`${dayName(iso)}: ${$(d.net)} net sales, ${d.covers} covers${dv != null ? `, ${dv >= 0 ? 'up' : 'down'} ${Math.abs(dv * 100).toFixed(0)}% on a usual ${d.dow}` : ''}${d.complete === false ? ', partial day' : ''}${notes[iso] ? `. Note: ${notes[iso].text}` : ''}`}>
              <span className={s.cellBar} style={{ height: `${(d.net / max) * 100}%` }} aria-hidden="true" />
              <span className={s.cellDate}>{dn}{notes[iso] && <span className={s.noteDot} title={notes[iso].text}><Icon name="StickyNote" size={12} /></span>}</span>
              <span className={s.cellNet}>{d.net ? compact(d.net) : 'Closed'}{d.complete === false ? '*' : ''}</span>
              {dv != null && d.net > 0 && <span className={`${s.cellDelta} ${dv >= 0 ? 'cv-up' : 'cv-down'}`}>{dv >= 0 ? '+' : '−'}{Math.abs(dv * 100).toFixed(0)}%</span>}
            </button>
          );
        })}
      </div>
      <span className="cv-xs cv-faint">Each day vs its weekday’s 8-week average.{inMonth.some((d) => d.complete === false) ? ' * partial day.' : ''}</span>
    </section>
  );
}

/* ------------------------------------------------------------ weekday × hour */
function HeatCard({ view }) {
  const opts = HEAT.filter(([, , need]) => !need || view.has[need]);
  const [field, setField] = React.useState('covers');
  const f = opts.some(([k]) => k === field) ? field : 'covers';
  const g = heatGrid(view.hours, f);
  const vals = g.rows.flatMap((r) => r.cells.map((c) => c.v ?? 0));
  const max = Math.max(...vals, 0) || 1;
  const fmt = f === 'sales' || f === 'splh' ? (v) => compact(v) : f === 'seatUse' ? (v) => `${Math.round(v)}%` : f === 'covers' ? (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) : (v) => v.toFixed(1);
  const hr = (h) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
  let top = null;
  for (const r of g.rows) for (const c of r.cells) if (c.v != null && (!top || c.v > top.v)) top = { ...c, dow: r.dow };
  return (
    <section className="cv-card">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 2 }}>
          <span className="cv-over">Busiest times</span>
          <span className={s.take}>{top ? `${top.dow} ${hr(top.hour)}` : '—'}</span>
        </div>
        {opts.length > 1 && <select className="input" style={{ width: 'auto', height: 32 }} value={f} onChange={(e) => setField(e.target.value)} aria-label="Heat map measure">{opts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
      </div>
      {g.hours.length ? (
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label={`Weekday by hour, ${opts.find(([k]) => k === f)?.[1]}`}>
          <table className={`cv-table ${s.heat}`} style={{ fontSize: 'var(--text-xs)' }}>
            <thead><tr><th scope="col" aria-label="Weekday" />{g.hours.map((h) => <th key={h} scope="col" className="r">{hr(h)}</th>)}</tr></thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.dow}>
                  <th scope="row" style={{ fontWeight: 600, textAlign: 'left' }}>{r.dow}</th>
                  {r.cells.map((c) => {
                    const t = (c.v ?? 0) / max;
                    return <td key={c.hour} className="r cv-num" title={`${r.dow} ${hr(c.hour)}: ${c.v == null ? 'not measured' : fmt(c.v)}`} style={{ background: c.v ? `color-mix(in srgb, var(--accent) ${Math.round(t * 70)}%, transparent)` : undefined, color: t > 0.6 ? 'var(--fg-on-accent)' : c.v == null ? 'var(--fg-3)' : undefined }}>{c.v == null ? '·' : fmt(c.v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <span className="cv-small cv-muted">No hourly rows in this data yet.</span>}
      <span className="cv-xs cv-faint">Average per hour, last 13 weeks. “·” = not measured (not zero).{view.own ? '' : ' Sample.'}</span>
    </section>
  );
}

/* ------------------------------------------------------------ months */
function MonthBars({ list, calMonth, setMonth, byMonth, has }) {
  const [at, setAt] = React.useState(null);
  const rows = list.slice(-24);
  const per = (x) => x.net / x.days;
  const max = Math.max(1, ...rows.map(per));
  const cur = byMonth.get(at ?? calMonth) ?? rows.at(-1);
  const ly = cur ? byMonth.get(`${+cur.month.slice(0, 4) - 1}${cur.month.slice(4)}`) : null;
  const pm = cur ? byMonth.get(addDays(`${cur.month}-01`, -1).slice(0, 7)) : null;
  const okLy = ly && ly.days >= 20 && cur.days >= 7 ? ly : null, okPm = pm && pm.days >= 7 && cur.days >= 7 ? pm : null;
  return (
    <section className="cv-card">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 2 }}>
          <span className="cv-over">Month by month · net sales per day open</span>
          {cur && <span className={s.take}>{monthName(cur.month)}: {$(per(cur))} a day{!cur.complete ? ' (so far)' : ''}</span>}
        </div>
        {cur && <span className="cv-row" style={{ gap: 10 }}><span className="cv-xs cv-faint">vs previous month</span><Delta v={okPm ? change(per(cur), per(okPm)) : null} /><span className="cv-xs cv-faint">vs a year earlier</span><Delta v={okLy ? change(per(cur), per(okLy)) : null} /></span>}
      </div>
      <div className={s.monthBars} onMouseLeave={() => setAt(null)}>
        {rows.map((x) => (
          <button key={x.month} type="button" className={`${s.monthCol} ${x.month === calMonth ? s.on : ''}`} onMouseEnter={() => setAt(x.month)} onFocus={() => setAt(x.month)} onClick={() => setMonth(x.month)}
            aria-label={`${monthName(x.month)}: ${$(per(x))} a day over ${x.days} days held${x.complete ? '' : ', partial month'}`} aria-pressed={x.month === calMonth}>
            <span className={`${s.monthBar} ${x.complete ? '' : s.part}`} style={{ height: `${(per(x) / max) * 100}%` }} />
            <span className={s.monthLbl}>{monthName(x.month, { month: 'narrow' })}</span>
          </button>
        ))}
      </div>
      <span className="cv-xs cv-faint">Per day held, so a partial month (striped) isn’t penalised. Tap a month to open it in the calendar.</span>
      <Fold label="See the month table">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Months">
          <table className="cv-table">
            <thead><tr><th>Month</th><th className="r">Days held</th><th className="r">Net sales</th><th className="r">Covers</th><th className="r">Avg check</th>{has.food && <th className="r">Food</th>}{has.labour && <th className="r">Labour</th>}<th className="r">Discounts</th>{has.earned && <th className="r">After food &amp; labour</th>}</tr></thead>
            <tbody>
              {[...list].slice(-13).reverse().map((x) => (
                <tr key={x.month}>
                  <td style={{ whiteSpace: 'nowrap' }}>{monthName(x.month)}{!x.complete && <span className="cv-xs cv-faint"> · partial</span>}</td>
                  <td className="r cv-num">{x.days} of {x.inMonth}</td><td className="r cv-num">{$(x.net)}</td><td className="r cv-num">{n0(x.covers)}</td>
                  <td className="r cv-num">{x.covers ? cvMoney(x.net / x.covers, { cents: true }) : '—'}</td>
                  {has.food && <td className="r cv-num">{x.food != null && x.net ? `${((x.food / x.net) * 100).toFixed(1)}%` : '—'}</td>}
                  {has.labour && <td className="r cv-num">{x.labour != null && x.net ? `${((x.labour / x.net) * 100).toFixed(1)}%` : '—'}</td>}
                  <td className="r cv-num">{$(x.discounts)}</td>
                  {has.earned && <td className="r cv-num">{x.earned != null ? $(x.earned) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="cv-xs cv-faint">Rates are totals divided by totals, never averages of daily rates. A rate is “—” unless every day held carries it.</span>
      </Fold>
    </section>
  );
}

/* ------------------------------------------------------------ the page */
function CvDaily() {
  const eng = useEngine();
  const cv = useCv();
  const data = useDailyData(eng.room, eng.mode);
  const sample = React.useMemo(() => fromSample(densify(CV_D.room), CV_D.room.channels), [CV_D.room]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = data.view ?? (data.status === 'ready' ? sample : null);
  const [parts, setParts] = useSaved('daily.dayparts', DEFAULT_DAYPARTS);
  const [sel, setSel] = React.useState(null);
  const [method, setMethod] = React.useState('recent');
  const [range, setRange] = React.useState('90');
  const [custom, setCustom] = React.useState({ from: '', to: '' });
  const [metric, setMetric] = React.useState('net');
  const [month, setMonth] = React.useState(null);
  const [hour, setHour] = React.useState(null);
  const [checksOpen, setChecksOpen] = React.useState(false);
  const [detail, setDetail] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const top = React.useRef(null);

  // The selected day lives in the address (#2026-10-24), so a reload or a link back keeps it.
  React.useEffect(() => {
    const h = window.location.hash.slice(1);
    if (ISO.test(h)) setSel(h);
  }, []);
  React.useEffect(() => { setMonth(null); setHour(null); setMsg(null); }, [eng.room, view?.own]);
  const days = React.useMemo(() => view?.days ?? [], [view]);
  const byIso = React.useMemo(() => new Map(days.map((d) => [d.iso, d])), [days]);
  const latest = days.at(-1)?.iso ?? null;
  const iso = sel && byIso.has(sel) ? sel : latest;
  React.useEffect(() => {
    if (!iso) return;
    try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${iso}`); } catch { /* ignore */ }
  }, [iso]);
  const loadDay = data.loadDay;
  const own = !!view?.own;
  const lastHeld = data.provenance?.last;
  React.useEffect(() => {
    setHour(null); setChecksOpen(false);
    if (!iso || !own) { setDetail(null); return undefined; }
    let live = true;
    setDetail(null);
    loadDay(iso).then((d) => { if (live) setDetail(d); }).catch((e) => { if (live) setDetail({ error: e.message }); });
    return () => { live = false; };
  }, [iso, own, loadDay, lastHeld]);

  const head = () => <PageHead over={`Daily detail · ${CV_ROOM.name}`} q="What happened on this day?" right={<Button variant="secondary" icon="Upload" onClick={() => setLoading(true)}>Load Toast exports</Button>} />;

  if (!view) {
    if (data.status === 'loading' || data.status === 'error') {
      return (
        <div className="cv-page wide">
          {head()}
          {data.status === 'error' ? <Callout tone="warn" icon="TriangleAlert"><span>Couldn’t load this room’s days: {data.error} <button className="cv-link" onClick={data.reload}>Try again</button></span></Callout> : <span className="cv-small cv-muted" role="status">Loading this room’s days…</span>}
        </div>
      );
    }
    return (
      <div className="cv-page wide">
        {head()}
        {loading ? <LoadExports data={data} onCancel={() => setLoading(false)} onDone={(r) => { setLoading(false); setMsg(r); }} /> : (
          <div className="cv-empty">
            <span className="ico"><Icon name="CalendarDays" size={22} /></span>
            <span className="cv-h4">No days for {CV_ROOM.name} yet</span>
            <span className="cv-small cv-muted" style={{ maxWidth: '52ch' }}>Connect Toast and the nightly sync fills this page, 13 weeks back the first time. Or load the exports you already have. Coversight never fills in days it wasn’t given.</span>
            <div className="cv-row" style={{ justifyContent: 'center' }}>
              <Button icon="Plug" onClick={() => cv.go('connect')}>Connect Toast</Button>
              <Button variant="secondary" icon="Upload" onClick={() => setLoading(true)}>Load Toast exports</Button>
            </div>
          </div>
        )}
        {msg?.error && <Callout tone="warn" icon="TriangleAlert">Not done: {msg.error}</Callout>}
      </div>
    );
  }

  const day = byIso.get(iso);
  const notes = data.notes || {};
  const has = view.has;
  const prov = data.provenance;
  const sampleView = !own;
  const di = days.findIndex((d) => d.iso === iso);
  const go = (next, scroll = false) => { setSel(next); setMonth(next.slice(0, 7)); if (scroll) top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const base = compareDay(days, iso, method);
  const cmp = COMPARISONS[method];
  const cmpLabel = cmp.short(day.dow);
  const why = explainDay(day, base, { parts, label: cmpLabel });
  const baseNotes = base ? base.isos.filter((x) => notes[x]) : [];
  const weeks = Array.from({ length: 8 }, (_, i) => byIso.get(addDays(iso, -7 * (7 - i))) ?? null);
  const spark = (f) => weeks.map((d) => (d ? f(d) : null));

  // Contribution after the costs this data knows. Never called profit; a missing cost is never zero.
  const contrib = has.food && day.earned != null
    ? { label: 'After food and labour', get: (d) => d.earned, sub: 'not profit', metric: 'earned' }
    : day.labour != null ? { label: 'After labour', get: (d) => (d.labour != null ? d.net - d.labour : null), sub: 'food cost isn’t in Toast; not profit', metric: 'labour' }
      : { label: 'After known costs', get: () => null, sub: 'needs labour (TimeEntries)', metric: null };
  const contribV = contrib.get(day), contribB = base ? (contrib.metric === 'earned' ? base.earned : base.labour != null ? base.net - base.labour : null) : null;
  // The biggest other deviation against the comparison.
  const lp = (d) => ratio(d.labour, d.net);
  const devs = base ? [
    { k: 'Covers', d: change(day.covers, base.covers), show: `${n0(day.covers)} vs ${n0(base.covers)}`, metric: 'covers', get: (d) => d.covers },
    { k: 'Average check', d: change(day.check, base.check), show: `${$c(day.check)} vs ${$c(base.check)}`, metric: 'check', get: (d) => d.check },
    ...(day.labour != null && base.labour != null && lp(day) != null && lp(base) != null ? [{ k: 'Labour %', d: lp(day) - lp(base), pts: true, invert: true, show: `${(lp(day) * 100).toFixed(1)}% vs ${(lp(base) * 100).toFixed(1)}%`, metric: 'labour', get: (d) => (lp(d) == null ? null : lp(d) * 100) }] : []),
    ...(Math.abs(day.discounts - (base.discounts ?? 0)) > 50 ? [{ k: 'Discounts', d: change(day.discounts, base.discounts), invert: true, show: `${$(day.discounts)} vs ${$(base.discounts)}`, get: (d) => d.discounts }] : []),
    ...(day.voids != null && base.voids != null && Math.abs(day.voids - base.voids) > 50 ? [{ k: 'Voids after send', d: change(day.voids, base.voids), invert: true, show: `${$(day.voids)} vs ${$(base.voids)}`, get: (d) => d.voids }] : []),
  ].filter((x) => x.d != null).sort((a, b) => Math.abs(b.pts ? b.d * 4 : b.d) - Math.abs(a.pts ? a.d * 4 : a.d)) : [];
  const dev = devs[0];
  const step = nextStep({ day, base, why, dev, own, notes, iso, cmpLabel });

  const chart = (m) => { setMetric(m); setTimeout(() => document.getElementById('daily-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); };
  const doStep = (act) => {
    const scroll = (id) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    if (act === 'note') { document.getElementById('daily-note')?.focus(); scroll('daily-note'); }
    if (act === 'hours') scroll('daily-hours');
    if (act === 'checks') { setChecksOpen(true); scroll('daily-checks'); }
    if (act === 'sold') scroll('daily-sold');
    if (act === 'money') scroll('daily-money');
  };

  // History range.
  const clampFrom = (v) => (v < days[0].iso ? days[0].iso : v);
  const rangeTo = range === 'custom' && ISO.test(custom.to) ? (custom.to > latest ? latest : custom.to) : latest;
  const rangeFrom = range === 'custom' && ISO.test(custom.from) ? clampFrom(custom.from) : clampFrom(addDays(latest, -(+range || 90) + 1));
  const n = Math.max(0, Math.round((Date.parse(rangeTo) - Date.parse(rangeFrom)) / 864e5) + 1);
  const t = rangeTotals(days, n || 1, rangeTo);
  const ranges = RANGES.filter(([v], i) => v === 'custom' || i === 0 || days.length > +RANGES[i - 1][0]);
  const metrics = Object.entries(METRICS).filter(([, x]) => !x.needs || has[x.needs]);
  const mKey = metrics.some(([k]) => k === metric) ? metric : 'net';
  const m = METRICS[mKey];
  const allMonths = months(days);
  const monthKeys = allMonths.map((x) => x.month);
  const calMonth = month && monthKeys.includes(month) ? month : iso.slice(0, 7);
  const byMonth = new Map(allMonths.map((x) => [x.month, x]));
  const groupSample = sampleView && CV_GROUP.rooms.every((r) => densify(r.room));
  const groupMonths = groupSample ? CV_GROUP.rooms.map((r) => ({ id: r.id, name: r.profile.short, months: months(fromSample(densify(r.room), r.room.channels).days) })) : [];
  const groupKeys = [...new Set(groupMonths.flatMap((g) => g.months.map((x) => x.month)))].sort();
  const wk = Math.min(view.weeksHeld, Math.max(1, Math.round(n / 7)));
  const items = view.items.map((it) => {
    const u = it.units.slice(-wk), net = it.net ? it.net.slice(-wk) : null;
    return { ...it, u, U: u.reduce((a, b) => a + b, 0), N: net ? net.reduce((a, b) => a + b, 0) : null };
  }).sort((a, b) => (b.N ?? b.U) - (a.N ?? a.U)).slice(0, 15);
  const tzLabel = prov?.tz ? `${prov.tz} wall clock` : 'restaurant wall clock';
  const status = day.complete === false
    ? <Pill tone="warn" icon="Clock">Partial day</Pill>
    : sampleView ? <Pill icon="FlaskConical">Sample day</Pill> : <Pill tone="good" icon="CircleCheck">Final</Pill>;
  const synced = prov?.lastSyncAt ? new Date(prov.lastSyncAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <div className="cv-page wide" ref={top}>
      {head()}

      <div className={s.source} role="status">
        {own ? <Pill tone="good" icon="Database">Your Toast data</Pill> : <Pill icon="FlaskConical">Sample data</Pill>}
        <span className={s.sourceGrow}>
          {own ? <>Complete through <b>{prov?.dataThrough ? dayName(prov.dataThrough) : '—'}</b>{synced ? ` · synced ${synced}` : ''}{data.pending > 0 ? ` · reading ${data.pending} more day${data.pending === 1 ? '' : 's'}…` : ''}</>
            : <>Not a real restaurant. Your own days replace these once Toast is connected.</>}
        </span>
        {own && <Fold className={s.foldPlain} label="Details">
          <span className="cv-small">{days.length.toLocaleString('en-US')} days held, {dayName(days[0].iso)} to {dayName(latest)}{prov?.synced ? ` · ${prov.synced} from the sync` : ''}{prov?.uploaded ? ` · ${prov.uploaded} from loaded exports` : ''}. Business day 4 am to 4 am, {tzLabel}.</span>
          {prov?.uploaded > 0 && <div><Button size="sm" variant="ghost" icon="Trash2" onClick={async () => { if (window.confirm(`Remove the ${prov.uploaded} days loaded from exports? Synced days stay.`)) { try { await data.removeUploads(); setMsg({ removed: true }); } catch (e) { setMsg({ error: e.message }); } } }}>Remove loaded days</Button></div>}
        </Fold>}
      </div>

      {msg && <Callout tone={msg.error ? 'warn' : ''} icon={msg.error ? 'TriangleAlert' : 'CircleCheck'}>
        {msg.error ? `Not done: ${msg.error}` : msg.removed ? 'Removed the days loaded from exports.' : `Saved ${msg.saved} day${msg.saved === 1 ? '' : 's'}.${msg.keptSynced ? ` Kept ${msg.keptSynced} from the Toast sync.` : ''}${msg.stored === false ? ' This browser couldn’t keep them, so they’re here until you reload.' : ''}`}
      </Callout>}
      {loading && <LoadExports data={data} onCancel={() => setLoading(false)} onDone={(r) => { setLoading(false); setMsg(r); }} />}

      <section className={`cv-card ${s.dateBar}`} aria-label="Choose a day">
        <div className="cv-row nowrap" style={{ gap: 2 }}>
          <button className="iconbtn" disabled={di <= 0} onClick={() => go(days[di - 1].iso)} aria-label="Previous day held"><Icon name="ChevronLeft" size={18} /></button>
          <input type="date" className="input" value={iso} min={days[0].iso} max={latest} onChange={(e) => { const v = e.target.value; if (ISO.test(v)) go(byIso.has(v) ? v : (days.find((d) => d.iso >= v) ?? days.at(-1)).iso); }} aria-label="Business day" />
          <button className="iconbtn" disabled={di >= days.length - 1} onClick={() => go(days[di + 1].iso)} aria-label="Next day held"><Icon name="ChevronRight" size={18} /></button>
        </div>
        <span className="cv-h4">{longDay(iso)}</span>
        {status}
        {iso !== latest && <Button size="sm" variant="ghost" onClick={() => go(latest)}>Latest day</Button>}
        <label className="cv-row nowrap" style={{ gap: 6, marginLeft: 'auto' }}>
          <span className="cv-xs cv-faint">vs</span>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Compare with">
            {Object.entries(COMPARISONS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          </select>
        </label>
      </section>

      <div className="cv-grid g4">
        <Tile label="Net sales" value={$(day.net)} sample={sampleView} delta={<Delta v={change(day.net, base?.net)} />} sub={base ? `vs ${$(base.net)}` : 'nothing to compare'} spark={spark((d) => d.net)} pressed={mKey === 'net'} onClick={() => chart('net')} />
        <Tile label="Guests · checks" value={`${n0(day.covers)} · ${n0(day.orders)}`} sample={sampleView} delta={<Delta v={change(day.covers, base?.covers)} />} sub={day.orders == null ? 'checks aren’t in the sample' : base ? `vs ${n0(base.covers)} guests` : `${day.covers && day.orders ? (day.covers / day.orders).toFixed(1) : '—'} a check`} spark={spark((d) => d.covers)} pressed={mKey === 'covers'} onClick={() => chart('covers')} />
        <Tile label={`Contribution · ${contrib.label.toLowerCase()}`} value={$(contribV)} sample={sampleView} delta={contribV != null ? <Delta v={change(contribV, contribB)} /> : null} sub={contrib.sub} spark={contribV != null ? spark(contrib.get) : null} pressed={contrib.metric != null && mKey === contrib.metric} onClick={contrib.metric && metrics.some(([k]) => k === contrib.metric) ? () => chart(contrib.metric) : undefined} />
        <Tile word label="Moved most" value={dev ? dev.k : '—'} sample={sampleView} delta={dev ? <Delta v={dev.pts ? dev.d * 100 : dev.d} pts={dev.pts} invert={dev.invert} /> : null} sub={dev ? dev.show : 'nothing else moved much'} spark={dev ? spark(dev.get) : null} pressed={!!dev?.metric && mKey === dev.metric} onClick={dev?.metric && metrics.some(([k]) => k === dev.metric) ? () => chart(dev.metric) : undefined} />
      </div>

      <section className={`cv-card ${s.todo}`} aria-labelledby="daily-changed">
        <div className="cv-col" style={{ gap: 12, minWidth: 0 }}>
          <span className="cv-over" id="daily-changed">What changed</span>
          <span className={s.todoHead}>{why ? why.headline : `No ${cmp.label.toLowerCase()} in the data.`}</span>
          {why && !why.flat && <Bridge why={why} />}
          {(base?.partial || baseNotes.length > 0 || day.complete === false) && (
            <div className={s.warnLine}>
              {day.complete === false && <Pill tone="warn" icon="Clock">Day still open</Pill>}
              {base?.partial && <Pill tone="warn" icon="Clock">Comparison has a partial day</Pill>}
              {baseNotes.length > 0 && <Pill tone="warn" icon="StickyNote">Comparison has a noted day</Pill>}
            </div>
          )}
          <Fold label="Why, in detail">
            <ul className={s.whyList}>
              {why && why.partMoves[0] && Math.abs(why.partMoves[0].d) >= 1 && <li>By day part, {why.partMoves[0].name} moved most: {signed$(why.partMoves[0].d)}.</li>}
              {why && why.chanMoves[0] && Math.abs(why.chanMoves[0].d) >= 1 && <li>By channel, {why.chanMoves[0].name} moved most: {signed$(why.chanMoves[0].d)}.</li>}
              {why && why.coversEffect != null && why.checkEffect != null && <li>Guests and spend per guest split the {signed$(why.dNet)} arithmetically. That shows where it came from, not what caused it.</li>}
              {baseNotes.map((x) => <li key={x}>{dayName(x)}, in the comparison, has a note: “{notes[x].text}”</li>)}
              <li>Compared with: {cmp.desc}{base ? ` (${base.isos.map((x) => dayName(x)).join(', ')})` : ''}</li>
            </ul>
          </Fold>
        </div>
        <div className={s.todoAct} style={step.good ? { background: 'color-mix(in srgb, var(--money-up) 10%, var(--surface-sunken))' } : undefined}>
          <span className="cv-over" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name={step.icon} size={14} />What to do</span>
          <span className="cv-small" style={{ fontWeight: 500, lineHeight: 1.45, color: 'var(--fg-1)' }}>{step.text}</span>
          {step.act && <div><Button size="sm" icon="ArrowRight" onClick={() => doStep(step.act)}>{step.btn}</Button></div>}
        </div>
      </section>

      <div id="daily-hours"><Hours day={day} base={base} has={has} hour={hour} onHour={own && detail?.checksKept ? (h) => { setHour(h); if (h != null) { setChecksOpen(true); setTimeout(() => document.getElementById('daily-checks')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); } } : null} /></div>
      {own && <Checks detail={detail} hour={hour} setHour={setHour} open={checksOpen} setOpen={setChecksOpen} />}

      <div className="cv-grid g2">
        <div id="daily-money"><MoneyBreakdown day={day} base={base} has={has} own={own} /></div>
        <DayParts day={day} base={base} parts={parts} setParts={(p) => setParts(p, `Day parts: ${p.map((x) => x.name).join(', ')}`)} canEdit={eng.mode !== 'pending'} />
      </div>
      {own && <div id="daily-sold"><DayItems detail={detail} /></div>}
      <DayNote iso={iso} note={notes[iso]} canNote={eng.mode !== 'pending'} onNote={(d, text) => data.saveNote(d, text, eng.viewer?.name ?? '')} />

      <div className={s.sectionHead} id="daily-history"><span className="cv-h3">Over time</span><span className="cv-small cv-muted">Tap any day to open it above.</span></div>

      <section className="cv-card">
        <div className="cv-card-head">
          <div className="cv-col" style={{ gap: 2 }}>
            <span className="cv-over">{m.label} by day</span>
            <span className={s.take}>{$(t.net)} over {t.days} day{t.days === 1 ? '' : 's'}{t.vs ? <> · <Delta v={t.vs.net} /> <span className="cv-small cv-muted">on a year earlier</span></> : null}</span>
          </div>
          <Tabs value={range} onChange={(v) => { setRange(v); if (v === 'custom' && !custom.from) setCustom({ from: clampFrom(addDays(latest, -27)), to: latest }); }} tabs={ranges.map(([value, label]) => ({ value, label }))} />
        </div>
        <Tabs value={mKey} onChange={setMetric} tabs={metrics.map(([value, x]) => ({ value, label: x.label }))} />
        {range === 'custom' && (
          <div className="cv-row" style={{ gap: 8 }}>
            <label className="cv-row nowrap" style={{ gap: 6 }}><span className="cv-xs cv-faint">From</span><input type="date" className="input" style={{ width: 'auto', height: 34 }} min={days[0].iso} max={latest} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
            <label className="cv-row nowrap" style={{ gap: 6 }}><span className="cv-xs cv-faint">To</span><input type="date" className="input" style={{ width: 'auto', height: 34 }} min={days[0].iso} max={latest} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
          </div>
        )}
        {n > 1 ? <DayChart days={days} metric={m} from={rangeFrom} to={rangeTo} notes={notes} selected={iso} onOpen={(x) => go(x, true)} /> : <span className="cv-small cv-muted">Choose a range of at least two days.</span>}
        <div className="cv-row" style={{ justifyContent: 'space-between' }}>
          <div className="cv-legend">
            <span><i className="line" style={{ background: 'var(--cat-1)' }} />7-day average</span>
            <span><i className="line" style={{ background: 'var(--cat-1)', opacity: 0.45 }} />each day</span>
            {days.some((d) => d.iso <= lastYear(rangeTo)) && <span><i className="line" style={{ background: 'none', borderTop: '2px dashed var(--border-strong)', height: 0 }} />a year earlier</span>}
            <span><i className="line" style={{ background: 'var(--accent)' }} />day shown above</span>
            {Object.keys(notes).length > 0 && <span><i style={{ background: 'var(--warning-500)', borderRadius: '50%' }} />note</span>}
          </div>
          <Button size="sm" variant="secondary" icon="Download" onClick={() => download(`${CV_D.id}-daily-${rangeFrom}-to-${rangeTo}.csv`, daysCsv(view, { room: CV_ROOM.name, from: rangeFrom, to: rangeTo, tz: tzLabel }))}>CSV</Button>
        </div>
        {t.missing > 0 && <span className="cv-xs cv-faint">{t.missing} day{t.missing === 1 ? '' : 's'} in this range not held: left as gaps, never counted as zero.{t.vs && t.vs.days < t.days ? ` The year-earlier change uses the ${t.vs.days} days held in both years.` : ''}</span>}
      </section>

      <div className="cv-grid g2">
        <MonthCalendar view={view} month={calMonth} setMonth={setMonth} monthKeys={monthKeys} notes={notes} pick={(x) => go(x, true)} picked={iso} />
        <HeatCard view={view} />
      </div>

      <MonthBars list={allMonths} calMonth={calMonth} setMonth={setMonth} byMonth={byMonth} has={has} />

      {has.dishes && items.length > 0 && (
        <section className="cv-card">
          <div className="cv-card-head">
            <div className="cv-col" style={{ gap: 2 }}>
              <span className="cv-over">Dishes, last {wk} week{wk === 1 ? '' : 's'}</span>
              <span className={s.take}>Top: {items[0].name}</span>
            </div>
          </div>
          <div className="cv-col" style={{ gap: 10 }}>
            {items.slice(0, 6).map((it) => {
              const v = it.N ?? it.U, max = items[0].N ?? items[0].U;
              return (
                <div key={it.key} className="cv-hbar" style={{ gridTemplateColumns: 'minmax(0, 160px) minmax(0, 1fr) 90px 130px' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.name}>{it.name}</span>
                  <span className="bar"><span style={{ width: `${(v / (max || 1)) * 100}%`, background: 'var(--cat-2)' }} /></span>
                  <WeekSpark vals={it.u} />
                  <span className="cv-num" style={{ textAlign: 'right' }}>{has.itemSales ? $(it.N) : `${n0(it.U)} units`}</span>
                </div>
              );
            })}
          </div>
          <Fold label="See the dish table">
            <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Dishes by week">
              <table className="cv-table">
                <thead><tr><th>Dish</th><th className="r">Units</th>{has.itemSales && <th className="r">Net sales</th>}{has.itemSales && <th className="r">Price paid</th>}</tr></thead>
                <tbody>{items.map((it) => <tr key={it.key}><td>{it.name}{it.cat ? <span className="cv-xs cv-faint"> · {it.cat}</span> : null}</td><td className="r cv-num">{n0(it.U)}</td>{has.itemSales && <td className="r cv-num">{$(it.N)}</td>}{has.itemSales && <td className="r cv-num">{it.U ? cvMoney(it.N / it.U, { cents: true }) : '—'}</td>}</tr>)}</tbody>
              </table>
            </div>
            <span className="cv-xs cv-faint">{has.itemSales ? 'At the prices guests paid then.' : 'Sample: units only.'} Weeks end on {dayName(latest)}.</span>
          </Fold>
        </section>
      )}

      {groupSample && (
        <section className="cv-card">
          <Fold className={s.foldPlain} label={<span className="cv-row nowrap" style={{ gap: 8 }}><span className="cv-h4">Every sample room, month by month</span><Pill icon="FlaskConical">Sample</Pill></span>}>
            <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Rooms by month" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="cv-table">
                <thead><tr><th>Month</th>{groupMonths.map((g) => <th key={g.id} className="r">{g.name}</th>)}<th className="r">Group</th></tr></thead>
                <tbody>
                  {[...groupKeys].reverse().map((k) => {
                    const vals = groupMonths.map((g) => g.months.find((x) => x.month === k)?.net ?? null);
                    return <tr key={k}><td>{monthName(k)}</td>{vals.map((v, i) => <td key={i} className="r cv-num">{v != null ? $(v) : '—'}</td>)}<td className="r cv-num" style={{ fontWeight: 600 }}>{vals.every((v) => v != null) ? $(vals.reduce((a, b) => a + b, 0)) : '—'}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </Fold>
        </section>
      )}

      <Fold label="How these numbers are worked out">
        <span className="cv-small cv-muted">{own
          ? `Net sales are the amount on orders that weren’t voided, after discounts and before tax and tips: the figure Trends adds up by week. A business day runs 4 am to 4 am on the ${tzLabel}, so a 1 am tab belongs to the night before. Days the data doesn’t hold are left out, never counted as zero; a figure the files don’t carry shows as “—”. Contribution is net sales less the costs the data holds; it is not profit.`
          : `Sample group: each sample day and hour is split from its week's totals and adds back to it exactly. The year before the sample's 52 weeks is generated for comparison and assumes ${((view.priorGrowth ?? 0) * 100).toFixed(1)}% growth at this room. Contribution is not profit.`}</span>
      </Fold>
    </div>
  );
}

function WeekSpark({ vals }) {
  if (vals.length < 2) return <span />;
  const w = 90, h = 20, lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1;
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 2 - ((v - lo) / sp) * (h - 4)}`).join(' ')} fill="none" stroke="var(--cat-2)" strokeWidth="1.25" /></svg>;
}

export { CvDaily };
