'use client';

import * as React from 'react';

import { Button, Icon, Tabs } from '../kit';
import { CV_D, CV_GROUP, CV_ROOM, Callout, Claim, PageHead, cvMoney, cvScale } from './core';
import { byMonth, densify, heat, pointCount, HOURS } from '../../lib/data/dense';

/* Daily detail: every day, hour and dish behind the weekly figures. On the
 * sample, days and hours are split from each week's totals and add back
 * exactly; a room on its own data shows only what its export holds. */

const METRICS = {
  net: { label: 'Sales', fmt: (v) => cvMoney(Math.round(v)), get: (d) => d.net },
  covers: { label: 'Covers', fmt: (v) => Math.round(v).toLocaleString('en-US'), get: (d) => d.covers },
  earned: { label: 'Earned', fmt: (v) => cvMoney(Math.round(v)), get: (d) => d.earned },
  labour: { label: 'Labour %', fmt: (v) => `${v.toFixed(1)}%`, get: (d) => (d.net ? (d.labour / d.net) * 100 : 0) },
};
const RANGES = { '90': 90, '365': 364, '728': 728 };
const pct = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.abs(((a - b) / b) * 100).toFixed(1)}%` : '—');
const monthName = (k) => new Date(`${k}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function DayChart({ days, prior, metric }) {
  const W = 1000, H = 220, P = { l: 60, r: 12, t: 12, b: 28 };
  const m = METRICS[metric];
  const vals = days.map(m.get), pv = prior.map((d) => (d ? m.get(d) : null));
  const all = [...vals, ...pv.filter((v) => v != null)];
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const x = cvScale(0, days.length - 1, P.l, W - P.r), y = cvScale(lo, hi, H - P.b, P.t);
  // 7-day rolling mean so weekday swings don't hide the trend.
  const roll = vals.map((_, i) => { const s = vals.slice(Math.max(0, i - 6), i + 1); return s.reduce((a, b) => a + b, 0) / s.length; });
  const path = (arr) => arr.map((v, i) => (v == null ? '' : `${i && arr[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(' ');
  const every = Math.ceil(days.length / 8);
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${m.label} by day, ${days.length} days, with the same days last year`}>
      {[lo + pad, (lo + hi) / 2, hi - pad].map((v, i) => <g key={i}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 3} textAnchor="end">{m.fmt(v)}</text></g>)}
      <path d={path(pv)} fill="none" stroke="var(--border-strong)" strokeWidth="1.25" strokeDasharray="3 3" />
      <path d={path(vals)} fill="none" stroke="var(--cat-1)" strokeWidth="1" opacity="0.45" />
      <path d={path(roll)} fill="none" stroke="var(--cat-1)" strokeWidth="2.25" />
      {days.map((d, i) => (i % every === 0 || i === days.length - 1) && <text key={d.iso} x={x(i)} y={H - 8} textAnchor="middle">{d.iso.slice(5)}</text>)}
    </svg>
  );
}

