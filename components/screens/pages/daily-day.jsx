'use client';

import * as React from 'react';

import { Button, Icon, Tabs } from '../../kit';
import { Claim, Pill, cvMoney } from '../core';
import { change, dayparts, daypartError, hourLabel, partHours, ratio, serviceHour } from '../../../lib/data/page/daily';
import s from './daily.module.css';

/* The selected day, visual first: each section leads with a picture and a
 * one-line takeaway; the full numbers sit behind "See the numbers". */

const $ = (v) => (v == null ? '—' : cvMoney(Math.round(v)));
const $c = (v) => (v == null ? '—' : cvMoney(v, { cents: true }));
const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const n1 = (v) => (v == null ? '—' : v.toFixed(1));
const hr = (h) => hourLabel(h).replace(' ', '');
const pct = (v) => `${Math.round(v * 100)}%`;
const CAT = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'color-mix(in srgb, var(--cat-1) 45%, transparent)', 'color-mix(in srgb, var(--cat-2) 45%, transparent)', 'color-mix(in srgb, var(--cat-3) 45%, transparent)'];

export function Delta({ v, invert = false, money: m = false, pts = false }) {
  if (v == null || !Number.isFinite(v)) return <span className={`${s.delta} ${s.flat}`}>—</span>;
  const good = invert ? v < 0 : v > 0;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
  const txt = m ? `${sign}${cvMoney(Math.abs(Math.round(v)))}` : pts ? `${sign}${Math.abs(v).toFixed(1)} pts` : `${sign}${Math.abs(v * 100).toFixed(1)}%`;
  return <span className={`${s.delta} ${Math.abs(v) < 1e-9 ? s.flat : good ? 'cv-up' : 'cv-down'}`}>{txt}</span>;
}

/** Details behind a click. Native <details>, so it works by keyboard and screen reader. */
export function Fold({ label, children, open, onToggle, className = '' }) {
  const ctl = open !== undefined ? { open, onToggle: (e) => onToggle?.(e.currentTarget.open) } : {};
  return (
    <details className={`${s.fold} ${className}`} {...ctl}>
      <summary><Icon name="ChevronRight" size={14} />{label}</summary>
      <div className={s.foldBody}>{children}</div>
    </details>
  );
}

