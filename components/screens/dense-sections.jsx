'use client';

import * as React from 'react';

import { CV_D, CV_GROUP, cvMoney } from './core';
import { densify } from '../../lib/data/dense';
import { Bars, DenseCard, FieldTabs, HeatGrid, Spark, byMonth, heat, monthName, money, pct, sameDayLastYear, useDense } from './dense-ui';

/* One block per screen, each built from the sample's daily and hourly rows.
 * Each returns null on a room's own data. */

const n0 = (v) => Math.round(v).toLocaleString('en-US');
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const cls = (a, b, higherIsGood = true) => (!b ? '' : (a >= b) === higherIsGood ? 'cv-up' : 'cv-down');

/** Months this year with the same month last year, when that month is whole. */
function monthsVsLy(dense, count = 13) {
  const months = byMonth(dense.days);
  const find = (k) => months.find((m) => m.month === `${+k.slice(0, 4) - 1}${k.slice(4)}`);
  return months.slice(-count).map((m) => { const ly = find(m.month); return { ...m, ly: ly && ly.days >= 20 && m.days >= 7 ? ly : null }; });
}

const TREND_FIELDS = {
  net: { label: 'Sales', get: (m) => m.net / m.days, fmt: (v) => money(v), up: true },
  covers: { label: 'Covers', get: (m) => m.covers / m.days, fmt: (v) => n0(v), up: true },
  earned: { label: 'Earned', get: (m) => m.earned / m.days, fmt: (v) => money(v), up: true },
  labour: { label: 'Labour %', get: (m) => (m.labour / m.net) * 100, fmt: (v) => `${v.toFixed(1)}%`, up: false },
};