function Heat({ grid, field }) {
  const vals = grid.flatMap((r) => r.cells.map((c) => c[field]));
  const max = Math.max(...vals) || 1;
  const fmt = field === 'covers' ? (v) => Math.round(v) : field === 'seatUse' ? (v) => `${Math.round(v)}%` : (v) => v.toFixed(1);
  return (
    <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Weekday by hour grid">
      <table className="cv-table" style={{ fontSize: 'var(--text-xs)' }}>
        <thead><tr><th />{HOURS.map((h) => <th key={h} className="r">{h > 12 ? `${h - 12}p` : `${h}${h === 12 ? 'p' : 'a'}`}</th>)}</tr></thead>
        <tbody>
          {grid.map((r) => (
            <tr key={r.dow}>
              <td style={{ fontWeight: 600 }}>{r.dow}</td>
              {r.cells.map((c) => {
                const t = c[field] / max;
                return <td key={c.hour} className="r cv-num" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(t * 70)}%, transparent)`, color: t > 0.6 ? 'var(--accent-fg, #fff)' : undefined }}>{fmt(c[field])}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spark({ vals }) {
  const w = 160, h = 24, lo = Math.min(...vals), hi = Math.max(...vals), s = hi - lo || 1;
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 2 - ((v - lo) / s) * (h - 4)}`).join(' ')} fill="none" stroke="var(--cat-2)" strokeWidth="1.25" /></svg>;
}

function downloadCsv(name, rows) {
  const cols = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object');
  const chKeys = rows[0].channels ? Object.keys(rows[0].channels) : [];
  const lines = [[...cols, ...chKeys.map((k) => `channel_${k}`)].join(',')];
  for (const r of rows) lines.push([...cols.map((c) => r[c]), ...chKeys.map((k) => r.channels[k])].join(','));
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CvDaily() {
  const dense = densify(CV_D.room);
  const [range, setRange] = React.useState('365');
  const [metric, setMetric] = React.useState('net');
  const [field, setField] = React.useState('covers');
  const [month, setMonth] = React.useState(null);

  if (!dense) {
    return (
      <div className="cv-page">
        <PageHead over={`Daily detail · ${CV_ROOM.name}`} q="What happened each day and each hour?" />
        <Callout icon="Info">This room runs on its own Toast data{CV_D.room.fromToast ? `, ${CV_D.room.fromToast.weeks} weeks to ${CV_D.room.fromToast.end}` : ''}. Coversight shows the weeks your export covers on Trends and never fills in days or hours it wasn't given. Load the export’s daily files to see them here.</Callout>
      </div>
    );
  }

  const n = RANGES[range];
  const days = dense.days.slice(-n);
  const byIso = new Map(dense.days.map((d) => [d.iso, d]));
  const shift = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) - 364 * 864e5).toISOString().slice(0, 10);
  const prior = days.map((d) => byIso.get(shift(d.iso)) ?? null);
  const months = byMonth(dense.days);
  const monthsThisYear = months.slice(-13);
  const priorMonth = (k) => months.find((m) => m.month === `${+k.slice(0, 4) - 1}${k.slice(4)}`);
  const pick = month ?? dense.days.at(-1).iso.slice(0, 7);
  const log = dense.days.filter((d) => d.iso.startsWith(pick));
  const total = CV_GROUP.rooms.reduce((s, d) => s + pointCount(densify(d.room)), 0);
  const groupMonths = CV_GROUP.rooms.map((d) => ({ id: d.id, name: d.profile.short, months: densify(d.room) ? byMonth(densify(d.room).days) : [] }));
  const allMonthKeys = [...new Set(groupMonths.flatMap((g) => g.months.map((m) => m.month)))].sort();
  const top = [...dense.items].sort((a, b) => b.units.at(-1) * b.price - a.units.at(-1) * a.price).slice(0, 15);
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

  return (
    <div className="cv-page wide">
      <PageHead over={`Daily detail · ${CV_ROOM.name} · ${dense.days.length.toLocaleString('en-US')} days, ${dense.hours.length.toLocaleString('en-US')} hours`}
        q="What happened each day and each hour?"
        sub="Every day and hour behind the weekly figures. On the sample group, each week's days add back exactly to that week's totals, and each day's hours to that day, so nothing here disagrees with Trends."
        right={<Button variant="secondary" icon="Download" onClick={() => downloadCsv(`${CV_D.id}-daily.csv`, dense.days)}>Download all days (CSV)</Button>} />

      <div className="cv-grid g4">
        {[
          ['Data points, this group', total.toLocaleString('en-US'), `${CV_GROUP.rooms.length} rooms · days, hours, dishes`],
          ['Sales, last 364 days', cvMoney(Math.round(sum(dense.days.slice(-364), (d) => d.net))), `${pct(sum(dense.days.slice(-364), (d) => d.net), sum(dense.days.slice(0, 364), (d) => d.net))} on the year before`],
          ['Busiest day', (() => { const b = dense.days.slice(-364).reduce((a, d) => (d.net > a.net ? d : a)); return `${b.dow} ${b.iso.slice(5)}`; })(), cvMoney(Math.round(dense.days.slice(-364).reduce((a, d) => Math.max(a, d.net), 0)))],
          ['Covers, last 364 days', Math.round(sum(dense.days.slice(-364), (d) => d.covers)).toLocaleString('en-US'), `${pct(sum(dense.days.slice(-364), (d) => d.covers), sum(dense.days.slice(0, 364), (d) => d.covers))} on the year before`],
        ].map(([k, v, s]) => (
          <div key={k} className="cv-card" style={{ gap: 6 }}>
            <div className="cv-row" style={{ justifyContent: 'space-between' }}><span className="cv-xs cv-faint">{k}</span><Claim k="obs" /></div>
            <span className="cv-fig md">{v}</span><span className="cv-xs cv-faint">{s}</span>
          </div>
        ))}
      </div>

      <section className="cv-card">
        <div className="cv-card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span className="cv-h4">{METRICS[metric].label} by day</span>
          <div className="cv-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Tabs value={metric} onChange={setMetric} tabs={Object.entries(METRICS).map(([value, m]) => ({ value, label: m.label }))} />
            <Tabs value={range} onChange={setRange} tabs={[{ value: '90', label: '90 days' }, { value: '365', label: '1 year' }, { value: '728', label: '2 years' }]} />
          </div>
        </div>
        <DayChart days={days} prior={prior} metric={metric} />
        <div className="cv-legend"><span><i className="line" style={{ background: 'var(--cat-1)' }} />7-day average</span><span><i className="line" style={{ background: 'var(--cat-1)', opacity: 0.45 }} />each day</span><span><i className="line" style={{ background: 'none', borderTop: '2px dashed var(--border-strong)', height: 0 }} />same weekday last year</span></div>
      </section>

      <div className="cv-grid g2">
        <section className="cv-card flush">
          <div className="cv-card-head" style={{ padding: '14px 18px 0' }}><span className="cv-h4">By month, against the same month last year</span></div>
          <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Months">
            <table className="cv-table">
              <thead><tr><th>Month</th><th className="r">Sales</th><th className="r">vs LY</th><th className="r">Covers</th><th className="r">Check</th><th className="r">Food</th><th className="r">Labour</th><th className="r">Earned</th></tr></thead>
              <tbody>
                {monthsThisYear.map((m) => {
                  const lyM = priorMonth(m.month);
                  const ly = lyM && lyM.days >= 20 && m.days >= 7 ? lyM : null;
                  return (
                    <tr key={m.month} className="cv-tr" style={{ cursor: 'pointer', fontWeight: m.month === pick ? 600 : undefined }} onClick={() => setMonth(m.month)}>
                      <td style={{ whiteSpace: 'nowrap' }}>{monthName(m.month)}{m.days < 28 ? <span className="cv-xs cv-faint"> · {m.days} days</span> : null}</td>
                      <td className="r cv-num">{cvMoney(Math.round(m.net))}</td>
                      <td className={`r cv-num ${!ly ? '' : m.net / m.days >= ly.net / ly.days ? 'cv-up' : 'cv-down'}`}>{ly ? pct(m.net / m.days, ly.net / ly.days) : '—'}</td>
                      <td className="r cv-num">{Math.round(m.covers).toLocaleString('en-US')}</td>
                      <td className="r cv-num">{cvMoney(m.net / m.covers, { cents: true })}</td>
                      <td className="r cv-num">{((m.food / m.net) * 100).toFixed(1)}%</td>
                      <td className="r cv-num">{((m.labour / m.net) * 100).toFixed(1)}%</td>
                      <td className="r cv-num">{cvMoney(Math.round(m.earned))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <span className="cv-xs cv-faint" style={{ padding: '0 18px 14px', display: 'block' }}>"vs LY" compares sales per day, so a short partial month isn't penalised. Click a month to list its days below.</span>
        </section>

        <section className="cv-card">
          <div className="cv-card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
            <span className="cv-h4">Weekday × hour, last 13 weeks</span>
            <Tabs value={field} onChange={setField} tabs={[{ value: 'covers', label: 'Covers' }, { value: 'ticketMin', label: 'Ticket min' }, { value: 'seatUse', label: 'Seats used' }]} />
          </div>
          <Heat grid={heat(dense.hours)} field={field} />
          <span className="cv-xs cv-faint">Average per hour across {dense.hours.length.toLocaleString('en-US')} hourly rows. Darker is busier.</span>
        </section>
      </div>

      <section className="cv-card flush">
        <div className="cv-card-head" style={{ padding: '14px 18px 0', flexWrap: 'wrap', gap: 10 }}>
          <span className="cv-h4">Every day in {monthName(pick)}</span>
          <select className="input" style={{ width: "auto" }} value={pick} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            {months.map((m) => <option key={m.month} value={m.month}>{monthName(m.month)}</option>)}
          </select>
        </div>
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Days">
          <table className="cv-table">
            <thead><tr><th>Date</th><th>Day</th><th className="r">Sales</th><th className="r">Covers</th><th className="r">Check</th><th className="r">Lunch</th><th className="r">Dinner</th>{CV_D.room.channels.filter((c) => c.sales > 0).map((c) => <th key={c.k} className="r">{c.name}</th>)}<th className="r">Food</th><th className="r">Labour</th><th className="r">Voids</th><th className="r">Comps</th><th className="r">Turn</th><th className="r">Ticket</th><th className="r">Earned</th></tr></thead>
            <tbody>
              {log.map((d) => (
                <tr key={d.iso}>
                  <td className="cv-num" style={{ whiteSpace: "nowrap" }}>{d.iso}</td><td>{d.dow}</td>
                  <td className="r cv-num">{cvMoney(Math.round(d.net))}</td><td className="r cv-num">{d.covers}</td><td className="r cv-num">{cvMoney(d.check, { cents: true })}</td>
                  <td className="r cv-num">{cvMoney(Math.round(d.lunch))}</td><td className="r cv-num">{cvMoney(Math.round(d.dinner))}</td>
                  {Object.values(d.channels).map((v, i) => <td key={i} className="r cv-num">{cvMoney(Math.round(v))}</td>)}
                  <td className="r cv-num">{cvMoney(Math.round(d.food))}</td><td className="r cv-num">{cvMoney(Math.round(d.labour))}</td>
                  <td className="r cv-num">{cvMoney(Math.round(d.voids))}</td><td className="r cv-num">{cvMoney(Math.round(d.comps))}</td>
                  <td className="r cv-num">{d.turnMin}m</td><td className="r cv-num">{d.ticketMin}m</td>
                  <td className="r cv-num">{cvMoney(Math.round(d.earned))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="cv-grid g2">
        <section className="cv-card flush">
          <div className="cv-card-head" style={{ padding: '14px 18px 0' }}><span className="cv-h4">Every room, month by month</span></div>
          <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Rooms by month" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="cv-table">
              <thead><tr><th>Month</th>{groupMonths.map((g) => <th key={g.id} className="r">{g.name}</th>)}<th className="r">Group</th></tr></thead>
              <tbody>
                {[...allMonthKeys].reverse().map((k) => {
                  const vals = groupMonths.map((g) => g.months.find((m) => m.month === k)?.net ?? 0);
                  return <tr key={k}><td>{monthName(k)}</td>{vals.map((v, i) => <td key={i} className="r cv-num">{v ? cvMoney(Math.round(v)) : '—'}</td>)}<td className="r cv-num" style={{ fontWeight: 600 }}>{cvMoney(Math.round(vals.reduce((a, b) => a + b, 0)))}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="cv-card flush">
          <div className="cv-card-head" style={{ padding: '14px 18px 0' }}><span className="cv-h4">Top dishes, units a week for 52 weeks</span></div>
          <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Dishes by week">
            <table className="cv-table">
              <thead><tr><th>Dish</th><th>52 weeks</th><th className="r">This week</th><th className="r">Year</th></tr></thead>
              <tbody>
                {top.map((it) => (
                  <tr key={it.key}><td>{it.name}</td><td><Spark vals={it.units} /></td><td className="r cv-num">{it.units.at(-1)}</td><td className="r cv-num">{it.units.reduce((a, b) => a + b, 0).toLocaleString('en-US')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <span className="cv-xs cv-faint"><Icon name="Info" size={12} /> Sample group: the year before the sample's 52 weeks is shown for comparison and assumes {(dense.priorGrowth * 100).toFixed(1)}% growth at this room. Days and hours are split from the weekly totals and always add back exactly.</span>
    </div>
  );
}

export { CvDaily };