function Head({ title, take, right }) {
  return (
    <div className="cv-card-head">
      <div className="cv-col" style={{ gap: 2, minWidth: 0 }}>
        <span className="cv-over">{title}</span>
        {take && <span className={s.take}>{take}</span>}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------ money */

/** Where the money came from: channels and food vs drink as bars; every line behind a click. */
export function MoneyBreakdown({ day, base, has, own }) {
  const chans = Object.entries(day.channels || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const tot = chans.reduce((a, [, v]) => a + v, 0);
  const leak = [
    { k: 'Discounts', v: day.discounts, b: base?.discounts },
    ...(has.refunds ? [{ k: 'Refunds', v: day.refunds, b: base?.refunds }] : []),
    ...(has.voids ? [{ k: 'Voids after send', v: day.voids, b: base?.voids }] : []),
  ];
  const line = (k, label, get, opts = {}) => ({ k, label, v: get(day), b: base ? get(base) : null, ...opts });
  const rows = [
    line('gross', 'Gross sales (net + discounts)', (d) => d.gross),
    line('disc', 'Discounts', (d) => d.discounts, { invert: true }),
    line('net', 'Net sales', (d) => d.net, { strong: true }),
    ...(has.refunds ? [line('ref', 'Refunds (on this day)', (d) => d.refunds, { invert: true })] : []),
    ...(has.mix ? [line('food', 'Food sales', (d) => d.foodSales), line('drink', 'Beverage sales', (d) => d.drinkSales)] : []),
    ...Object.keys({ ...day.channels, ...(base?.channels || {}) }).map((c) => line(`ch-${c}`, c, (d) => d.channels?.[c] ?? 0)),
    line('orders', 'Checks', (d) => d.orders, { count: true }),
    line('covers', 'Covers', (d) => d.covers, { count: true }),
    line('check', 'Average check (net ÷ covers)', (d) => d.check, { cents: true }),
    ...(has.labour ? [line('lab', 'Labour (actual pay)', (d) => d.labour, { invert: true }), line('labp', 'Labour % of net', (d) => ratio(d.labour, d.net), { pct: true, invert: true })] : []),
    ...(has.food ? [line('fc', 'Food cost (sample)', (d) => d.food, { invert: true })] : []),
    ...(has.voids ? [line('void', 'Voids after the kitchen saw them', (d) => d.voids, { invert: true })] : []),
    ...(has.tax ? [line('tax', 'Tax collected (not sales)', (d) => d.tax, { aside: true })] : []),
    ...(has.tips ? [line('tips', 'Tips and gratuity (not sales)', (d) => d.tips, { aside: true })] : []),
  ];
  const fmt = (r, v) => (v == null ? '—' : r.count ? n0(v) : r.cents ? $c(v) : r.pct ? `${(v * 100).toFixed(1)}%` : $(v));
  const top = chans[0];
  return (
    <section className="cv-card">
      <Head title="Where the money came from" take={top && tot ? `${top[0]}: ${pct(top[1] / tot)} of sales` : `${$(day.net)} net`} right={own ? <Claim k="obs" /> : <Pill icon="FlaskConical">Sample</Pill>} />
      {tot > 0 && (
        <div className="cv-col" style={{ gap: 6 }}>
          <div className={s.stack} role="img" aria-label={`Sales by channel: ${chans.map(([k, v]) => `${k} ${$(v)}`).join(', ')}`}>
            {chans.map(([k, v], i) => <span key={k} style={{ width: `${(v / tot) * 100}%`, background: CAT[i % CAT.length] }} title={`${k}: ${$(v)}`} />)}
          </div>
          <div className="cv-legend">{chans.map(([k, v], i) => <span key={k}><i style={{ background: CAT[i % CAT.length] }} />{k} <b className="cv-num">{$(v)}</b></span>)}</div>
        </div>
      )}
      {has.mix && day.foodSales != null && day.net > 0 && (
        <div className="cv-col" style={{ gap: 6 }}>
          <div className={s.stack} role="img" aria-label={`Food ${$(day.foodSales)}, beverage ${$(day.drinkSales)}`}>
            <span style={{ width: `${(day.foodSales / Math.max(1, day.foodSales + day.drinkSales)) * 100}%`, background: 'var(--cat-3)' }} />
            <span style={{ flex: 1, background: 'var(--cat-2)' }} />
          </div>
          <div className="cv-legend"><span><i style={{ background: 'var(--cat-3)' }} />Food <b className="cv-num">{$(day.foodSales)}</b></span><span><i style={{ background: 'var(--cat-2)' }} />Beverage <b className="cv-num">{$(day.drinkSales)}</b></span></div>
        </div>
      )}
      <div className={s.chips}>
        {leak.map((x) => (
          <div key={x.k} className={s.chip}>
            <span className="cv-xs cv-faint">{x.k}</span>
            <span className="cv-num" style={{ fontWeight: 600 }}>{$(x.v)}</span>
            {base && <Delta v={x.v != null && x.b != null ? x.v - x.b : null} money invert />}
          </div>
        ))}
      </div>
      <Fold label="See every line">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Money breakdown for the day">
          <table className="cv-table">
            <thead><tr><th>Line</th><th className="r">This day</th>{base && <th className="r">Comparison</th>}{base && <th className="r">Change</th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k} style={r.strong ? { fontWeight: 600 } : r.aside ? { color: 'var(--fg-2)' } : undefined}>
                  <td>{r.label}</td>
                  <td className="r cv-num">{fmt(r, r.v)}</td>
                  {base && <td className="r cv-num">{fmt(r, r.b)}</td>}
                  {base && <td className="r">{r.pct ? <Delta v={r.v != null && r.b != null ? (r.v - r.b) * 100 : null} pts invert={r.invert} /> : <Delta v={change(r.v, r.b)} invert={r.invert} />}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!has.labour && <span className="cv-xs cv-faint">No labour: no TimeEntries were loaded. It is never counted as zero.</span>}
      </Fold>
    </section>
  );
}

/* ------------------------------------------------------------ day parts */

/** Day parts as bars, each with the comparison marked; configurable per room. */
export function DayParts({ day, base, parts, setParts, canEdit }) {
  const [edit, setEdit] = React.useState(false);
  const rows = dayparts(day, parts);
  const brows = base?.hours?.length ? dayparts({ hours: base.hours }, parts) : null;
  const max = Math.max(1, ...(rows || []).map((r) => r.sales), ...(brows || []).map((r) => r.sales));
  const total = (rows || []).reduce((a, r) => a + r.sales, 0);
  const best = rows ? [...rows].sort((a, b) => b.sales - a.sales)[0] : null;
  return (
    <section className="cv-card">
      <Head title="By day part" take={best && total ? `${best.name}: ${pct(best.sales / total)} of sales` : null}
        right={canEdit && <Button size="sm" variant="ghost" icon="Pencil" onClick={() => setEdit((e) => !e)}>{edit ? 'Close' : 'Edit'}</Button>} />
      {edit && <PartsEditor parts={parts} onSave={(p) => { setParts(p); setEdit(false); }} />}
      {rows ? (
        <div className="cv-col" style={{ gap: 12 }}>
          {rows.map((r) => {
            const b = brows?.find((x) => x.name === r.name);
            return (
              <div key={r.name} className={s.partRow}>
                <span className={s.partName}>{r.name}<span className="cv-xs cv-faint">{r.from != null ? partHours(r) : ''}</span></span>
                <span className={s.partTrack} role="img" aria-label={`${r.name}: ${$(r.sales)}${b ? `, comparison ${$(b.sales)}` : ''}`}>
                  <span className={s.partFill} style={{ width: `${(r.sales / max) * 100}%` }} />
                  {b && <span className={s.partBase} style={{ left: `${(b.sales / max) * 100}%` }} title={`Comparison ${$(b.sales)}`} />}
                </span>
                <span className={s.partVal}><b className="cv-num">{$(r.sales)}</b>{brows && (b && b.sales ? <Delta v={change(r.sales, b.sales)} /> : <span className={`${s.delta} ${s.flat}`}>{r.sales ? 'new' : '—'}</span>)}</span>
              </div>
            );
          })}
          {brows && <div className="cv-legend"><span><i style={{ background: 'var(--cat-1)' }} />this day</span><span><i style={{ background: 'var(--fg-1)', width: 2 }} />comparison</span></div>}
          <Fold label="See the numbers">
            <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Day parts">
              <table className="cv-table">
                <thead><tr><th>Day part</th><th className="r">Sales</th><th className="r">Checks</th><th className="r">Covers</th><th className="r">Avg check</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="r cv-num">{$(r.sales)}</td><td className="r cv-num">{n0(r.orders)}</td><td className="r cv-num">{n0(r.covers)}</td><td className="r cv-num">{$c(r.check)}</td></tr>)}</tbody>
              </table>
            </div>
            <span className="cv-xs cv-faint">Each check counts once, in the hour it was opened. Hours after midnight belong to the night before.</span>
          </Fold>
        </div>
      ) : <span className="cv-small cv-muted">No hour-by-hour rows for this day.</span>}
    </section>
  );
}

function PartsEditor({ parts, onSave }) {
  const [rows, setRows] = React.useState(parts.map((p) => ({ ...p })));
  const err = daypartError(rows);
  const opts = Array.from({ length: 25 }, (_, i) => i + 4);
  const set = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="cv-col" style={{ gap: 8 }}>
      {rows.map((p, i) => (
        <div key={i} className="cv-row" style={{ gap: 6 }}>
          <input className="input" style={{ width: 150, height: 34 }} value={p.name} maxLength={30} onChange={(e) => set(i, 'name', e.target.value)} aria-label={`Day part ${i + 1} name`} />
          <select className="input" style={{ width: 'auto', height: 34 }} value={p.from} onChange={(e) => set(i, 'from', +e.target.value)} aria-label={`${p.name} starts`}>{opts.slice(0, -1).map((h) => <option key={h} value={h}>{hourLabel(h % 24)}</option>)}</select>
          <span className="cv-xs cv-faint">to</span>
          <select className="input" style={{ width: 'auto', height: 34 }} value={p.to} onChange={(e) => set(i, 'to', +e.target.value)} aria-label={`${p.name} ends`}>{opts.slice(1).map((h) => <option key={h} value={h}>{hourLabel(h % 24)}{h >= 24 ? ' (next day)' : ''}</option>)}</select>
          <button className="iconbtn" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label={`Remove ${p.name}`} disabled={rows.length === 1}><Icon name="Trash2" size={16} /></button>
        </div>
      ))}
      <div className="cv-row" style={{ gap: 8 }}>
        <Button size="sm" variant="secondary" icon="Plus" disabled={rows.length >= 8} onClick={() => { const last = Math.max(...rows.map((r) => r.to)); setRows((r) => [...r, { name: 'New part', from: Math.min(27, last), to: Math.min(28, last + 1) }]); }}>Add</Button>
        <Button size="sm" icon="Check" disabled={!!err} onClick={() => onSave(rows.map((r) => ({ name: r.name.trim(), from: r.from, to: r.to })).sort((a, b) => a.from - b.from))}>Save for this room</Button>
        {err && <span className="cv-xs cv-down" role="alert">{err}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ hours */

const HOUR_METRICS = {
  sales: { label: 'Sales', get: (h) => h.sales, fmt: $ },
  covers: { label: 'Covers', get: (h) => h.covers, fmt: n0 },
  splh: { label: 'Sales per labour hour', get: (h) => (h.labourHours ? h.sales / h.labourHours : null), fmt: $, needs: true },
};

/** Hour by hour as bars you can point at and tap; tap an hour to see its checks. */
export function Hours({ day, base, has, onHour, hour }) {
  const lab = (day.hours || []).some((h) => h.labourHours != null && h.labourHours > 0);
  const [metric, setMetric] = React.useState('sales');
  const [at, setAt] = React.useState(null);
  if (!day.hours?.length) return null;
  const m = HOUR_METRICS[metric === 'splh' && !lab ? 'sales' : metric];
  const bh = new Map((base?.hours || []).map((h) => [h.h, h]));
  const list = [...day.hours].sort((a, b) => serviceHour(a.h) - serviceHour(b.h));
  const vals = list.map((h) => m.get(h));
  const bvals = list.map((h) => (bh.get(h.h) ? m.get(bh.get(h.h)) : null));
  const max = Math.max(1, ...vals.filter((v) => v != null), ...bvals.filter((v) => v != null));
  const peak = list[vals.indexOf(Math.max(...vals.filter((v) => v != null)))];
  const show = at ?? hour;
  const cur = show != null ? list.find((h) => h.h === show) : null;
  const curB = cur ? bh.get(cur.h) : null;
  return (
    <section className="cv-card">
      <Head title="Hour by hour" take={peak ? `Busiest: ${hourLabel(peak.h)}, ${m.fmt(m.get(peak))}${metric === 'sales' ? '' : ` ${m.label.toLowerCase()}`}` : null}
        right={<Tabs value={m === HOUR_METRICS.splh ? 'splh' : metric} onChange={setMetric} tabs={Object.entries(HOUR_METRICS).filter(([, x]) => !x.needs || lab).map(([value, x]) => ({ value, label: x.label }))} />} />
      <div className={s.hourChart} onMouseLeave={() => setAt(null)}>
        <div className={s.hourReadout} aria-live="polite">
          {cur ? <>
            <b>{hourLabel(cur.h)}</b>
            <span>{m.label} <b className="cv-num">{m.fmt(m.get(cur))}</b></span>
            {curB && <span className="cv-faint">comparison {m.fmt(m.get(curB))}</span>}
            <span className="cv-faint">{n0(cur.orders)} checks · {n0(cur.covers)} covers{cur.labourHours ? ` · ${n1(cur.labourHours)} labour h` : ''}</span>
          </> : <span className="cv-faint">{onHour ? 'Point at an hour to read it; tap to see its checks.' : 'Point at an hour to read it.'}</span>}
        </div>
        <div className={s.hourBars}>
          {list.map((h, i) => {
            const v = vals[i], b = bvals[i];
            return (
              <button key={h.h} type="button" className={`${s.hourCol} ${hour === h.h ? s.hourOn : ''}`} onMouseEnter={() => setAt(h.h)} onFocus={() => setAt(h.h)} onBlur={() => setAt(null)}
                onClick={onHour ? () => onHour(hour === h.h ? null : h.h) : undefined} aria-pressed={onHour ? hour === h.h : undefined}
                aria-label={`${hourLabel(h.h)}: ${m.label} ${m.fmt(v)}${b != null ? `, comparison ${m.fmt(b)}` : ''}`}>
                <span className={s.hourPlot}>
                  <span className={s.hourBar} style={{ height: `${((v ?? 0) / max) * 100}%`, opacity: hour == null || hour === h.h ? 1 : 0.35 }} />
                  {b != null && <span className={s.hourBase} style={{ bottom: `${(b / max) * 100}%` }} />}
                </span>
                <span className={s.hourLbl}>{hr(h.h)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {base && <div className="cv-legend"><span><i style={{ background: 'var(--cat-1)' }} />this day</span><span><i className="line" style={{ background: 'none', borderTop: '2px dashed var(--fg-2)', height: 0 }} />comparison</span></div>}
      <Fold label="See every hour">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Hours">
          <table className="cv-table">
            <thead><tr><th>Hour</th><th className="r">Sales</th>{base && <th className="r">Comparison</th>}<th className="r">Checks</th><th className="r">Covers</th><th className="r">Avg check</th>{lab && <th className="r">Labour h</th>}{lab && <th className="r">Labour</th>}{lab && <th className="r">Sales / labour h</th>}{has.servers && <th className="r">Servers</th>}{has.ticket && <th className="r">Ticket</th>}{has.seatUse && <th className="r">Seats used</th>}</tr></thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.h}>
                  <td className="cv-num">{hourLabel(h.h)}</td>
                  <td className="r cv-num">{$(h.sales)}</td>
                  {base && <td className="r cv-num">{bh.get(h.h) ? $(bh.get(h.h).sales) : '—'}</td>}
                  <td className="r cv-num">{n0(h.orders)}</td><td className="r cv-num">{n0(h.covers)}</td><td className="r cv-num">{$c(ratio(h.sales, h.covers))}</td>
                  {lab && <td className="r cv-num">{n1(h.labourHours)}</td>}{lab && <td className="r cv-num">{$(h.labour)}</td>}{lab && <td className="r cv-num">{h.labourHours ? $(h.sales / h.labourHours) : '—'}</td>}
                  {has.servers && <td className="r cv-num">{h.servers ?? '—'}</td>}{has.ticket && <td className="r cv-num">{h.ticketMin != null ? `${h.ticketMin}m` : '—'}</td>}{has.seatUse && <td className="r cv-num">{h.seatUse != null ? `${h.seatUse}%` : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="cv-xs cv-faint">By the hour each check was opened{lab ? '; labour spread over the hours each shift was on the clock' : ''}.</span>
      </Fold>
    </section>
  );
}

/* ------------------------------------------------------------ checks */

/** The checks behind the day (or one hour of it), folded until asked for. */
export function Checks({ detail, hour, setHour, open, setOpen }) {
  const [all, setAll] = React.useState(false);
  if (!detail) return <section className="cv-card"><span className="cv-small cv-muted">Loading this day’s checks…</span></section>;
  if (detail.error) return <section className="cv-card"><span className="cv-small cv-down">Couldn’t load the checks: {detail.error}</span></section>;
  if (!detail.checksKept) return null;
  const rows = hour == null ? detail.checks : detail.checks.filter((c) => +c[1].slice(0, 2) === hour);
  const shown = all || hour != null ? rows : rows.slice(0, 25);
  const voided = rows.filter((c) => c[9]).length;
  return (
    <section className="cv-card" id="daily-checks">
      <Fold className={s.foldPlain} open={open} onToggle={setOpen} label={<span className="cv-row nowrap" style={{ gap: 8 }}>
        <span className="cv-h4">{hour != null ? `Checks opened at ${hourLabel(hour)}` : 'The checks'}</span>
        <Pill>{rows.length.toLocaleString('en-US')}</Pill>{voided > 0 && <Pill tone="warn" icon="Ban">{voided} voided</Pill>}
      </span>}>
        {hour != null && <div><Button size="sm" variant="ghost" icon="X" onClick={() => setHour(null)}>All hours</Button></div>}
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Checks" style={{ maxHeight: 480, overflowY: 'auto' }}>
          <table className="cv-table" style={{ fontSize: 'var(--text-sm)' }}>
            <thead><tr><th>Opened</th><th>Paid</th><th>Check</th><th className="r">Guests</th><th>Server</th><th>Table</th><th>Channel</th><th className="r">Amount</th><th className="r">Discount</th><th /></tr></thead>
            <tbody>
              {shown.map((c, i) => (
                <tr key={`${c[0]}-${i}`} style={c[9] ? { color: 'var(--fg-3)', textDecoration: 'line-through' } : undefined}>
                  <td className="cv-num">{c[1]}</td><td className="cv-num">{c[2] || '—'}</td><td className="cv-num" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c[0]}>{c[0]}</td>
                  <td className="r cv-num">{c[3]}</td><td>{c[4] || '—'}</td><td>{c[5] || '—'}</td><td>{c[6]}</td>
                  <td className="r cv-num">{$c(c[7])}</td><td className="r cv-num">{c[8] ? $c(c[8]) : ''}</td><td>{c[9] ? <Pill tone="warn" icon="Ban">Voided</Pill> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!all && hour == null && rows.length > shown.length && <div><Button size="sm" variant="secondary" onClick={() => setAll(true)}>Show all {rows.length.toLocaleString('en-US')}</Button></div>}
        <span className="cv-xs cv-faint">As Toast recorded them. Times are the restaurant’s clock.</span>
      </Fold>
    </section>
  );
}

/* ------------------------------------------------------------ dishes */

/** What sold that day: the top dishes as bars, at the prices guests paid that day. */
export function DayItems({ detail }) {
  const [all, setAll] = React.useState(false);
  if (!detail?.dishes || !Object.keys(detail.dishes).length) return null;
  const rows = Object.entries(detail.dishes).map(([name, [u, net, gross, cat]]) => ({ name, u, net, gross, cat })).sort((a, b) => b.net - a.net);
  const max = Math.max(1, rows[0]?.net ?? 0);
  return (
    <section className="cv-card">
      <Head title="What sold" take={rows[0] ? `Top: ${rows[0].name}, ${$(rows[0].net)}` : null} right={<Claim k="obs" />} />
      <div className="cv-col" style={{ gap: 10 }}>
        {rows.slice(0, 6).map((r) => (
          <div key={r.name} className="cv-hbar" style={{ gridTemplateColumns: 'minmax(0, 150px) minmax(0, 1fr) 120px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</span>
            <span className="bar"><span style={{ width: `${(r.net / max) * 100}%`, background: 'var(--cat-2)' }} /></span>
            <span className="cv-num" style={{ textAlign: 'right' }}>{$(r.net)} <span className="cv-xs cv-faint">· {n0(r.u)}</span></span>
          </div>
        ))}
      </div>
      <Fold label={`See all ${rows.length} dishes`}>
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Dishes sold" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="cv-table">
            <thead><tr><th>Dish</th><th>Category</th><th className="r">Units</th><th className="r">Net sales</th><th className="r">Price paid</th><th className="r">Discounts</th></tr></thead>
            <tbody>
              {rows.slice(0, all ? rows.length : 40).map((r) => (
                <tr key={r.name}><td>{r.name}</td><td className="cv-xs cv-faint">{r.cat || '—'}</td><td className="r cv-num">{n0(r.u)}</td><td className="r cv-num">{$c(r.net)}</td><td className="r cv-num">{r.u ? $c(r.net / r.u) : '—'}</td><td className="r cv-num">{r.gross - r.net > 0.005 ? $c(r.gross - r.net) : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {!all && rows.length > 40 && <div><Button size="sm" variant="secondary" onClick={() => setAll(true)}>Show all {rows.length}</Button></div>}
        <span className="cv-xs cv-faint">Price paid is net ÷ units that day, not today’s menu price. Recipe costs aren’t in Toast, so there’s no margin per dish.</span>
      </Fold>
    </section>
  );
}

/* ------------------------------------------------------------ note */

/** One line in a manager's words: shows on the chart and calendar, and flags the day when it's used as a comparison. */
export function DayNote({ iso, note, canNote, onNote }) {
  const [text, setText] = React.useState(note?.text ?? '');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => { setText(note?.text ?? ''); setErr(null); setSaved(false); }, [iso, note?.text]);
  const save = async (t) => {
    setBusy(true); setErr(null); setSaved(false);
    try { await onNote(iso, t); setSaved(true); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  if (!canNote) return note ? <section className={`cv-card ${s.noteCard}`}><Icon name="StickyNote" size={16} /><span className="cv-small">{note.text}</span></section> : null;
  return (
    <section className={`cv-card ${s.noteCard}`}>
      <Icon name="StickyNote" size={18} />
      <input id="daily-note" className="input" value={text} maxLength={280} onChange={(e) => { setText(e.target.value); setSaved(false); }} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim() && text.trim() !== note?.text) save(text); }}
        placeholder="What was different about this day? Rain, a party, short-staffed…" aria-label="Note for this day" />
      <Button size="sm" icon="Check" disabled={busy || !text.trim() || text.trim() === note?.text} onClick={() => save(text)}>{busy ? 'Saving…' : note ? 'Update' : 'Save note'}</Button>
      {note && <button className="iconbtn" disabled={busy} onClick={() => save('')} aria-label="Remove the note"><Icon name="Trash2" size={16} /></button>}
      {(() => {
        const msg = err ? <span className="cv-down" role="alert">Not saved: {err}</span> : saved ? (text.trim() ? 'Saved. It shows on the chart and calendar.' : 'Removed.') : note?.by ? `${note.by} · ${new Date(note.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : null;
        return msg ? <span className="cv-xs cv-faint" aria-live="polite" style={{ flexBasis: '100%' }}>{msg}</span> : null;
      })()}
    </section>
  );
}
