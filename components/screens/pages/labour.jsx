'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { tonightPlan } from '../week';
import { weeklySeries } from '../../../lib/data/readers';
import { HOURLY_WEEKS } from '../../../lib/data/dense';
import { covercastRoom, shiftPulseDay } from '../../../lib/data/forecast/index.js';
import {
  checkCrew, checkEntry, costByRole, DAYS, dayName, dayOfTitle, deptSplit, entryTotals, followUps, forecastWeek, gapGrid, groupShare, kitchenLoad, lineCheck, listOf, loadGridFromPlans, loadGridFromServices,
  mathChecks, moves as movesOf, planServices, sampleServices, serverWage, shortPhrase, splitMoves, STAGES, stageOf, STATUS, trustOf, weekDays, weekSummary, weekTotals, withEntry,
} from '../../../lib/data/page/labour';
import { useCv, cvMoney, cvApproval, CV_D, CV_GROUP, CV_NOW, CV_ROOM, Claim } from '../core';
import { useDense } from '../dense-ui';
import { useTodayTheme } from './today.themes';
import { ScheduleGrade } from '../touches';
import s from './labour.module.css';

/* ================================================================ Labor
 * Ramidu's redesign concept in Today's finished style, reworked after the
 * client-perspective review (2026-11-17):
 *   - a Mon to Sun strip with one status per day; picking a day drives the
 *     hero, the hourly chart, the moves, the pattern grid and the results;
 *   - a week summary (biggest shortage, most spare, best matched, missing);
 *   - a hero that switches between an urgent gap, a savings opportunity, a
 *     data blocker, a result worth a look, and "on track";
 *   - every move says the exact change, who it affects, the estimated cost or
 *     impact, the risk, and how we know (confidence, basis, inputs, quality);
 *   - one vocabulary for money: Opportunity, Projected impact, In test,
 *     Measured result, Verified savings, Reversed;
 *   - three views of the same page: GM, Owner, Operations (saved per person).
 * Colors have fixed meanings: persimmon = action and the selected thing,
 * red = short, amber = spare or caution, green = verified, navy = structure.
 * Every figure is read from the room (lib/data/page/labour.js). Moves are
 * advice: recording a plan never changes a live schedule.
 *
 * Depth pass (2026-11-18): "needed" follows one rule everywhere (guests ÷ pace);
 * the pattern grid reads the same services as the chart; front of house and
 * kitchen each get their own cost, hours and productivity; the kitchen has its
 * own hour-by-hour view (ticket times against target, late tickets by station,
 * and cooks on the line entered by hand to tell a people problem from a
 * station problem); and the page lists the checks it runs on its own math. */

const MOVE_ICON = { risk: 'UserPlus', ready: 'CalendarClock', potential: 'Sigma', check: 'UserMinus' };
const VIEWS = [['gm', 'GM'], ['owner', 'Owner'], ['ops', 'Operations']];
const MODES = { cps: 'Covers per server', gap: 'Short or spare' };
const fmtDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
const hrs = (n) => `${n} ${n === 1 ? 'hour' : 'hours'}`;
const signed = (n) => `${n < 0 ? '−' : '+'}${cvMoney(Math.abs(n))}`;

function Chip({ tone = 'mute', icon, children }) {
  return <span className={`${s.chip} ${s[`chip_${tone}`]}`}>{icon && <Icon name={icon} size={14} />}{children}</span>;
}
const Stage = ({ k }) => <Chip tone={STAGES[k].tone} icon={STAGES[k].icon}>{STAGES[k].label}</Chip>;