export function DenseTrends() {
  const dense = useDense();
  const [f, setF] = React.useState('net');
  if (!dense) return null;
  const ms = monthsVsLy(dense);
  const m = TREND_FIELDS[f];
  return (
    <DenseCard title={`${m.label} by month, per day, against last year`} sub={`${dense.days.length.toLocaleString('en-US')} days behind this view · the dashed line is the same month last year`}
      right={<FieldTabs value={f} onChange={setF} fields={Object.entries(TREND_FIELDS).map(([k, v]) => [k, v.label])} />}>
      <Bars vals={ms.map(m.get)} labels={ms.map((x) => monthName(x.month))} fmt={m.fmt} compare={ms.map((x) => (x.ly ? m.get(x.ly) : null))} height={150} />
      <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Months against last year">
        <table className="cv-table">
          <thead><tr><th>Month</th><th className="r">{m.label} (per day)</th><th className="r">Last year</th><th className="r">Change</th></tr></thead>
          <tbody>{[...ms].reverse().slice(0, 6).map((x) => (
            <tr key={x.month}><td>{monthName(x.month)}{x.days < 28 ? <span className="cv-xs cv-faint"> · {x.days} days</span> : null}</td><td className="r cv-num">{m.fmt(m.get(x))}</td><td className="r cv-num">{x.ly ? m.fmt(m.get(x.ly)) : '—'}</td><td className={`r cv-num ${x.ly ? cls(m.get(x), m.get(x.ly), m.up) : ''}`}>{x.ly ? pct(m.get(x), m.get(x.ly)) : '—'}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </DenseCard>
  );
}

export function DenseWeek() {
  const dense = useDense();
  if (!dense) return null;
  const days = dense.days.slice(-7);
  const prev = dense.days.slice(-14, -7);
  return (
    <DenseCard title="This week, day by day" sub="Against the same weekday last week and last year">
      <Bars vals={days.map((d) => d.net)} labels={days.map((d) => `${d.dow} ${d.iso.slice(5)}`)} fmt={money} compare={prev.map((d) => d.net)} height={130} />
      <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Days this week">
        <table className="cv-table">
          <thead><tr><th>Day</th><th className="r">Sales</th><th className="r">vs last week</th><th className="r">vs last year</th><th className="r">Covers</th><th className="r">Check</th><th className="r">Labour</th><th className="r">Earned</th></tr></thead>
          <tbody>{days.map((d, i) => { const ly = sameDayLastYear(dense, d.iso); return (
            <tr key={d.iso}><td style={{ whiteSpace: 'nowrap' }}>{d.dow} {d.iso.slice(5)}</td><td className="r cv-num">{money(d.net)}</td>
              <td className={`r cv-num ${cls(d.net, prev[i].net)}`}>{pct(d.net, prev[i].net)}</td>
              <td className={`r cv-num ${ly ? cls(d.net, ly.net) : ''}`}>{ly ? pct(d.net, ly.net) : '—'}</td>
              <td className="r cv-num">{d.covers}</td><td className="r cv-num">{cvMoney(d.check, { cents: true })}</td>
              <td className="r cv-num">{((d.labour / d.net) * 100).toFixed(1)}%</td><td className="r cv-num">{money(d.earned)}</td></tr>
          ); })}</tbody>
          <tfoot><tr style={{ fontWeight: 600 }}><td>Week</td><td className="r cv-num">{money(sum(days, (d) => d.net))}</td><td className={`r cv-num ${cls(sum(days, (d) => d.net), sum(prev, (d) => d.net))}`}>{pct(sum(days, (d) => d.net), sum(prev, (d) => d.net))}</td><td /><td className="r cv-num">{n0(sum(days, (d) => d.covers))}</td><td /><td className="r cv-num">{((sum(days, (d) => d.labour) / sum(days, (d) => d.net)) * 100).toFixed(1)}%</td><td className="r cv-num">{money(sum(days, (d) => d.earned))}</td></tr></tfoot>
        </table>
      </div>
    </DenseCard>
  );
}

export function DenseToday() {
  const dense = useDense();
  if (!dense) return null;
  const day = dense.days.at(-1);
  const wk = dense.days.at(-8);
  const ly = sameDayLastYear(dense, day.iso);
  const hrs = dense.hours.filter((h) => h.iso === day.iso);
  const wkHrs = dense.hours.filter((h) => h.iso === wk.iso);
  const tiles = [
    ['Sales', money(day.net), pct(day.net, wk.net), ly && pct(day.net, ly.net), cls(day.net, wk.net)],
    ['Covers', String(day.covers), pct(day.covers, wk.covers), ly && pct(day.covers, ly.covers), cls(day.covers, wk.covers)],
    ['Average check', cvMoney(day.check, { cents: true }), pct(day.check, wk.check), ly && pct(day.check, ly.check), cls(day.check, wk.check)],
    ['Lunch / dinner', `${money(day.lunch)} / ${money(day.dinner)}`, pct(day.dinner, wk.dinner), ly && pct(day.dinner, ly.dinner), cls(day.dinner, wk.dinner)],
  ];
  return (
    <DenseCard title={`Last service day: ${day.dow} ${day.iso}`} sub={`Against ${wk.dow} ${wk.iso.slice(5)} last week${ly ? ` and ${ly.iso} last year` : ''}`}>
      <div className="cv-grid g4">
        {tiles.map(([k, v, w, y, c]) => (
          <div key={k} className="cv-col" style={{ gap: 4 }}>
            <span className="cv-xs cv-faint">{k}</span><span className="cv-fig md cv-num">{v}</span>
            <span className={`cv-xs ${c}`}>{w} on last week{y ? <span className="cv-faint"> · {y} on last year</span> : null}</span>
          </div>
        ))}
      </div>
      <span className="cv-xs cv-faint">Covers by hour (dashed: last week)</span>
      <Bars vals={hrs.map((h) => h.covers)} labels={hrs.map((h) => `${h.hour > 12 ? h.hour - 12 : h.hour}${h.hour >= 12 ? 'p' : 'a'}`)} fmt={n0} compare={wkHrs.map((h) => h.covers)} height={110} color="var(--cat-2)" />
    </DenseCard>
  );
}

function HeatBlock({ title, sub, fields, initial, note }) {
  const dense = useDense();
  const [f, setF] = React.useState(initial);
  if (!dense) return null;
  const grid = heat(dense.hours);
  const field = fields.find((x) => x[0] === f);
  // The busiest (or worst) cell, named in plain words.
  let top = null;
  for (const r of grid) for (const c of r.cells) if (!top || c[f] > top.v) top = { dow: r.dow, hour: c.hour, v: c[f] };
  return (
    <DenseCard title={title} sub={sub} right={fields.length > 1 ? <FieldTabs value={f} onChange={setF} fields={fields.map(([k, l]) => [k, l])} /> : null}>
      <HeatGrid grid={grid} field={f} fmt={field[2]} highlight={top?.dow} />
      <span className="cv-xs cv-faint">Highest: {top.dow} {top.hour > 12 ? top.hour - 12 : top.hour}{top.hour >= 12 ? 'pm' : 'am'}, {field[2](top.v)}. {note} Average over {dense.hours.length.toLocaleString('en-US')} hourly rows, last 13 weeks.</span>
    </DenseCard>
  );
}

const fmtCov = (v) => String(Math.round(v));
const fmtMin = (v) => v.toFixed(1);
const fmtPct = (v) => `${Math.round(v)}%`;
const fmtUsd = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);

export const DenseService = () => <HeatBlock title="When the room is busy" sub="Weekday by hour" initial="covers" fields={[['covers', 'Covers', fmtCov], ['sales', 'Sales', fmtUsd], ['seatUse', 'Seats used', fmtPct]]} note="Use it to place breaks, prep and the second turn." />;
export const DenseLabour = () => <HeatBlock title="Covers per server, by hour" sub="Low numbers are hours that are over-staffed for the covers" initial="cps" fields={[['cps', 'Covers / server', fmtMin], ['covers', 'Covers', fmtCov]]} note="Hours under about 4 covers a server are where the schedule has slack." />;
export const DenseKitchen = () => <HeatBlock title="Ticket minutes by hour" sub="Average time from fire to pass" initial="ticketMin" fields={[['ticketMin', 'Ticket min', fmtMin], ['covers', 'Covers', fmtCov]]} note="Slow hours line up with the full hours." />;
export const DenseThroughput = () => <HeatBlock title="Seats in use by hour" sub="Share of seats filled, weekday by hour" initial="seatUse" fields={[['seatUse', 'Seats used', fmtPct], ['covers', 'Covers', fmtCov]]} note="Hours near full are the only ones where faster turns add covers." />;

export function DenseControls() {
  const dense = useDense();
  if (!dense) return null;
  const ms = monthsVsLy(dense, 13);
  const rate = (m) => ((m.voids + m.comps + m.discounts) / m.net) * 100;
  return (
    <DenseCard title="Voids, comps and discounts by month" sub="Share of sales, with the same month last year">
      <Bars vals={ms.map(rate)} labels={ms.map((m) => monthName(m.month))} fmt={(v) => `${v.toFixed(1)}%`} compare={ms.map((m) => (m.ly ? rate(m.ly) : null))} height={120} color="var(--cat-3)" />
      <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Exceptions by month">
        <table className="cv-table">
          <thead><tr><th>Month</th><th className="r">Voids</th><th className="r">Comps</th><th className="r">Discounts</th><th className="r">% of sales</th><th className="r">Last year</th></tr></thead>
          <tbody>{[...ms].reverse().map((m) => (
            <tr key={m.month}><td>{monthName(m.month)}{m.days < 28 ? <span className="cv-xs cv-faint"> · {m.days} days</span> : null}</td><td className="r cv-num">{money(m.voids)}</td><td className="r cv-num">{money(m.comps)}</td><td className="r cv-num">{money(m.discounts)}</td><td className="r cv-num">{rate(m).toFixed(2)}%</td><td className={`r cv-num ${m.ly ? cls(rate(m), rate(m.ly), false) : ''}`}>{m.ly ? `${rate(m.ly).toFixed(2)}%` : '—'}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </DenseCard>
  );
}

export function DenseChannels() {
  const dense = useDense();
  if (!dense) return null;
  const chans = (CV_D.room.channels || []).filter((c) => c.sales > 0);
  if (!chans.length) return null;
  const m = new Map();
  for (const d of dense.days.filter((x) => !x.prior)) {
    const k = d.iso.slice(0, 7);
    const row = m.get(k) ?? { month: k, total: 0, ...Object.fromEntries(chans.map((c) => [c.k, 0])) };
    for (const c of chans) row[c.k] += d.channels[c.k] ?? 0;
    row.total += d.net;
    m.set(k, row);
  }
  const rows = [...m.values()].slice(-13);
  return (
    <DenseCard title="Sales by channel, month by month" sub={`${chans.length} channels, split from each day's sales`}>
      <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Channels by month">
        <table className="cv-table">
          <thead><tr><th>Month</th>{chans.map((c) => <th key={c.k} className="r">{c.name}</th>)}<th className="r">Total</th></tr></thead>
          <tbody>{[...rows].reverse().map((r) => (
            <tr key={r.month}><td>{monthName(r.month)}</td>{chans.map((c) => <td key={c.k} className="r cv-num">{money(r[c.k])} <span className="cv-xs cv-faint">{((r[c.k] / r.total) * 100).toFixed(0)}%</span></td>)}<td className="r cv-num" style={{ fontWeight: 600 }}>{money(r.total)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </DenseCard>
  );
}

export function DenseMenu() {
  const dense = useDense();
  const [sort, setSort] = React.useState('rev');
  const [q, setQ] = React.useState('');
  if (!dense) return null;
  const trend = (it) => { const a = it.units.slice(-4).reduce((s, x) => s + x, 0), b = it.units.slice(-13, -4).reduce((s, x) => s + x, 0) / 9 * 4; return b ? a / b - 1 : 0; };
  const key = { rev: (it) => it.units.at(-1) * it.price, units: (it) => it.units.reduce((s, x) => s + x, 0), up: trend, down: (it) => -trend(it) }[sort];
  const list = dense.items.filter((it) => !q || it.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => key(b) - key(a)).slice(0, 20);
  return (
    <DenseCard title="Every dish, units a week for 52 weeks" sub={`${dense.items.length} dishes × 52 weeks`}
      right={<FieldTabs value={sort} onChange={setSort} fields={[['rev', 'Sales'], ['units', 'Units'], ['up', 'Rising'], ['down', 'Falling']]} />}>
      <input className="input" placeholder="Find a dish" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a dish" style={{ maxWidth: 260 }} />
      <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Dishes by week">
        <table className="cv-table">
          <thead><tr><th>Dish</th><th>52 weeks</th><th className="r">This week</th><th className="r">Last 4 wks vs before</th><th className="r">Year units</th></tr></thead>
          <tbody>{list.map((it) => { const t = trend(it); return (
            <tr key={it.key}><td>{it.name}<span className="cv-xs cv-faint"> · {it.cat}</span></td><td><Spark vals={it.units} /></td><td className="r cv-num">{it.units.at(-1)}</td><td className={`r cv-num ${t >= 0 ? 'cv-up' : 'cv-down'}`}>{t >= 0 ? '+' : '−'}{Math.abs(t * 100).toFixed(1)}%</td><td className="r cv-num">{n0(it.units.reduce((s, x) => s + x, 0))}</td></tr>
          ); })}
          {!list.length && <tr><td colSpan={5} className="cv-faint">No dish matches “{q}”.</td></tr>}</tbody>
        </table>
      </div>
    </DenseCard>
  );
}

export function DensePortfolio() {
  const rooms = CV_GROUP.rooms.map((d) => ({ id: d.id, name: d.profile.short, dense: densify(d.room) })).filter((r) => r.dense);
  if (!rooms.length) return null;
  const rows = rooms.map((r) => {
    const ms = monthsVsLy(r.dense, 3).filter((m) => m.days >= 28);
    const last = ms.at(-1);
    const d30 = r.dense.days.slice(-30);
    return { ...r, d30, net30: sum(d30, (d) => d.net), last };
  });
  return (
    <DenseCard title="Every room, last 30 days" sub="Daily sales, and the last full month against the same month last year">
      <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Rooms, last 30 days">
        <table className="cv-table">
          <thead><tr><th>Room</th><th>30 days</th><th className="r">Sales, 30 days</th><th className="r">Last full month</th><th className="r">Per day vs LY</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.name}</td><td><Spark vals={r.d30.map((d) => d.net)} /></td><td className="r cv-num">{money(r.net30)}</td>
              <td className="r cv-num">{r.last ? `${monthName(r.last.month)} · ${money(r.last.net)}` : '—'}</td>
              <td className={`r cv-num ${r.last?.ly ? cls(r.last.net / r.last.days, r.last.ly.net / r.last.ly.days) : ''}`}>{r.last?.ly ? pct(r.last.net / r.last.days, r.last.ly.net / r.last.ly.days) : '—'}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </DenseCard>
  );
}