/* ---------------------------------------------------------------- side panel */
function Panel({ over, title, onClose, children, foot }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('[data-autofocus]')?.focus();
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className={s.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className={s.panel} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className={s.panelHead}>
          <div className={s.panelHeadText}>{over && <span className={s.panelOver}>{over}</span>}<h2 className={s.panelTitle} tabIndex={-1} data-autofocus>{title}</h2></div>
          <button type="button" className={s.iconBtn} aria-label="Close" onClick={onClose}><Icon name="X" size={18} /></button>
        </div>
        <div className={s.panelBody}>{children}</div>
        {foot && <div className={s.panelFoot}>{foot}</div>}
      </aside>
    </div>
  );
}
function Block({ title, children }) {
  return <section className={s.block}><h3 className={s.blockTitle}>{title}</h3>{children}</section>;
}
function Facts({ rows }) {
  return <dl className={s.facts}>{rows.filter((r) => r && r[1]).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>;
}

/* ---------------------------------------------------------------- charts */

/** Scheduled against needed, hour by hour. Only the hours that are off, the peak and the picked hour are at full strength. */
function CoverageChart({ svc, sel, onSel, compact = false }) {
  const max = Math.max(...svc.hours.flatMap((h) => [h.sched, h.need]), 1);
  const peakAt = svc.hours.reduce((b, h, i) => ((h.covers ?? -1) > (svc.hours[b].covers ?? -1) ? i : b), 0);
  const hasCovers = svc.hours.some((h) => h.covers != null);
  return (
    <div className={compact ? `${s.bars} ${s.barsCompact}` : s.bars} role="group" aria-label={`Servers scheduled and needed by hour, ${svc.label}`}>
      {svc.hours.map((h, i) => {
        const gap = h.sched - h.need;
        const peak = hasCovers && i === peakAt;
        const Tag = onSel ? 'button' : 'div';
        return (
          <Tag key={h.label} type={onSel ? 'button' : undefined} className={`${s.barCol} ${sel === i ? s.barColOn : ''} ${gap === 0 && !peak && sel !== i ? s.barQuiet : ''}`} aria-pressed={onSel ? sel === i : undefined} onClick={onSel ? () => onSel(i) : undefined}
            aria-label={`${h.label}: ${h.sched} scheduled, ${h.need} needed${gap < 0 ? `, ${-gap} short` : gap > 0 ? `, ${gap} spare` : ''}${peak ? ', peak demand' : ''}`}>
            <span className={`${s.barGap} ${gap < 0 ? s.gapShort : gap > 0 ? s.gapSpare : s.gapPeak}`}>{gap < 0 ? `${-gap} short` : gap > 0 ? `${gap} spare` : peak && !compact ? 'Peak' : ''}</span>
            <span className={s.barPair}>
              <span className={s.barSched} style={{ height: `${(h.sched / max) * 100}%` }}>
                {gap > 0 && <i className={s.barSpare} style={{ height: `${(gap / h.sched) * 100}%` }} />}
                <b>{h.sched}</b>
              </span>
              <span className={`${s.barNeed} ${gap < 0 ? s.barNeedShort : ''}`} style={{ height: `${(h.need / max) * 100}%` }}><b>{h.need}</b></span>
            </span>
            <span className={s.barLbl}>{h.label}</span>
          </Tag>
        );
      })}
    </div>
  );
}
function ChartKey() {
  return (
    <div className={s.key}>
      <span><i className={s.kSched} />Scheduled</span>
      <span><i className={s.kNeed} />Needed</span>
      <span><i className={s.kShort} />Short</span>
      <span><i className={s.kSpare} />Spare</span>
    </div>
  );
}

/** Weekday by hour. `mode` picks the meaning: a neutral scale, or red for short and amber for spare. */
function Grid({ grid, mode, fmt, day, sel, onSel }) {
  const vals = grid.rows.flatMap((r) => r.cells).filter((v) => v != null);
  const max = Math.max(...vals.map(Math.abs), 1);
  return (
    <div className={s.heatWrap} tabIndex={0} role="group" aria-label={`${MODES[mode]}, weekday by hour`}>
      <table className={s.heat}>
        <thead><tr><th />{grid.hours.map((h) => <th key={h.hour} scope="col">{h.label.replace(' ', '')}</th>)}</tr></thead>
        <tbody>
          {grid.rows.map((r, ri) => (
            <tr key={r.day} className={r.day === day ? s.heatRowOn : undefined}>
              <th scope="row">{r.day}</th>
              {r.cells.map((v, ci) => {
                if (v == null) return <td key={ci}><span className={s.cellNone}>·</span></td>;
                const k = Math.abs(v) / max;
                const on = sel && sel.day === r.day && sel.ci === ci;
                const cls = mode === 'gap' ? (v < 0 ? s.cellShort : v > 0 ? s.cellSpare : s.cellZero) : k > 0.55 ? s.cellDark : '';
                return (
                  <td key={ci}>
                    <button type="button" className={`${s.cell} ${cls} ${on ? s.cellOn : ''}`} style={{ '--k': `${Math.round(8 + k * 82)}%` }} aria-pressed={!!on} onClick={() => onSel({ day: r.day, ri, ci })}
                      aria-label={`${dayName(r.day)} ${grid.hours[ci].label}: ${fmt(v, true)}`}>{fmt(v)}</button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeekBars({ series, fmt }) {
  const max = Math.max(...series.map((x) => x.value), 1);
  return (
    <div className={s.weeks} role="img" aria-label={`Last ${series.length} weeks`}>
      {series.map((w, i) => (
        <span key={w.weekEnd} className={s.weekCol}>
          <span className={s.weekVal}>{i === series.length - 1 || i === 0 ? fmt(w.value) : ''}</span>
          <span className={`${s.weekBar} ${i === series.length - 1 ? s.weekBarNow : ''}`} style={{ height: `${(w.value / max) * 100}%` }} />
          <span className={s.weekLbl}>{fmtDay(w.weekEnd)}</span>
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- panels */

function HoursTable({ svc }) {
  return (
    <table className={s.table}>
      <thead><tr><th>Hour</th><th className={s.r}>Covers</th><th className={s.r}>Scheduled</th><th className={s.r}>Needed</th><th className={s.r}>Off by</th></tr></thead>
      <tbody>{svc.hours.map((h) => { const g = h.sched - h.need; return (
        <tr key={h.label}><td>{h.label}</td><td className={s.r}>{h.covers ?? '—'}</td><td className={s.r}>{h.sched}</td><td className={s.r}>{h.need}</td>
          <td className={`${s.r} ${g < 0 ? s.tShort : g > 0 ? s.tSpare : ''}`}>{g < 0 ? `${-g} short` : g > 0 ? `${g} spare` : '—'}</td></tr>
      ); })}</tbody>
    </table>
  );
}

function impactText(m) {
  if (m.kind === 'candidate') return `${cvMoney(m.value)} ${m.prevent ? 'of overtime avoided this week' : 'a week, projected'}`;
  if (m.cost == null) return m.hours ? `${hrs(m.hours)} of server time` : null;
  return m.cost >= 0 ? `${signed(m.cost)} estimated labor cost a week` : `Up to ${cvMoney(-m.cost)} a week, projected`;
}

function MovePanel({ m, svc, trust, state, own, plan, task, onPlan, onSkip, onUndo, onClose, cv }) {
  const ap = m.kind === 'draft' ? cvApproval(m.approval) : null;
  const canCut = own && m.kind === 'spare' && plan?.cutFrom != null;
  let primary = null;
  if (m.kind === 'draft') primary = <Button className={s.panelPrimary} iconRight="ArrowRight" onClick={() => { onClose(); cv.approve(m.approval); }}>Review and publish</Button>;
  else if (canCut) primary = task ? <Chip tone="good" icon="CircleCheck">Approved. The steps are on Today.</Chip> : <Button className={s.panelPrimary} onClick={() => onPlan(m, { cut: true })}>Approve for next {dayName(svc.day)}</Button>;
  else if (state === 'planned') primary = <Chip tone="good" icon="CircleCheck">Plan recorded. Your live schedule is unchanged.</Chip>;
  else primary = <Button className={s.panelPrimary} onClick={() => onPlan(m)}>Record plan</Button>;
  return (
    <Panel over={`${STAGES[m.stage].label} · ${m.where}`} title={m.title} onClose={onClose} foot={(
      <>
        {primary}
        <div className={s.panelMore}>
          {state ? <button type="button" className={s.textBtn} onClick={() => onUndo(m)}><Icon name="Undo2" size={15} />Undo</button> : <button type="button" className={s.textBtn} onClick={() => onSkip(m)}>Not for us</button>}
          {m.finding && <button type="button" className={s.textBtn} onClick={() => cv.go('finding', { id: m.finding })}>Open the full finding<Icon name="ChevronRight" size={15} /></button>}
        </div>
      </>
    )}>
      <p className={s.blockText}>{m.body}</p>
      <Block title="The change">
        <Facts rows={[
          ['Do this', m.title],
          ['Affects', `${m.group} · ${m.where}`],
          [m.kind === 'candidate' ? 'Projected impact' : m.cost != null && m.cost < 0 ? 'Projected impact' : 'Estimated cost', impactText(m) && <span className={s.factMoney}>{impactText(m)} <Claim k={m.kind === 'candidate' ? m.claim : 'est'} /></span>],
          m.kind === 'candidate' && !m.prevent && ['Likely range', m.lo < 0 ? `From losing ${cvMoney(-m.lo)} to gaining ${cvMoney(m.hi)}` : `${cvMoney(m.lo)} to ${cvMoney(m.hi)} a week`],
          ['Expected outcome', m.outcome],
          m.cost != null && ['Cost basis', 'Hours × the average server wage. Wages only: payroll taxes, tips and overtime are not included.'],
          ['Risk', m.risk],
          m.minutes > 0 && ['Your time', `About ${m.minutes} minutes`],
        ]} />
      </Block>
      <Block title="How we know">
        <Facts rows={[
          trust.confidence && ['Confidence', <Chip key="c" tone={trust.confidence === 'High' ? 'good' : trust.confidence === 'Medium' ? 'mute' : 'warn'}>{trust.confidence}</Chip>],
          ['Based on', trust.basis],
          ['Inputs', trust.inputs],
          ['Data quality', trust.quality],
          ['Last updated', trust.updated],
          ['Measured or estimated', trust.observed],
        ]} />
      </Block>
      {(m.kind === 'cover' || m.kind === 'spare') && svc && (
        <>
          <Block title={`${svc.label}, servers by hour`}><CoverageChart svc={svc} compact /><ChartKey /></Block>
          <Block title="Hour by hour"><HoursTable svc={svc} /></Block>
        </>
      )}
      {ap && (
        <Block title="What changes">
          <table className={s.table}><thead><tr><th>When</th><th>Now</th><th>Draft</th></tr></thead>
            <tbody>{ap.diff.map(([w, a, b]) => <tr key={w}><td>{w}</td><td className={s.was}>{a}</td><td><b>{b}</b></td></tr>)}</tbody></table>
        </Block>
      )}
      <p className={s.blockNote}>Recording a plan saves your decision. It never publishes or changes a schedule, and nothing counts as saved until a test verifies it.</p>
    </Panel>
  );
}

function CostPanel({ d, target, group, onClose }) {
  const lab = weeklySeries(d.room, 'labour').slice(-8);
  const net = weeklySeries(d.room, 'net').slice(-8);
  const share = lab.map((w, i) => ({ weekEnd: w.weekEnd, value: net[i]?.value ? w.value / net[i].value : 0 }));
  const roles = costByRole(d.room.staff);
  const top = roles.roles[0]?.cost || 1;
  return (
    <Panel over={`Week ending ${lab.length ? fmtDay(lab.at(-1).weekEnd) : ''} · All hourly labor`} title="Labor cost" onClose={onClose}>
      <div className={s.panelMoney}>
        <span className={s.panelMoneyLabel}>Hourly labor paid, this week</span>
        <span className={s.panelFig}>{cvMoney(Math.round(d.week.labour))}</span>
        <span className={s.panelClaim}><Claim k="obs" />{pct1(d.week.labourRate)} of {cvMoney(Math.round(d.week.net))} net sales.{target ? ` Your target is ${pct1(target)}.` : group != null ? ` Your locations together run ${pct1(group)}.` : ''}</span>
      </div>
      {roles.roles.length > 0 && (
        <Block title="By role, this week">
          <ul className={s.roles}>
            {roles.roles.map((r) => (
              <li key={r.role}><span className={s.roleName}>{r.role}<small>{r.foh ? 'Front of house' : 'Kitchen'} · {Math.round(r.hours)} h</small></span>
                <span className={s.roleTrack}><i style={{ width: `${(r.cost / top) * 100}%` }} /></span><b>{cvMoney(Math.round(r.cost))}</b></li>
            ))}
          </ul>
          <p className={s.blockNote}>Front of house {cvMoney(Math.round(roles.foh))} · Kitchen {cvMoney(Math.round(roles.boh))}. Salaried managers aren’t in hourly labor.</p>
        </Block>
      )}
      {lab.length > 1 && <Block title={`Labor cost, last ${lab.length} weeks`}><WeekBars series={lab} fmt={(v) => cvMoney(Math.round(v))} /></Block>}
      {share.length > 1 && <Block title={`Labor as a share of sales, last ${share.length} weeks`}><WeekBars series={share} fmt={pct1} /></Block>}
      {!target && <p className={s.blockNote}>No labor target is set for this location. Add one on Data inputs (Location profile) to see how far off it is.</p>}
    </Panel>
  );
}

function DataPanel({ feed, own, entries, today, weekFrom, weekTo, onSave, onRemove, onClose, cv }) {
  const [f, setF] = React.useState({ date: today, cost: '', hours: '', sched: '' });
  const [err, setErr] = React.useState(null);
  const tot = entryTotals(entries, weekFrom, weekTo);
  const live = feed?.state === 'healthy';
  const off = feed?.state === 'off' || !feed;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    const r = checkEntry(f, { today });
    if (!r.ok) { setErr(r.error); return; }
    setErr(null); onSave(r.entry); setF({ date: f.date, cost: '', hours: '', sched: '' });
  };
  return (
    <Panel over="Where the numbers come from" title="Update labor data" onClose={onClose}>
      <Block title="Schedule and clock-ins">
        <div className={s.feed}>
          <Chip tone={live ? 'good' : off ? 'mute' : 'warn'} icon={live ? 'CircleCheck' : off ? 'Plug' : 'TriangleAlert'}>{live ? 'Connected' : off ? 'Not connected' : 'Needs attention'}</Chip>
          <span className={s.feedText}><b>7shifts</b>{feed?.last ? ` · ${feed.last}` : ''}</span>
          <button type="button" className={s.outBtn} onClick={() => cv.go('connect')}>{live ? 'Manage' : 'Connect'}<Icon name="ChevronRight" size={15} /></button>
        </div>
        {feed?.note && <p className={s.blockNote}>{feed.note}</p>}
        <p className={s.blockNote}>{own ? 'Sales and covers come from your Toast data.' : 'This is the sample restaurant group, so its schedule is sample data.'} When a feed is missing or down, enter the day by hand below.</p>
      </Block>
      <Block title="Enter a day by hand">
        <form className={s.entry} onSubmit={submit}>
          <label className={s.field}><span>Date</span><input type="date" value={f.date} max={today} onChange={set('date')} required /></label>
          <label className={s.field}><span>Labor cost ($)</span><input type="number" inputMode="decimal" min="0" step="0.01" value={f.cost} onChange={set('cost')} placeholder="1,290" /></label>
          <label className={s.field}><span>Hours worked</span><input type="number" inputMode="decimal" min="0" step="0.25" value={f.hours} onChange={set('hours')} placeholder="86" /></label>
          <label className={s.field}><span>Hours scheduled</span><input type="number" inputMode="decimal" min="0" step="0.25" value={f.sched} onChange={set('sched')} placeholder="84" /></label>
          <button type="submit" className={s.outBtn}><Icon name="Plus" size={15} />Save this day</button>
          {err && <p className={s.entryErr} role="alert">{err}</p>}
        </form>
      </Block>
      <Block title={`Entered by hand, ${fmtDay(weekFrom)} to ${fmtDay(weekTo)}`}>
        {tot.days === 0 ? <p className={s.blockNote}>Nothing entered for this week.</p> : (
          <p className={s.blockText}><b>{tot.days} of 7 days.</b>{tot.cost != null ? ` Labor cost ${cvMoney(Math.round(tot.cost))}.` : ''}{tot.hours != null ? ` ${tot.hours} hours worked.` : ''}{tot.sched != null ? ` ${tot.sched} hours scheduled.` : ''}</p>
        )}
        {entries.length > 0 && (
          <ul className={s.entryList}>
            {entries.slice(0, 14).map((e) => (
              <li key={e.date}><span className={s.entryDate}>{fmtDay(e.date)}</span>
                <span className={s.entryVals}>{[e.cost != null && cvMoney(Math.round(e.cost)), e.hours != null && `${e.hours} h worked`, e.sched != null && `${e.sched} h scheduled`].filter(Boolean).join(' · ')}</span>
                <button type="button" className={s.iconBtn} aria-label={`Remove ${fmtDay(e.date)}`} onClick={() => onRemove(e.date)}><Icon name="Trash2" size={15} /></button></li>
            ))}
          </ul>
        )}
        <p className={s.blockNote}>Hand-entered days are kept for your records and shown as entered by hand. They don’t change the staffing math above, which needs servers and covers by the hour.</p>
      </Block>
    </Panel>
  );
}

/** Average ticket minutes by hour for one day, against the target. Hours over target are red. */
function KitchenChart({ cells, target }) {
  const rows = cells.filter(Boolean);
  const max = Math.max(...rows.map((c) => c.min), target) * 1.08;
  return (
    <div className={s.kWrap} role="group" aria-label={`Average ticket time by hour, target ${target} minutes`}>
      <span className={s.kTarget} style={{ bottom: `calc(26px + (100% - 50px) * ${target / max})` }}><i>Target {target} min</i></span>
      <div className={s.kBars}>
        {rows.map((c) => (
          <span key={c.hour} className={s.kCol} role="img" aria-label={`${c.label}: ${c.min} minutes a ticket, ${c.tickets} tickets${c.over ? `, ${c.over} over target` : ''}`}>
            <span className={`${s.kVal} ${c.over ? s.gapShort : ''}`}>{c.min.toFixed(0)}</span>
            <span className={s.kTrack}><span className={`${s.kBar} ${c.over ? s.kBarOver : ''}`} style={{ height: `${(c.min / max) * 100}%` }} /></span>
            <span className={s.barLbl}>{c.label.replace(' ', '')}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function KitchenPanel({ day, cells, target, crew, weeks, onSave, onClear, onClose }) {
  const [f, setF] = React.useState(() => Object.fromEntries(Object.entries(crew || {}).map(([k, v]) => [k, String(v)])));
  const [err, setErr] = React.useState(null);
  const line = lineCheck(cells, crew);
  const submit = (e) => { e.preventDefault(); const r = checkCrew(f); if (!r.ok) { setErr(r.error); return; } setErr(null); onSave(r.crew); };
  return (
    <Panel over={`${dayName(day)} · Kitchen · Average of the last ${weeks} weeks`} title="Kitchen, hour by hour" onClose={onClose}>
      <p className={s.blockText}>Enter the cooks on the line for each hour. A slow hour where each cook carried more tickets than usual is a <b>people problem</b>. A slow hour at a normal load is a <b>station problem</b>, and another cook won’t fix it.</p>
      <form onSubmit={submit}>
        <table className={s.table}>
          <thead><tr><th>Hour</th><th className={s.r}>Tickets</th><th className={s.r}>Ticket time</th><th className={s.r}>Cooks</th><th className={s.r}>Per cook</th><th>Reads as</th></tr></thead>
          <tbody>{line.rows.map((c) => (
            <tr key={c.hour}><td>{c.label}</td><td className={s.r}>{c.tickets}</td><td className={`${s.r} ${c.over ? s.tShort : ''}`}>{c.min} min</td>
              <td className={s.r}><input className={s.cookIn} type="number" inputMode="decimal" min="0" max="40" step="0.5" aria-label={`Cooks on the line at ${c.label}`} value={f[c.hour] ?? ''} onChange={(e) => setF((x) => ({ ...x, [c.hour]: e.target.value }))} /></td>
              <td className={s.r}>{c.perCook ?? '—'}</td>
              <td>{c.read === 'stretched' ? <Chip tone="bad">People</Chip> : c.read === 'station' ? <Chip tone="warn">Station</Chip> : c.over ? <span className={s.tMute}>Add cooks</span> : '—'}</td></tr>
          ))}</tbody>
        </table>
        <div className={s.crewActs}>
          <button type="submit" className={s.outBtn}><Icon name="Check" size={15} />Save {dayName(day)}’s line</button>
          {crew && <button type="button" className={s.textBtn} onClick={() => { setF({}); onClear(); }}>Clear this day</button>}
        </div>
        {err && <p className={s.entryErr} role="alert">{err}</p>}
      </form>
      {line.usual != null && <p className={s.blockNote}>Usual load on {dayName(day)}: {line.usual} tickets per cook an hour (the middle of the hours you entered).</p>}
      <p className={s.blockNote}>Tickets and ticket times are observed, averaged over the last {weeks} weeks. Cooks on the line are entered by hand until a schedule feed carries kitchen roles. Target: {target} minutes a ticket. Nothing here changes a schedule.</p>
    </Panel>
  );
}

function ChecksPanel({ checks, own, weeks, onClose }) {
  return (
    <Panel over="The page checking its own math" title="How these numbers are checked" onClose={onClose}>
      <ul className={s.checks}>
        {checks.map((c) => (
          <li key={c.key}>
            <span className={c.ok ? s.ckOk : c.ok === false ? s.ckBad : s.ckNa}><Icon name={c.ok ? 'CircleCheck' : c.ok === false ? 'TriangleAlert' : 'CircleDashed'} size={18} /></span>
            <span><b>{c.label}</b><small>{c.ok ? 'Passes. ' : c.ok === false ? 'Doesn’t pass. ' : 'Not run. '}{c.detail}</small></span>
          </li>
        ))}
      </ul>
      <Block title="What this page does not do yet">
        <Facts rows={[
          ['Demand', `${own ? 'This view uses your typical guests by hour from past weeks' : 'This week uses actual guests by hour'}. Next week uses the shared forecast, held against the schedule you run now.`],
          ['Cost', 'Hours × average wage. Payroll taxes, tips and overtime premiums are not included, so real cost is higher.'],
          ['Kitchen staffing', `Ticket times are observed (${weeks}-week average). Cooks by the hour are entered by hand.`],
          ['Confidence', 'High needs 8 or more weeks behind the hour and a current schedule. Medium needs 4. It is a rule of thumb, not a measured error rate.'],
        ]} />
      </Block>
    </Panel>
  );
}

function Empty({ title, text, cta, on }) {
  return (
    <div className={s.empty}>
      <Icon name="CircleDashed" size={22} />
      <b>{title}</b>
      <span>{text}</span>
      {cta && <button type="button" className={s.outBtn} onClick={on}>{cta}<Icon name="ChevronRight" size={15} /></button>}
    </div>
  );
}

/* ================================================================ the page */

/**
 * The shared forecast for this room. Signed in, it is the server's (the same
 * call the Service page makes); in the browser-only demo it is computed from
 * the sample. Null while loading, when there is too little history, or when
 * the call fails: the next-week card then stays hidden.
 */
function useForecast(room, roomId, useServer, own) {
  const [srv, setSrv] = React.useState(/** @type {any} */ (null));
  React.useEffect(() => {
    if (!useServer) return undefined;
    let stop = false;
    setSrv(null);
    fetch(`/api/forecast?room=${encodeURIComponent(roomId)}&days=14`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).then((b) => { if (!stop) setSrv(b?.forecast?.ready ? b.forecast : null); }).catch(() => { if (!stop) setSrv(null); });
    return () => { stop = true; };
  }, [roomId, useServer]);
  const local = React.useMemo(() => {
    if (useServer || own) return null;
    try { const f = covercastRoom(room); return f.ready ? f : null; } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, useServer, own]);
  return useServer ? srv : local;
}

const servicesOf = (room) => (room.fromToast ? planServices(Object.fromEntries(DAYS.map((x) => [x, tonightPlan(room, x)]))) : sampleServices(room.labour));

function CvLabour() {
  const cv = useCv();
  const eng = useEngine();
  useTodayTheme(!!cv.tools);
  const d = CV_D, room = d.room, own = !!room.fromToast;
  const dense = useDense();

  const plans = own ? Object.fromEntries(DAYS.map((x) => [x, tonightPlan(room, x)])) : null;
  const services = servicesOf(room);
  const week = weekDays(services);
  const totals = weekTotals(week);
  const summary = weekSummary(week);
  const worst = summary.shortage || summary.excess || null;

  const [view, setView] = useSaved('labour.view', cv.role === 'gm' ? 'gm' : 'owner', { person: true });
  const [dayPick, setDayPick] = React.useState(null);
  const sel = week.find((x) => x.day === dayPick) || worst || week[0];
  const svc = sel.svc;
  const [hourSel, setHourSel] = React.useState(null);
  const hour = svc && hourSel != null ? svc.hours[hourSel] : null;

  const [saved, setSaved] = useSaved('labour.moves', {});
  const [entries, setEntries] = useSaved('labour.entries', []);
  const [crew, setCrew] = useSaved('labour.crew', {});
  const [open, setOpen] = React.useState(null); // { kind: 'move' | 'cost' | 'data' | 'kitchen' | 'checks', id? }
  const [showAll, setShowAll] = React.useState(false);
  const [patterns, setPatterns] = React.useState(false);
  const [mode, setMode] = React.useState('cps');
  const [cell, setCell] = React.useState(null);

  const wage = own ? plans?.[sel.day]?.wage ?? null : serverWage(room.staff);
  const all = movesOf({ services, candidates: d.candidates, draft: own ? null : room.labour?.draft, wage });
  const split = splitMoves(all, saved);
  const live = [...split.open, ...split.planned];
  const forDay = live.filter((m) => m.day === sel.day);
  const rest = [...live.filter((m) => m.day !== sel.day), ...(showAll ? split.skipped : [])];
  const restShown = showAll ? rest : rest.slice(0, Math.max(0, 3 - forDay.length));
  const openMove = open?.kind === 'move' ? all.find((m) => m.id === open.id) : null;
  const moveSvc = (m) => services.find((x) => x.key === m?.svc) || null;

  const feed = d.feeds.find((f) => f.name === '7shifts') || null;
  const held = !!feed && feed.state !== 'healthy' && feed.state !== 'off' && !own;
  const rate = own ? plans?.[sel.day]?.rate ?? null : room.labour?.kpis?.rate ?? null;
  const weeksFor = (m) => (own ? Math.min(...(plans?.[m.svc]?.hours || []).map((h) => h.weeks || 0), Infinity) : dense ? HOURLY_WEEKS : null);
  const trust = (m) => { const w = weeksFor(m); return trustOf(m, { weeks: Number.isFinite(w) ? w : null, feed, rate, own }); };

  const target = d.profile?.laborTarget > 0 ? d.profile.laborTarget : null;
  const rows = CV_GROUP?.rows || [];
  const group = rows.length > 1 ? groupShare(rows.map((r) => ({ net: r.d.week.net, labour: r.d.week.labour }))) : null;
  const labWeeks = weeklySeries(room, 'labour');
  const weekTo = labWeeks.at(-1)?.weekEnd || CV_NOW.iso;
  const weekFrom = addDays(weekTo, -6);
  const period = `Week of ${fmtDay(weekFrom)} to ${fmtDay(weekTo)}`;
  const roles = costByRole(room.staff);

  const proofs = own ? [] : d.proofs.filter((p) => p.lever === 'Labour');
  const tests = own ? (eng.windows || []).filter((w) => w.roomId === d.id && (w.lever === 'labour' || w.lever === 'overtime')) : [];
  const results = [
    ...proofs.map((p) => ({ id: p.id, title: p.title, stage: stageOf(p.outcome), note: p.outcome === 'limited' ? 'With limits' : p.outcome === 'testing' ? p.checkpoint || p.held : p.outcome === 'reversed' ? p.held : `Held ${p.held}`, fig: p.outcome === 'testing' ? null : p.bookable || 0, day: dayOfTitle(p.title) })),
    ...tests.map((w) => ({ id: w.id, title: w.title, stage: w.status === 'verified' ? 'verified' : w.status === 'running' ? 'testing' : stageOf(w.status), note: w.status === 'running' ? `Day ${w.day} of 28` : '', fig: w.status === 'verified' ? Math.round(w.bookedCents / 100) : null, day: dayOfTitle(w.title) })),
  ].sort((a, b) => (b.day === sel.day) - (a.day === sel.day));
  const banked = results.find((r) => r.stage === 'verified' && r.fig > 0) || null;

  const grids = {
    cps: own ? loadGridFromPlans(plans) : services.length ? loadGridFromServices(services) : null,
    gap: services.length ? gapGrid(services) : null,
  };

  /* Next week from the shared forecast: the server's copy when signed in (a room's own Toast days, its hand-entered signals and feeds), else computed here from the sample. */
  const cast = useForecast(room, d.id, eng.mode === 'server', own);
  const ahead = cast && services.length ? forecastWeek(cast.covers.days.slice(0, 7).map((x) => { const sp = shiftPulseDay(cast, x.iso); return { iso: x.iso, weekday: x.weekday, hours: [...(sp?.lunch?.hours || []), ...(sp?.dinner?.hours || [])] }; }), services) : null;
  const miss = cast?.accuracy?.covers?.days?.horizons?.[1]?.covercast || null;

  const depts = deptSplit(room.staff, { net: d.week.net, covers: d.week.covers }, room.levers?.ot);
  const kit = kitchenLoad(dense?.hours, room.tickets?.target);
  const kitDay = kit?.rows.find((r) => r.day === sel.day) || null;
  const dayCrew = crew?.[sel.day] || null;
  const line = kitDay && dayCrew ? lineCheck(kitDay.cells, dayCrew) : null;
  const stations = room.tickets?.stations || [];
  const checks = mathChecks({ services: own ? [] : services, rate, roles, weekLabour: d.week.labour, totals: own ? null : totals, kpis: own ? null : room.labour?.kpis, feed });
  const ran = checks.filter((c) => c.ok != null);
  const follow = followUps(saved, all);
  const modes = Object.keys(MODES).filter((k) => grids[k]?.rows.length);
  const gmode = modes.includes(mode) ? mode : modes[0];
  const grid = gmode ? grids[gmode] : null;
  const gfmt = (v, long) => (gmode === 'cps' ? `${v.toFixed(1)}${long ? ' covers per server-hour' : ''}` : v === 0 ? (long ? 'on track' : '0') : long ? `${Math.abs(v)} ${v < 0 ? 'short' : 'spare'}` : `${v < 0 ? '−' : '+'}${Math.abs(v)}`);
  const gsel = grid && cell && grid.rows[cell.ri]?.day === cell.day && grid.rows[cell.ri].cells[cell.ci] != null ? cell : null;
  const weak = week.filter((x) => x.cov?.short).sort((a, b) => b.cov.short - a.cov.short).slice(0, 2);

  const pickDay = (day) => { setDayPick(day); setHourSel(null); setCell(null); };
  const toChart = () => document.getElementById('labor-hours')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const mark = (m, st) => setSaved((cur) => { const next = { ...(cur || {}) }; if (st) next[m.id] = { s: st, at: new Date().toISOString(), t: String(m.title).slice(0, 160) }; else delete next[m.id]; return next; }, `Labor: ${st ? (st === 'planned' ? 'recorded a plan for' : 'not for us:') : 'reopened'} "${m.title}"`);
  const cutTask = (m) => { const p = plans?.[m.svc]; const id = p?.cutFrom != null ? `cut:${m.svc}:${p.cutFrom}` : null; return id ? { id, task: (eng.tasks || []).find((t) => t.roomId === d.id && t.approvalId === id && t.status !== 'cancelled') } : { id: null, task: null }; };
  const onPlan = async (m, { cut } = {}) => {
    if (cut) {
      const p = plans[m.svc], sv = moveSvc(m), { id } = cutTask(m);
      const at = p.hours.find((h) => h.hour === p.cutFrom), n = Math.round(at.servers);
      const from = sv.hours[p.hours.indexOf(at)].label;
      await engine.createTask(id, { title: `${m.svc}: one fewer server from ${from} to close`, system: '7shifts', diff: [[`${m.svc} ${from} to close`, `${n} servers`, `${n - 1} servers`]] });
      cv.toast('Approved. The steps for 7shifts are on Today.');
      return;
    }
    mark(m, 'planned'); setOpen(null); cv.toast('Plan recorded. Your live schedule is unchanged.');
  };

  /* The hero follows the picked day and switches between five states. */
  const dayMove = (kind) => all.find((m) => m.svc === svc?.key && m.kind === kind);
  const lead = svc ? svc.label : dayName(sel.day);
  let hero;
  if (!services.length) {
    hero = { state: 'Missing data', tone: 'mute', icon: 'CircleDashed', title: 'Add staff hours to see where staffing missed demand.', text: 'This needs servers on the floor and covers by the hour. Connect 7shifts, add time entries to your Toast upload, or enter the day by hand.', cta: 'Add labor data', onCta: () => setOpen({ kind: 'data' }) };
  } else if (held) {
    hero = { state: 'Check the schedule first', tone: 'warn', icon: 'TriangleAlert', title: `Confirm the schedule before changing ${lead}.`, text: `7shifts last updated ${feed.last}, so staffing suggestions are on hold. Reconnect it, or enter the hours by hand.`, cta: 'Update schedule data', onCta: () => setOpen({ kind: 'data' }), alt: svc ? 'See the hours' : null, onAlt: toChart };
  } else if (sel.status === 'missing') {
    hero = { state: 'Missing data', tone: 'mute', icon: 'CircleDashed', title: `No hour-by-hour staffing for ${dayName(sel.day)} yet.`, text: 'Other days are ready. Add servers and covers by the hour for this day to see whether it’s short or overstaffed.', cta: 'Add labor data', onCta: () => setOpen({ kind: 'data' }) };
  } else if (sel.status === 'short') {
    const m = dayMove('cover');
    hero = { state: 'Urgent staffing issue', tone: 'bad', icon: 'TriangleAlert', title: `You’re short ${sel.cov.shortAt.every((x) => x.by === sel.cov.shortAt[0].by) ? '' : 'up to '}${Math.max(...sel.cov.shortAt.map((x) => x.by))} ${Math.max(...sel.cov.shortAt.map((x) => x.by)) === 1 ? 'server' : 'servers'} at ${lead}.`, text: <>{lead} runs <b>{shortPhrase(sel.cov.shortAt)}</b>.</>, change: m.title, impact: impactText(m), cta: 'Review and record plan', onCta: () => setOpen({ kind: 'move', id: m.id }), alt: 'See the hours', onAlt: toChart, move: m };
  } else if (sel.status === 'spare') {
    const m = dayMove('spare');
    hero = { state: 'Savings opportunity', tone: 'warn', icon: 'CircleAlert', title: `${lead} has ${hrs(sel.cov.spare)} more than it needed.`, text: <>No hour is short. <b>{sel.cov.spare} server-{sel.cov.spare === 1 ? 'hour looks' : 'hours look'} spare</b> at {listOf(sel.cov.spareAt.map((x) => x.label))}.</>, change: m.title, impact: impactText(m), cta: 'Review and record plan', onCta: () => setOpen({ kind: 'move', id: m.id }), alt: 'See the hours', onAlt: toChart, move: m };
  } else if (banked) {
    hero = { state: 'Result worth a look', tone: 'good', icon: 'BadgeCheck', title: `${lead} is on track, and a change is paying off.`, text: <>Every hour has the servers it needs. <b>{banked.title}</b> is verified at {cvMoney(banked.fig)} a week.</>, cta: 'See the evidence', onCta: () => cv.go('packet', { id: banked.id }), alt: 'See the hours', onAlt: toChart };
  } else {
    hero = { state: 'On track', tone: 'good', icon: 'CircleCheck', title: `${lead} is on track.`, text: 'Every hour has the servers it needs, and none look spare. Nothing to change.', alt: 'See the hours', onAlt: toChart };
  }
  const heroTrust = hero.move ? trust(hero.move) : null;
  const peak = svc && (sel.cov.short || sel.cov.spare) ? (() => { const i = svc.hours.findIndex((h) => (sel.cov.short ? h.sched < h.need : h.sched > h.need)); const a = Math.max(0, Math.min(i - 1, svc.hours.length - 4)); return { ...svc, hours: svc.hours.slice(a, a + 4) }; })() : svc;

  const drivers = weak.map((x) => x.svc.label);
  const tiles = [
    { k: 'spend', label: 'Labor cost', scope: 'All hourly labor', when: period, fig: cvMoney(Math.round(d.week.labour)), claim: 'obs', lines: [roles.total ? `Front of house ${cvMoney(Math.round(roles.foh))} · Kitchen ${cvMoney(Math.round(roles.boh))}` : 'Hourly labor paid'], on: () => setOpen({ kind: 'cost' }) },
    { k: 'share', label: 'Labor %', scope: 'All hourly labor', when: period, fig: pct1(d.week.labourRate), claim: 'obs', lines: [
      target ? `Target ${pct1(target)} · ${Math.abs((d.week.labourRate - target) * 100).toFixed(1)} pts ${d.week.labourRate > target ? 'above' : 'below'} target` : group != null ? `Your locations together: ${pct1(group)} · ${Math.abs((d.week.labourRate - group) * 100).toFixed(1)} pts ${d.week.labourRate > group ? 'above' : 'below'}` : 'No target set',
      !target && group != null ? 'No target set for this location' : null,
      drivers.length ? `Main driver: ${listOf(drivers)}` : null,
    ], tone: target && d.week.labourRate > target ? 'down' : '', on: () => setOpen({ kind: 'cost' }) },
    { k: 'gaps', label: 'Hours that need coverage', scope: 'Servers', when: own ? 'Typical week' : period, fig: services.length ? `${totals.short} h` : null, tone: totals.short > 0 ? 'down' : '', claim: 'mod', lines: [services.length ? `${totals.spare} h spare, in other hours` : 'Needs servers and covers by the hour', summary.shortage ? `Worst: ${summary.shortage.svc.label}` : services.length ? 'No day is short' : null], on: () => { if (summary.shortage) pickDay(summary.shortage.day); toChart(); } },
    { k: 'book', label: 'Verified savings', scope: 'Labor changes', when: 'This location', fig: banked ? cvMoney(banked.fig) : null, unit: banked ? 'a week' : '', tone: banked ? 'up' : '', claim: banked ? 'book' : 'none', lines: [banked ? banked.title : 'Nothing verified yet', banked ? banked.note : results.some((r) => r.stage === 'testing') ? `${results.filter((r) => r.stage === 'testing').length} in test` : 'Record a plan to start'], on: () => (banked ? cv.go('packet', { id: banked.id }) : cv.go('proof')) },
  ];

  /* ---- blocks, ordered by view below */
  const stripBlock = (
    <section key="strip" className={s.week} aria-label="This week, day by day">
      <div className={s.weekHead}><h2 className={s.sectionTitle}>This week</h2><span className={s.sectionSub}>{period} · Servers · Pick a day</span></div>
      <div className={s.strip} role="tablist" aria-label="Day">
        {week.map((x) => { const st = STATUS[x.status]; return (
          <button key={x.day} type="button" role="tab" aria-selected={x.day === sel.day} className={`${s.dayCard} ${x.day === sel.day ? s.dayOn : ''}`} onClick={() => pickDay(x.day)}>
            <span className={s.dayName}>{x.day}</span>
            <span className={`${s.dayStatus} ${s[`st_${st.tone}`]}`}><Icon name={st.icon} size={15} />{st.label}</span>
            <span className={s.dayNote}>{x.status === 'missing' ? 'No hourly data' : x.cov.short ? `${x.cov.short} h short` : x.cov.spare ? `${x.cov.spare} h spare` : 'Matches demand'}</span>
          </button>
        ); })}
      </div>
      <div className={s.summary}>
        {[
          ['Biggest shortage', summary.shortage, summary.shortage && `${hrs(summary.shortage.cov.short)} short`, 'No day is short', 'bad'],
          ['Most spare hours', summary.excess, summary.excess && `${hrs(summary.excess.cov.spare)} spare`, 'No spare hours', 'warn'],
          ['Best matched', summary.matched, summary.matched && (summary.matched.cov.spare ? `No short hours, ${summary.matched.cov.spare} spare` : 'Staffing matched demand'), 'No day fully matched', 'good'],
        ].map(([k, x, note, none, tone]) => (
          <button key={k} type="button" className={s.sumCell} disabled={!x} onClick={() => x && pickDay(x.day)}>
            <span className={s.sumKey}>{k}</span>
            <span className={`${s.sumVal} ${x ? s[`st_${tone}`] : ''}`}>{x ? x.svc.label : none}</span>
            {x && <span className={s.sumNote}>{note}</span>}
          </button>
        ))}
        <div className={s.sumCell}>
          <span className={s.sumKey}>Missing data</span>
          <span className={s.sumVal}>{summary.missing.length ? listOf(summary.missing.map(dayName)) : 'None'}</span>
          <span className={s.sumNote}>{summary.missing.length ? 'No hourly staffing yet' : 'All 7 days have hourly staffing'}</span>
        </div>
      </div>
    </section>
  );

  const heroBlock = (
    <section key="hero" className={`${s.hero} ${s[`hero_${hero.tone}`]}`} aria-label={`${dayName(sel.day)}: what matters most`}>
      <div className={s.heroMain}>
        <div className={s.heroTop}><Chip tone={hero.tone} icon={hero.icon}>{hero.state}</Chip><span className={s.heroDay}>{dayName(sel.day)}{worst?.day === sel.day ? ' · Needs the most attention this week' : ''}</span></div>
        <h2 className={s.heroTitle}>{hero.title}</h2>
        <p className={s.heroText}>{hero.text}</p>
        {hero.change && <p className={s.heroChange}><Icon name="ArrowRight" size={17} /><span><b>{hero.change}</b>{hero.impact ? ` · ${hero.impact}` : ''}</span></p>}
        {(hero.cta || hero.alt) && (
          <div className={s.heroActs}>
            {hero.cta && <Button className={s.cta} iconRight="ArrowRight" onClick={hero.onCta}>{hero.cta}</Button>}
            {hero.alt && <button type="button" className={s.seeWhy} onClick={hero.onAlt}>{hero.alt}<Icon name="ChevronRight" size={16} /></button>}
          </div>
        )}
        {heroTrust && <span className={s.heroProof}><b>{heroTrust.confidence} confidence</b> · Based on {heroTrust.basis} · Data: {heroTrust.quality.toLowerCase()}</span>}
      </div>
      {peak && (
        <div className={s.signal} aria-label={`${svc.label} staffing`}>
          <div className={s.signalHead}><span className={s.signalTitle}>{svc.label} · Servers</span><span className={s.signalSub}>Scheduled against needed</span></div>
          <CoverageChart svc={peak} compact />
          <ChartKey />
        </div>
      )}
    </section>
  );

  const tilesBlock = (
    <section key="tiles" className={s.tiles} aria-label="Labor summary">
      {tiles.map((t) => (
        <button key={t.k} type="button" className={s.tile} onClick={t.on}>
          <span className={s.tileLabel}>{t.label}</span>
          <span className={s.tileWhen}>{t.scope} · {t.when}</span>
          <span className={`${s.tileFig} ${t.tone ? s[t.tone] : ''} ${t.fig == null ? s.tileNone : ''}`}>{t.fig ?? '—'}{t.unit && t.fig != null && <small>{t.unit}</small>}</span>
          <span className={s.tileFoot}><Claim k={t.claim} /></span>
          {t.lines.filter(Boolean).map((l) => <span key={l} className={s.tileLine}>{l}</span>)}
          <Icon name="ChevronRight" size={16} className={s.tileChev} />
        </button>
      ))}
    </section>
  );

  const moveRow = (m) => { const st = saved?.[m.id]?.s; const t = trust(m); return (
    <li key={m.id}>
      <button type="button" className={`${s.move} ${st ? s.moveDone : ''}`} onClick={() => setOpen({ kind: 'move', id: m.id })}>
        <span className={`${s.moveIcon} ${s[`mi_${m.tone}`]}`}><Icon name={st === 'planned' ? 'CircleCheck' : MOVE_ICON[m.tone]} size={18} /></span>
        <span className={s.moveText}>
          <span className={s.moveTitle}>{m.title}</span>
          <span className={s.moveWorth}>{m.where} · {m.group}{impactText(m) ? ` · ${impactText(m)}` : ''}</span>
          <span className={s.moveMeta}>{st === 'planned' ? <Chip tone="good" icon="CircleCheck">Plan recorded</Chip> : st === 'skipped' ? <Chip tone="mute">Not for us</Chip> : <Stage k={m.stage} />}{t.confidence && !st && <span>{t.confidence} confidence</span>}</span>
        </span>
        <Icon name="ChevronRight" size={18} className={s.chev} />
      </button>
    </li>
  ); };

  const workBlock = (
    <div key="work" className={s.gridMain}>
      <section className={s.card} id="labor-hours" aria-label="Staffing by hour">
        <div className={s.cardHead}>
          <div><h2 className={s.cardTitle}>{svc ? svc.label : dayName(sel.day)}: where staffing missed demand</h2><p className={s.cardSub}>Servers scheduled against what the covers needed. Pick an hour.</p></div>
          <Chip tone="mute" icon="Users">Servers</Chip>
        </div>
        {!svc ? <Empty title={`No hour-by-hour staffing for ${dayName(sel.day)}`} text="Daily totals can’t show how many servers each hour needs. Add servers on the floor and covers by the hour." cta="Add labor data" on={() => setOpen({ kind: 'data' })} /> : (
          <>
            <ScheduleGrade day={{ sched: svc.hours.map((h) => h.sched), need: svc.hours.map((h) => h.need) }} />
            <CoverageChart svc={svc} sel={hourSel} onSel={setHourSel} />
            <ChartKey />
            <div className={s.cardFoot}>
              <div>
                <span className={s.sumStrong}>{hour ? `${hour.label}: ${hour.sched} scheduled, ${hour.need} needed${hour.covers != null ? `, ${hour.covers} covers` : ''}` : sel.cov.short || sel.cov.spare ? `${sel.cov.short ? `${hrs(sel.cov.short)} short` : ''}${sel.cov.short && sel.cov.spare ? ', ' : ''}${sel.cov.spare ? `${hrs(sel.cov.spare)} spare` : ''}` : 'Every hour matched demand'}</span>
                <span className={s.sumSub}><Claim k="mod" />Scheduled and covers are observed. Needed is modeled from your pace{rate ? ` of ${rate.toFixed(2)} covers per server-hour` : ''}.</span>
              </div>
            </div>
          </>
        )}
      </section>

      <section className={s.card} aria-label="What to do">
        <div className={s.cardHead}>
          <div><h2 className={s.cardTitle}>What to do</h2><p className={s.cardSub}>{dayName(sel.day)} first, then the rest of the week.</p></div>
          <Chip tone="mute">{split.open.length} open</Chip>
        </div>
        {held && <p className={s.caution}><Icon name="TriangleAlert" size={16} /><span>On hold until the schedule feed is current. You can still read each one.</span></p>}
        {all.length === 0 ? <Empty title="No recommendation right now" text={services.length ? 'Staffing matched demand this week. New suggestions appear here when an hour runs short or spare.' : 'Suggestions need servers and covers by the hour.'} cta={services.length ? null : 'Add labor data'} on={() => setOpen({ kind: 'data' })} /> : (
          <>
            <h3 className={s.listHead}>{dayName(sel.day)}</h3>
            {forDay.length ? <ul className={s.moves}>{forDay.map(moveRow)}</ul> : <p className={s.none}>{sel.status === 'missing' ? 'No hourly data for this day yet.' : 'Nothing to change on this day.'}</p>}
            {restShown.length > 0 && <><h3 className={s.listHead}>Rest of the week</h3><ul className={s.moves}>{restShown.map(moveRow)}</ul></>}
          </>
        )}
        <div className={s.cardFoot}>
          <span className={s.sumSub}>Opportunities only. Nothing here changes a live schedule or counts as saved.</span>
          {rest.length > restShown.length || showAll ? <button type="button" className={s.textLink} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${all.length}`}<Icon name={showAll ? 'ChevronUp' : 'ChevronDown'} size={15} /></button> : null}
        </div>
      </section>
    </div>
  );

  const resultsBlock = (
    <section key="results" className={s.card} aria-label="Results of labor changes">
      <div className={s.cardHead}>
        <div><h2 className={s.cardTitle}>Did the changes work?</h2><p className={s.cardSub}>Only verified savings count. Everything else is still being proven.</p></div>
      </div>
      <ol className={s.stages} aria-label="How a change becomes a saving">
        {['opportunity', 'testing', 'measured', 'verified'].map((k) => <li key={k}><Icon name={STAGES[k].icon} size={14} />{STAGES[k].label}</li>)}
      </ol>
      {results.length === 0 ? <Empty title="No changes made yet" text="Record a plan above, make the change, and a test compares it with matching services. Results show here with what was measured." /> : (
        <ul className={s.results}>
          {results.map((r) => (
            <li key={r.id}><button type="button" className={s.result} onClick={() => cv.go('packet', { id: r.id })}>
              <span className={s.resText}><span className={s.resTitle}>{r.title}</span><span className={s.moveMeta}><Stage k={r.stage} />{r.note && <span>{r.note}</span>}{r.day === sel.day && <span>· {dayName(sel.day)}</span>}</span></span>
              <span className={`${s.resFig} ${r.stage === 'verified' && r.fig ? s.up : s.resNone}`}>{r.fig == null ? '—' : cvMoney(r.fig)}{r.fig ? <small>a week</small> : r.stage === 'reversed' ? <small>removed</small> : r.fig == null ? <small>not measured yet</small> : null}</span>
              <Icon name="ChevronRight" size={18} className={s.chev} />
            </button></li>
          ))}
        </ul>
      )}
      {(follow.waiting.length > 0 || follow.closed.length > 0) && (
        <>
          <h3 className={s.listHead}>Plans you recorded</h3>
          <ul className={s.follow}>
            {follow.waiting.map((f) => <li key={f.id}><Chip tone="mute" icon="Hourglass">Checking</Chip><span><b>{f.title}</b><small>{f.where}. The gap is still in the latest numbers. This is checked again when the next {dayName(f.day)} comes in.</small></span></li>)}
            {follow.closed.map((f) => <li key={f.id}><Chip tone="good" icon="CircleCheck">Gap closed</Chip><span><b>{f.title}</b><small>The latest numbers no longer show this gap. It isn’t a saving until a test verifies it.</small></span></li>)}
          </ul>
        </>
      )}
      <div className={s.cardFoot}>
        <span className={s.sumSub}>This location’s labor changes.</span>
        <button type="button" className={s.textLink} onClick={() => cv.go('proof')}>Full history<Icon name="ChevronRight" size={15} /></button>
      </div>
    </section>
  );

  const aheadBlock = ahead && ahead.days.some((x) => x.hours.length) ? (
    <section key="ahead" className={s.card} aria-label="Next week, forecast">
      <div className={s.cardHead}>
        <div><h2 className={s.cardTitle}>Next week: will this schedule hold?</h2><p className={s.cardSub}>{fmtDay(ahead.days[0].iso)} to {fmtDay(ahead.days.at(-1).iso)} · Forecast guests against the schedule you run now · Servers</p></div>
        <Claim k="mod" />
      </div>
      <div className={s.heatWrap} tabIndex={0} role="group" aria-label="Next week by day">
        <table className={s.table}>
          <thead><tr><th>Day</th><th className={s.r}>Guests forecast</th><th className={s.r}>Likely range</th><th className={s.r}>Most servers needed</th><th>If you repeat this schedule</th></tr></thead>
          <tbody>{ahead.days.map((x) => (
            <tr key={x.iso} className={x.day === sel.day ? s.rowOn : undefined}>
              <td><button type="button" className={s.textLink} onClick={() => pickDay(x.day)}>{dayName(x.day)}, {fmtDay(x.iso)}</button></td>
              {x.hours.length ? <>
                <td className={s.r}><b>{x.covers}</b></td><td className={s.r}>{x.low} to {x.high}</td><td className={s.r}>{x.peak.need} at {x.peak.label}</td>
                <td>{x.short ? <span className={s.tShort}>{hrs(x.short)} short</span> : x.spare ? <span className={s.tSpare}>{hrs(x.spare)} spare</span> : 'Matches the forecast'}{x.short > 0 && x.spare > 0 ? <span className={s.tMute}> · {x.spare} spare in other hours</span> : null}</td>
              </> : <td colSpan={4} className={s.tMute}>No hourly schedule for this day</td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className={s.cardFoot}>
        <div>
          <span className={s.sumStrong}>{ahead.short ? `Repeating this schedule leaves ${hrs(ahead.short)} short next week${ahead.worst ? `, most on ${dayName(ahead.worst.day)}` : ''}.` : ahead.spare ? `No hour is forecast short next week. ${hrs(ahead.spare)} look spare.` : 'This schedule matches next week’s forecast.'}</span>
          <span className={s.sumSub}>Counts the hours your schedule covers ({ahead.days.find((x) => x.svc)?.svc.replace(/^\w+ /, '')}). Servers are sized a little above the forecast so most hours are covered.{miss ? ` Day-ahead forecasts missed by ${miss.wape.toFixed(1)}% on average over the last ${miss.n} days.` : ''}</span>
        </div>
        <button type="button" className={s.textLink} onClick={() => cv.go('service')}>Tonight on Service<Icon name="ChevronRight" size={15} /></button>
      </div>
    </section>
  ) : null;

  const deptBlock = depts.length ? (
    <section key="depts" className={s.card} aria-label="Front of house and kitchen">
      <div className={s.cardHead}>
        <div><h2 className={s.cardTitle}>Front of house and kitchen</h2><p className={s.cardSub}>{period} · Hourly labor, wages paid</p></div>
        <Claim k="obs" />
      </div>
      <div className={s.depts}>
        {depts.map((dp) => { const top = dp.roles[0]?.cost || 1; return (
          <div key={dp.key} className={s.dept}>
            <span className={s.deptName}>{dp.label}</span>
            <span className={s.deptFig}>{cvMoney(Math.round(dp.cost))}</span>
            <span className={s.deptLine}>{dp.ofSales != null ? `${pct1(dp.ofSales)} of sales · ` : ''}{Math.round(dp.share * 100)}% of hourly labor</span>
            <dl className={s.deptStats}>
              <div><dt>Hours</dt><dd>{Math.round(dp.hours)} h<small>{dp.people} people</small></dd></div>
              <div><dt>Average wage</dt><dd>${dp.wage.toFixed(2)}<small>an hour</small></dd></div>
              {dp.perGuest != null && <div><dt>Cost per guest</dt><dd>${dp.perGuest.toFixed(2)}</dd></div>}
              {dp.guestsPerHour != null && <div><dt>Guests per labor hour</dt><dd>{dp.guestsPerHour.toFixed(1)}</dd></div>}
              {dp.otHours != null && <div><dt>Overtime</dt><dd className={dp.otHours >= 4 ? s.tSpare : undefined}>{dp.otHours} h<small>latest week</small></dd></div>}
            </dl>
            <ul className={s.roles}>
              {dp.roles.map((r) => (
                <li key={r.role}><span className={s.roleName}>{r.role}<small>{Math.round(r.hours)} h · ${r.wage.toFixed(2)}/h · {r.people} {r.people === 1 ? 'person' : 'people'}</small></span>
                  <span className={s.roleTrack}><i style={{ width: `${(r.cost / top) * 100}%` }} /></span><b>{cvMoney(Math.round(r.cost))}</b></li>
              ))}
            </ul>
          </div>
        ); })}
      </div>
      <div className={s.cardFoot}><span className={s.sumSub}>Wages only. Payroll taxes, tips and salaried managers are not included.</span></div>
    </section>
  ) : null;

  const kitchenBlock = (
    <section key="kitchen" className={s.card} aria-label="Kitchen by the hour">
      <div className={s.cardHead}>
        <div><h2 className={s.cardTitle}>Kitchen: is the line keeping up?</h2><p className={s.cardSub}>{dayName(sel.day)} · Average ticket time by hour{kit ? `, last ${HOURLY_WEEKS} weeks · Target ${kit.target} min` : ''}</p></div>
        <Chip tone="mute" icon="ChefHat">Kitchen</Chip>
      </div>
      {!kit || !kitDay ? <Empty title="No kitchen ticket times yet" text="This needs tickets and ticket times by the hour from your kitchen display. Once they arrive, slow hours show here." cta="Add labor data" on={() => setOpen({ kind: 'data' })} /> : (
        <>
          <div className={s.kitGrid}>
            <KitchenChart cells={kitDay.cells} target={kit.target} />
            {stations.length > 0 && (
              <div className={s.stations}>
                <span className={s.signalTitle}>Where late tickets wait</span>
                <ul className={s.roles}>
                  {stations.map(([name, share]) => <li key={name}><span className={s.roleName}>{name}</span><span className={s.roleTrack}><i className={name === room.tickets.bottleneck ? s.trackBad : undefined} style={{ width: `${(share / stations[0][1]) * 100}%` }} /></span><b>{share}%</b></li>)}
                </ul>
                <span className={s.sumSub}><Claim k="obs" />Share of late tickets, Friday and Saturday dinner</span>
              </div>
            )}
          </div>
          <div className={s.cardFoot}>
            <div>
              <span className={s.sumStrong}>{kit.worst ? `Slowest: ${dayName(kit.worst.day)} ${kit.worst.from} to ${kit.worst.to}, up to ${kit.worst.min} minutes a ticket. ${hrs(kit.lateHours)} a week run over target.` : 'Every hour runs inside the ticket-time target.'}</span>
              <span className={s.sumSub}>{line ? (line.stretched.length || line.station.length
                ? `${dayName(sel.day)}: ${[line.stretched.length && `${hrs(line.stretched.length)} look like a people problem (more than the usual ${line.usual} tickets per cook)`, line.station.length && `${hrs(line.station.length)} look like a station problem (normal load per cook)`].filter(Boolean).join(', and ')}.`
                : `${dayName(sel.day)}: no slow hours with cooks entered.`)
                : 'Add the cooks on the line by hour to see whether a slow hour is a people problem or a station problem.'}</span>
            </div>
            <button type="button" className={s.outBtn} onClick={() => setOpen({ kind: 'kitchen' })}><Icon name={dayCrew ? 'ChevronRight' : 'Plus'} size={15} />{dayCrew ? 'Hour by hour' : 'Add cooks by hour'}</button>
          </div>
        </>
      )}
    </section>
  );

  const locsBlock = rows.length > 1 ? (
    <section key="locs" className={s.card} aria-label="Compare locations">
      <div className={s.cardHead}><div><h2 className={s.cardTitle}>Compare locations</h2><p className={s.cardSub}>{period}. Pick a location to open it.</p></div></div>
      <ul className={s.locs}>
        {rows.map((r) => { const wk = weekDays(servicesOf(r.d.room)); const t = weekTotals(wk); const sm = weekSummary(wk); const on = r.id === d.id; return (
          <li key={r.id}><button type="button" className={`${s.loc} ${on ? s.locOn : ''}`} onClick={() => cv.pickRoom(r.id)} aria-current={on ? 'true' : undefined}>
            <span className={s.locName}>{r.name}{on && <small>Showing</small>}</span>
            <span className={s.locFig}><b>{pct1(r.d.week.labourRate)}</b><small>Labor %</small></span>
            <span className={s.locFig}><b>{cvMoney(Math.round(r.d.week.labour))}</b><small>Labor cost</small></span>
            <span className={s.locFig}><b className={t.short ? s.down : ''}>{t.short} h</b><small>Short a server</small></span>
            <span className={s.locNote}>{sm.shortage ? `Worst: ${sm.shortage.svc.label}` : sm.missing.length === 7 ? 'No hourly staffing yet' : 'No day is short'}</span>
            <Icon name="ChevronRight" size={18} className={s.chev} />
          </button></li>
        ); })}
      </ul>
    </section>
  ) : null;

  const patternsBlock = (
    <section key="patterns" className={s.card} aria-label="Patterns by day and hour">
      <button type="button" className={s.fold} aria-expanded={patterns} onClick={() => setPatterns((v) => !v)}>
        <span><span className={s.cardTitle}>Patterns across the week</span>
          <span className={s.cardSub}>{weak.length ? `${listOf(weak.map((x) => x.svc.label))} ${weak.length === 1 ? 'is' : 'are'} where staffing most often falls short.` : services.length ? 'No window is short this week.' : 'Needs servers and covers by the hour.'}</span></span>
        <span className={s.foldEnd}>{patterns ? 'Hide' : 'Show the grid'}<Icon name={patterns ? 'ChevronUp' : 'ChevronDown'} size={16} /></span>
      </button>
      {patterns && (!grid ? <Empty title="No hourly pattern yet" text="Add covers and servers by the hour for this location." cta="Add labor data" on={() => setOpen({ kind: 'data' })} /> : (
        <>
          <div className={s.seg} role="radiogroup" aria-label="What the grid shows">
            {modes.map((k) => <button key={k} type="button" role="radio" aria-checked={k === gmode} className={s.segBtn} onClick={() => { setMode(k); setCell(null); }}>{MODES[k]}</button>)}
          </div>
          <Grid grid={grid} mode={gmode} fmt={gfmt} day={sel.day} sel={gsel} onSel={(c) => { setCell(c); if (c.day !== sel.day) { setDayPick(c.day); setHourSel(null); } }} />
          <div className={s.scale}>
            {gmode === 'gap' ? <><span className={s.key}><span><i className={s.kShort} />Short</span><span><i className={s.kSpare} />Spare</span></span></> : <><span>Lower</span><i /><span>Higher</span></>}
            <span className={s.scaleNote}>{gmode === 'cps' ? `Covers divided by servers scheduled${rate ? `. Above your pace of ${rate.toFixed(2)} means the hour was short` : ''}.` : 'Servers scheduled minus servers needed.'}</span>
          </div>
          <div className={s.cardFoot}>
            <span className={s.sumStrong}>{gsel ? `${dayName(gsel.day)} ${grid.hours[gsel.ci].label}: ${gfmt(grid.rows[gsel.ri].cells[gsel.ci], true)}` : `${dayName(sel.day)} is highlighted. Pick any cell.`}</span>
            <span className={s.sumSub}>{gmode === 'gap' ? <Claim k="mod" /> : <Claim k="obs" />}{own ? (gmode === 'gap' ? 'Typical week' : 'From your clock-ins and covers') : period}</span>
          </div>
        </>
      ))}
    </section>
  );

  const order = { gm: [workBlock, aheadBlock, kitchenBlock, tilesBlock, deptBlock, resultsBlock], owner: [tilesBlock, deptBlock, resultsBlock, workBlock, aheadBlock, kitchenBlock, locsBlock], ops: [locsBlock, tilesBlock, deptBlock, workBlock, aheadBlock, kitchenBlock, resultsBlock] }[view] || [];
  const handDays = entryTotals(entries, weekFrom, weekTo).days;

  return (
    <div className={`cv-page ${s.page}`}>
      <header className={s.head}>
        <div className={s.headText}>
          <h1 className={s.headline}>The right people, at the right hours.</h1>
          <span className={s.context}>{CV_ROOM.name} · {period}</span>
        </div>
        <div className={s.headEnd}>
          <div className={s.seg} role="radiogroup" aria-label="View">
            {VIEWS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={view === k} className={s.segBtn} onClick={() => setView(k)}>{l}</button>)}
          </div>
          <button type="button" className={s.outBtn} onClick={() => setOpen({ kind: 'data' })}><Icon name="Plus" size={16} />Update data</button>
        </div>
      </header>

      {stripBlock}
      {heroBlock}
      {order}
      {patternsBlock}

      <p className={s.status}>
        <Icon name={held ? 'TriangleAlert' : 'Info'} size={16} className={held ? s.icWarn : undefined} />
        <span>{own ? `From your Toast clock-ins and covers through ${room.fromToast.end}.` : 'Sample restaurant group.'} {feed ? `Schedules: 7shifts, ${feed.state === 'off' ? 'not connected' : feed.last}.` : ''} {handDays > 0 ? `${handDays} days entered by hand this week.` : ''}</span>
        {ran.length > 0 && <button type="button" className={s.textLink} onClick={() => setOpen({ kind: 'checks' })}><Icon name={ran.every((c) => c.ok) ? 'CircleCheck' : 'TriangleAlert'} size={15} />{ran.filter((c) => c.ok).length} of {ran.length} math checks pass</button>}
        <button type="button" className={s.textLink} onClick={() => setOpen({ kind: 'data' })}>Where the numbers come from<Icon name="ChevronRight" size={15} /></button>
      </p>

      {openMove && <MovePanel m={openMove} svc={moveSvc(openMove)} trust={trust(openMove)} state={saved?.[openMove.id]?.s} own={own} plan={plans?.[openMove.svc]} task={cutTask(openMove).task} cv={cv}
        onPlan={onPlan} onSkip={(m) => { mark(m, 'skipped'); setOpen(null); }} onUndo={(m) => mark(m, null)} onClose={() => setOpen(null)} />}
      {open?.kind === 'checks' && <ChecksPanel checks={checks} own={own} weeks={HOURLY_WEEKS} onClose={() => setOpen(null)} />}
      {open?.kind === 'kitchen' && kitDay && <KitchenPanel key={sel.day} day={sel.day} cells={kitDay.cells} target={kit.target} crew={dayCrew} weeks={HOURLY_WEEKS} onClose={() => setOpen(null)}
        onSave={(c) => { setCrew((cur) => ({ ...(cur || {}), [sel.day]: c }), `Labor: entered the kitchen line for ${dayName(sel.day)}`); cv.toast(`Saved ${dayName(sel.day)}’s line.`); }}
        onClear={() => setCrew((cur) => { const n = { ...(cur || {}) }; delete n[sel.day]; return n; }, `Labor: cleared the kitchen line for ${dayName(sel.day)}`)} />}
      {open?.kind === 'cost' && <CostPanel d={d} target={target} group={group} onClose={() => setOpen(null)} />}
      {open?.kind === 'data' && <DataPanel feed={feed} own={own} entries={entries || []} today={CV_NOW.iso} weekFrom={weekFrom} weekTo={weekTo} cv={cv} onClose={() => setOpen(null)}
        onSave={(e) => { setEntries((cur) => withEntry(cur, e), `Labor: entered ${e.date} by hand`); cv.toast(`Saved ${fmtDay(e.date)}, entered by hand.`); }}
        onRemove={(date) => setEntries((cur) => (cur || []).filter((x) => x.date !== date), `Labor: removed hand entry for ${date}`)} />}
    </div>
  );
}

export { CvLabour };
