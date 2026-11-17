'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { tonightPlan } from '../week';
import { weeklySeries } from '../../../lib/data/readers';
import {
  checkEntry, coverage, DAYS, dayName, entryTotals, listOf, loadGridFromHeat, loadGridFromPlans, moves as movesOf, peakCell, planServices, sampleServices, shortPhrase, splitMoves, topIssue, withEntry,
} from '../../../lib/data/page/labour';
import { useCv, cvMoney, cvApproval, CV_D, CV_NOW, CV_ROOM, Claim } from '../core';
import { heat, useDense } from '../dense-ui';
import { useTodayTheme } from './today.themes';
import s from './labour.module.css';

/* ================================================================ Labor
 * The redesigned Labor page (Ramidu's concept), in Today's finished style:
 * one next best move with the page's one persimmon button, four numbers that
 * each say their period, then four numbered steps: find the hours, the next
 * best moves, spot the pattern, did the changes work. Detail sits behind a
 * click, in a side panel.
 * Every figure is read from the room (lib/data/page/labour.js); nothing is
 * typed here. Schedules come from 7shifts when it's connected; without it, or
 * while it's down, a manager enters the day's cost and hours by hand
 * ("Update data"). Moves are advice: marking one planned never changes a live
 * schedule. */

const OUTCOME = {
  verified: { icon: 'BadgeCheck', label: 'Verified', tone: 'good' },
  limited: { icon: 'BadgeCheck', label: 'Verified, with limits', tone: 'good' },
  testing: { icon: 'Hourglass', label: 'Being measured', tone: 'info' },
  running: { icon: 'Hourglass', label: 'Being measured', tone: 'info' },
  reversed: { icon: 'Undo2', label: 'Reversed', tone: 'warn' },
};
const MOVE_ICON = { risk: 'TriangleAlert', ready: 'CalendarClock', potential: 'Sigma', check: 'Eye' };
const fmtDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const pct1 = (v) => `${(v * 100).toFixed(1)}%`;

function Chip({ tone = 'mute', icon, children }) {
  return <span className={`${s.chip} ${s[`chip_${tone}`]}`}>{icon && <Icon name={icon} size={14} />}{children}</span>;
}

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

/* ---------------------------------------------------------------- charts */

/** Scheduled against needed, hour by hour. Each hour is a button. */
function CoverageChart({ svc, sel, onSel, compact = false }) {
  const max = Math.max(...svc.hours.flatMap((h) => [h.sched, h.need]), 1);
  return (
    <div className={compact ? `${s.bars} ${s.barsCompact}` : s.bars} role="group" aria-label={`Servers scheduled and needed by hour, ${svc.label}`}>
      {svc.hours.map((h, i) => {
        const gap = h.sched - h.need;
        const Tag = onSel ? 'button' : 'div';
        return (
          <Tag key={h.label} type={onSel ? 'button' : undefined} className={`${s.barCol} ${sel === i ? s.barColOn : ''}`} aria-pressed={onSel ? sel === i : undefined} onClick={onSel ? () => onSel(i) : undefined}
            aria-label={`${h.label}: ${h.sched} scheduled, ${h.need} needed${gap < 0 ? `, ${-gap} short` : gap > 0 ? `, ${gap} possibly spare` : ''}`}>
            <span className={`${s.barGap} ${gap < 0 ? s.gapShort : gap > 0 ? s.gapSpare : ''}`}>{gap < 0 ? `${-gap} short` : gap > 0 ? `${gap} spare` : ''}</span>
            <span className={s.barPair}>
              <span className={s.barSched} style={{ height: `${(h.sched / max) * 100}%` }}><b>{h.sched}</b></span>
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
      <span><i className={s.kShort} />Needed, and short</span>
    </div>
  );
}

/** Covers per server-hour, weekday by hour. Each cell is a button. */
function LoadGrid({ grid, sel, onSel }) {
  const vals = grid.rows.flatMap((r) => r.cells).filter((v) => v != null);
  const max = Math.max(...vals, 1);
  return (
    <div className={s.heatWrap} tabIndex={0} role="group" aria-label="Covers per server-hour, weekday by hour">
      <table className={s.heat}>
        <thead><tr><th />{grid.hours.map((h) => <th key={h.hour} scope="col">{h.label.replace(' ', '')}</th>)}</tr></thead>
        <tbody>
          {grid.rows.map((r, ri) => (
            <tr key={r.day}>
              <th scope="row">{r.day}</th>
              {r.cells.map((v, ci) => {
                const k = v == null ? 0 : v / max;
                const on = sel && sel.ri === ri && sel.ci === ci;
                return (
                  <td key={ci}>
                    {v == null ? <span className={s.cellNone}>·</span> : (
                      <button type="button" className={`${s.cell} ${on ? s.cellOn : ''} ${k > 0.55 ? s.cellDark : ''}`} style={{ '--k': `${Math.round(8 + k * 82)}%` }} aria-pressed={on} onClick={() => onSel({ ri, ci })}
                        aria-label={`${dayName(r.day)} ${grid.hours[ci].label}: ${v.toFixed(1)} covers per server-hour`}>{v.toFixed(1)}</button>
                    )}
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
      <thead><tr><th>Hour</th><th className={s.r}>Covers</th><th className={s.r}>Scheduled</th><th className={s.r}>Needed</th><th className={s.r}>Gap</th></tr></thead>
      <tbody>{svc.hours.map((h) => { const g = h.sched - h.need; return (
        <tr key={h.label}><td>{h.label}</td><td className={s.r}>{h.covers ?? '—'}</td><td className={s.r}>{h.sched}</td><td className={s.r}>{h.need}</td>
          <td className={`${s.r} ${g < 0 ? s.tShort : g > 0 ? s.tSpare : ''}`}>{g < 0 ? `${-g} short` : g > 0 ? `${g} spare` : '—'}</td></tr>
      ); })}</tbody>
    </table>
  );
}

function MovePanel({ m, svc, state, own, plan, task, onPlan, onSkip, onUndo, onClose, cv }) {
  const ap = m.kind === 'draft' ? cvApproval(m.approval) : null;
  const canCut = own && m.kind === 'spare' && plan?.cutFrom != null;
  let primary = null;
  if (m.kind === 'draft') primary = <Button className={s.panelPrimary} iconRight="ArrowRight" onClick={() => { onClose(); cv.approve(m.approval); }}>Review and publish</Button>;
  else if (canCut) primary = task ? <Chip tone="info" icon="CircleCheck">Approved. The steps are on Today.</Chip> : <Button className={s.panelPrimary} onClick={() => onPlan(m, { cut: true })}>Approve for next {dayName(svc.day)}</Button>;
  else if (state === 'planned') primary = <Chip tone="info" icon="CircleCheck">Planned. Your live schedule is unchanged.</Chip>;
  else primary = <Button className={s.panelPrimary} onClick={() => onPlan(m)}>Mark as planned</Button>;
  return (
    <Panel over={m.tag} title={m.title} onClose={onClose} foot={(
      <>
        {primary}
        <div className={s.panelMore}>
          {state ? <button type="button" className={s.textBtn} onClick={() => onUndo(m)}><Icon name="Undo2" size={15} />Undo</button> : <button type="button" className={s.textBtn} onClick={() => onSkip(m)}>Not for us</button>}
          {m.finding && <button type="button" className={s.textBtn} onClick={() => cv.go('finding', { id: m.finding })}>Open the full finding<Icon name="ChevronRight" size={15} /></button>}
        </div>
      </>
    )}>
      <p className={s.blockText}>{m.body}</p>
      {m.kind === 'candidate' && (
        <div className={s.panelMoney}>
          <span className={s.panelMoneyLabel}>{m.prevent ? 'Overtime pay avoided this week' : 'Potential, a week, if it works'}</span>
          <span className={s.panelFig}>{cvMoney(m.value)}<span className={s.panelUnit}>{m.prevent ? ' this week' : ' a week'}</span></span>
          <span className={s.panelClaim}><Claim k={m.claim} />{m.prevent ? 'A cost avoided is never counted as saved.' : m.lo < 0 ? `Uncertain: from losing ${cvMoney(-m.lo)} to gaining ${cvMoney(m.hi)}.` : `Likely between ${cvMoney(m.lo)} and ${cvMoney(m.hi)}. Not saved until a test verifies it.`}</span>
        </div>
      )}
      {(m.kind === 'cover' || m.kind === 'spare') && svc && (
        <>
          <Block title={`${svc.label}, servers by hour`}><CoverageChart svc={svc} compact /><ChartKey /></Block>
          <Block title="The hours"><HoursTable svc={svc} /></Block>
          <p className={s.caution}><Icon name="TriangleAlert" size={16} /><span>{m.kind === 'cover' ? 'No savings are claimed here: this protects service.' : 'The saving is unknown until the duties in that hour are checked.'} Confirm breaks, skills and availability before changing the schedule.</span></p>
        </>
      )}
      {ap && (
        <Block title="What changes">
          <table className={s.table}><thead><tr><th>When</th><th>Now</th><th>Draft</th></tr></thead>
            <tbody>{ap.diff.map(([w, a, b]) => <tr key={w}><td>{w}</td><td className={s.was}>{a}</td><td><b>{b}</b></td></tr>)}</tbody></table>
        </Block>
      )}
      {m.minutes > 0 && <p className={s.blockNote}>About {m.minutes} minutes of a manager’s time.</p>}
      <p className={s.blockNote}>Advice only. Marking a move planned records your decision; it never publishes or changes a schedule.</p>
    </Panel>
  );
}

function CostPanel({ d, target, onClose }) {
  const lab = weeklySeries(d.room, 'labour').slice(-8);
  const net = weeklySeries(d.room, 'net').slice(-8);
  const share = lab.map((w, i) => ({ weekEnd: w.weekEnd, value: net[i]?.value ? w.value / net[i].value : 0 }));
  return (
    <Panel over={`Week ending ${lab.length ? fmtDay(lab.at(-1).weekEnd) : ''}`} title="Labor cost" onClose={onClose}>
      <div className={s.panelMoney}>
        <span className={s.panelMoneyLabel}>Hourly labor paid, this week</span>
        <span className={s.panelFig}>{cvMoney(Math.round(d.week.labour))}</span>
        <span className={s.panelClaim}><Claim k="obs" />{pct1(d.week.labourRate)} of {cvMoney(Math.round(d.week.net))} net sales.{target ? ` Your target is ${pct1(target)}.` : ''}</span>
      </div>
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
          <Chip tone={live ? 'good' : feed?.state === 'off' || !feed ? 'mute' : 'warn'} icon={live ? 'CircleCheck' : feed?.state === 'off' || !feed ? 'Plug' : 'TriangleAlert'}>{live ? 'Connected' : feed?.state === 'off' || !feed ? 'Not connected' : 'Needs attention'}</Chip>
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

/* ================================================================ the page */

function CvLabour() {
  const cv = useCv();
  const eng = useEngine();
  useTodayTheme(!!cv.tools);
  const d = CV_D, room = d.room, own = !!room.fromToast;
  const dense = useDense();

  const plans = own ? Object.fromEntries(DAYS.map((x) => [x, tonightPlan(room, x)])) : null;
  const services = own ? planServices(plans) : sampleServices(room.labour);
  const top = topIssue(services);
  const [dayKey, setDayKey] = React.useState(null);
  const svc = services.find((x) => x.key === dayKey) || top?.svc || services[0] || null;
  const cov = svc ? coverage(svc) : null;
  const [hourSel, setHourSel] = React.useState(null);
  const hour = svc && hourSel != null ? svc.hours[hourSel] : null;

  const [saved, setSaved] = useSaved('labour.moves', {});
  const [entries, setEntries] = useSaved('labour.entries', []);
  const [open, setOpen] = React.useState(null); // { kind: 'move' | 'cost' | 'data' | 'read', id? }
  const [showAll, setShowAll] = React.useState(false);
  const [more, setMore] = React.useState(false);
  const [cell, setCell] = React.useState(null);

  const all = movesOf({ services, candidates: d.candidates, draft: own ? null : room.labour?.draft });
  const split = splitMoves(all, saved);
  const shown = showAll ? [...split.open, ...split.planned, ...split.skipped] : [...split.open, ...split.planned].slice(0, 3);
  const openMove = open?.kind === 'move' ? all.find((m) => m.id === open.id) : null;
  const moveSvc = (m) => services.find((x) => x.key === m?.svc) || null;

  const feed = d.feeds.find((f) => f.name === '7shifts') || null;
  const held = !!feed && feed.state !== 'healthy' && feed.state !== 'off' && !own;
  const target = d.profile?.laborTarget > 0 ? d.profile.laborTarget : null;
  const labWeeks = weeklySeries(room, 'labour');
  const weekTo = labWeeks.at(-1)?.weekEnd || CV_NOW.iso;
  const weekFrom = addDays(weekTo, -6);
  const period = `Week of ${fmtDay(weekFrom)} to ${fmtDay(weekTo)}`;

  // Short and spare server-hours for the week: the sample's measured week, or a typical week from the room's own clock-ins.
  const shortWk = own ? services.reduce((t, x) => t + coverage(x).short, 0) : room.labour?.kpis?.short ?? null;
  const spareWk = own ? weeklySeries(room, 'idleServerHours').slice(-1)[0]?.value ?? null : room.labour?.kpis?.idle ?? null;

  const proofs = own ? [] : d.proofs.filter((p) => p.lever === 'Labour');
  const tests = own ? (eng.windows || []).filter((w) => w.roomId === d.id && (w.lever === 'labour' || w.lever === 'overtime')) : [];
  const banked = proofs.find((p) => p.outcome === 'verified' || p.outcome === 'limited') || null;
  const bookedOwn = tests.filter((w) => w.status === 'verified').reduce((t, w) => t + w.bookedCents / 100, 0);

  const grid = own ? loadGridFromPlans(plans) : dense ? loadGridFromHeat(heat(dense.hours)) : null;
  const gridSel = grid && grid.rows.length ? cell || peakCell(grid) : null;

  const pickDay = (key) => { setDayKey(key); setHourSel(null); };
  const toChart = (key) => { if (key) pickDay(key); document.getElementById('labor-hours')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const mark = (m, st) => setSaved((cur) => { const next = { ...(cur || {}) }; if (st) next[m.id] = { s: st, at: new Date().toISOString() }; else delete next[m.id]; return next; }, `Labor: ${st ? (st === 'planned' ? 'planned' : 'not for us') : 'reopened'} "${m.title}"`);
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
    mark(m, 'planned'); setOpen(null); cv.toast('Marked as planned. Your live schedule is unchanged.');
  };

  /* The hero: one message, one persimmon button. */
  let hero;
  const heroMove = top ? all.find((m) => m.svc === top.svc.key && (top.kind === 'short' ? m.kind === 'cover' : m.kind === 'spare')) : null;
  if (!services.length) {
    hero = { badge: 'Get started', tone: 'mute', icon: 'CircleDashed', title: 'Add staff hours to see where coverage is off.', text: 'Hour-by-hour staffing needs servers on the floor and covers by the hour. Connect 7shifts, add time entries to your Toast upload, or enter the day by hand.', cta: 'Add labor data', onCta: () => setOpen({ kind: 'data' }) };
  } else if (held) {
    hero = { badge: 'Check the schedule first', tone: 'warn', icon: 'TriangleAlert', title: `Confirm the schedule before changing ${top ? top.svc.label : 'this week'}.`, text: `7shifts last updated ${feed.last}, so staffing suggestions are on hold. Reconnect it, or enter the hours by hand.`, cta: 'Update schedule data', onCta: () => setOpen({ kind: 'data' }), alt: top ? 'See the hours' : null, onAlt: () => toChart(top?.svc.key) };
  } else if (top?.kind === 'short') {
    hero = { badge: 'Your next best move · Service risk', tone: 'risk', icon: 'TriangleAlert', title: `Protect ${top.svc.label} before the rush.`, text: <>{top.svc.label} runs <b>{shortPhrase(top.cov.shortAt)}</b>. Add coverage at the peak before cutting any late hours.</>, cta: 'Review staffing fix', onCta: () => setOpen({ kind: 'move', id: heroMove.id }), alt: 'See the hours', onAlt: () => toChart(top.svc.key) };
  } else if (top) {
    hero = { badge: 'Your next best move', tone: 'info', icon: 'Eye', title: `Check ${top.svc.label}’s spare ${top.cov.spare === 1 ? 'hour' : 'hours'}.`, text: <>No hour is short. <b>{top.cov.spare} server-{top.cov.spare === 1 ? 'hour looks' : 'hours look'} spare</b> at {listOf(top.cov.spareAt.map((x) => x.label))}. Confirm duties before reducing.</>, cta: 'Review the hours', onCta: () => setOpen({ kind: 'move', id: heroMove.id }), alt: 'See the hours', onAlt: () => toChart(top.svc.key) };
  } else {
    hero = { badge: 'On track', tone: 'good', icon: 'CircleCheck', title: 'Coverage matches demand.', text: 'Every hour has the servers it needs, and none look spare.' };
  }
  const peak = top ? (() => { const i = top.svc.hours.findIndex((h) => (top.kind === 'short' ? h.sched < h.need : h.sched > h.need)); const a = Math.max(0, Math.min(i - 1, top.svc.hours.length - 4)); return { ...top.svc, hours: top.svc.hours.slice(a, a + 4) }; })() : null;

  const tiles = [
    { k: 'spend', label: 'Labor cost', when: period, fig: cvMoney(Math.round(d.week.labour)), claim: 'obs', foot: 'Hourly labor paid', on: () => setOpen({ kind: 'cost' }) },
    { k: 'share', label: 'Labor share of sales', when: period, fig: pct1(d.week.labourRate), claim: 'obs', foot: target ? `Target ${pct1(target)} · ${Math.abs((d.week.labourRate - target) * 100).toFixed(1)} pts ${d.week.labourRate > target ? 'over' : 'under'}` : 'No target set', on: () => setOpen({ kind: 'cost' }) },
    { k: 'gaps', label: 'Coverage gaps, servers', when: own ? 'Typical week' : period, fig: shortWk == null ? null : `${shortWk} h`, unit: 'short', tone: shortWk > 0 ? 'down' : '', claim: 'mod', foot: spareWk == null ? 'Hours short of what covers needed' : `${spareWk} h possibly spare, in other hours`, on: () => toChart() },
    banked
      ? { k: 'book', label: 'Verified labor saving', when: `Since ${banked.since}`, fig: cvMoney(banked.bookable), unit: 'a week', tone: 'up', claim: 'book', foot: banked.outcome === 'limited' ? 'Verified, with limits' : `Verified · held ${banked.held}`, on: () => cv.go('packet', { id: banked.id }) }
      : { k: 'book', label: 'Verified labor saving', when: 'To date', fig: bookedOwn ? cvMoney(Math.round(bookedOwn)) : null, unit: bookedOwn ? 'a week' : '', tone: bookedOwn ? 'up' : '', claim: bookedOwn ? 'book' : 'none', foot: bookedOwn ? 'From verified tests' : 'Nothing verified yet', on: () => cv.go('proof') },
  ];

  return (
    <div className={`cv-page ${s.page}`}>
      <header className={s.head}>
        <div className={s.headText}>
          <h1 className={s.headline}>The right people, at the right hours.</h1>
          <span className={s.context}>{CV_ROOM.name} · {period}</span>
        </div>
        <button type="button" className={s.outBtn} onClick={() => setOpen({ kind: 'data' })}><Icon name="Plus" size={16} />Update data</button>
      </header>

      {/* ---- the next best move */}
      <section className={`${s.hero} ${s[`hero_${hero.tone}`]}`} aria-label="Highest priority labor issue">
        <div className={s.heroMain}>
          <Chip tone={hero.tone === 'risk' ? 'bad' : hero.tone} icon={hero.icon}>{hero.badge}</Chip>
          <h2 className={s.heroTitle}>{hero.title}</h2>
          <p className={s.heroText}>{hero.text}</p>
          {hero.cta && (
            <div className={s.heroActs}>
              <Button className={s.cta} iconRight="ArrowRight" onClick={hero.onCta}>{hero.cta}</Button>
              {hero.alt && <button type="button" className={s.seeWhy} onClick={hero.onAlt}>{hero.alt}<Icon name="ChevronRight" size={16} /></button>}
            </div>
          )}
          {top && !held && <span className={s.heroProof}><Claim k="mod" />From your covers per server-hour. Confirm breaks and availability before acting.</span>}
        </div>
        {peak && (
          <div className={s.signal} aria-label={`${top.svc.label} peak staffing`}>
            <div className={s.signalHead}><span className={s.signalTitle}>{top.svc.label} · Servers</span><span className={s.signalSub}>Scheduled against needed</span></div>
            <CoverageChart svc={peak} compact />
            <ChartKey />
          </div>
        )}
      </section>

      {/* ---- four numbers */}
      <section className={s.tiles} aria-label="Labor summary">
        {tiles.map((t) => (
          <button key={t.k} type="button" className={s.tile} onClick={t.on}>
            <span className={s.tileLabel}>{t.label}</span>
            <span className={s.tileWhen}>{t.when}</span>
            <span className={`${s.tileFig} ${t.tone ? s[t.tone] : ''} ${t.fig == null ? s.tileNone : ''}`}>{t.fig ?? '—'}{t.unit && t.fig != null && <small>{t.unit}</small>}</span>
            <span className={s.tileFoot}><Claim k={t.claim} /><span>{t.foot}</span></span>
            <Icon name="ChevronRight" size={16} className={s.tileChev} />
          </button>
        ))}
      </section>

      <p className={s.status}>
        <Icon name={held ? 'TriangleAlert' : 'Info'} size={16} className={held ? s.icWarn : undefined} />
        <span>{own ? `From your Toast clock-ins and covers through ${room.fromToast.end}.` : 'Sample restaurant group.'} {feed ? `Schedules: 7shifts, ${feed.state === 'off' ? 'not connected' : feed.last}.` : ''} {entryTotals(entries, weekFrom, weekTo).days > 0 ? `${entryTotals(entries, weekFrom, weekTo).days} days entered by hand this week.` : ''}</span>
        <button type="button" className={s.textLink} onClick={() => setOpen({ kind: 'data' })}>Where the numbers come from<Icon name="ChevronRight" size={15} /></button>
      </p>

      {/* ---- 01 and 02 */}
      <div className={s.gridMain}>
        <section className={s.card} id="labor-hours" aria-label="Staffing coverage by hour">
          <div className={s.cardHead}>
            <div><h2 className={s.cardTitle}><span className={s.num}>01</span>Find the hours that need attention</h2><p className={s.cardSub}>Servers scheduled against what the covers needed. Pick a day, then an hour.</p></div>
          </div>
          {!svc ? <Empty title="No hour-by-hour staffing yet" text="Daily totals can’t show how many servers each hour needs. Add servers on the floor and covers by the hour." cta="Add labor data" on={() => setOpen({ kind: 'data' })} /> : (
            <>
              <div className={s.days} role="tablist" aria-label="Day">
                {services.map((x) => { const c = coverage(x); return (
                  <button key={x.key} type="button" role="tab" aria-selected={x.key === svc.key} className={`${s.day} ${x.key === svc.key ? s.dayOn : ''}`} onClick={() => pickDay(x.key)}>
                    {x.day}{c.short > 0 && <i className={s.dotShort} aria-label={`${c.short} short`} />}
                  </button>
                ); })}
              </div>
              <CoverageChart svc={svc} sel={hourSel} onSel={setHourSel} />
              <ChartKey />
              <div className={s.cardFoot}>
                <div>
                  <span className={s.sumStrong}>{hour ? `${svc.label}, ${hour.label}: ${hour.sched} scheduled, ${hour.need} needed${hour.covers != null ? `, ${hour.covers} covers` : ''}` : `${svc.label}: ${cov.short} short server-${cov.short === 1 ? 'hour' : 'hours'}, ${cov.spare} possibly spare`}</span>
                  <span className={s.sumSub}><Claim k="mod" />Needed is modeled from your measured covers per server-hour, with a safety margin.</span>
                </div>
              </div>
            </>
          )}
        </section>

        <section className={s.card} aria-label="Recommended labor changes">
          <div className={s.cardHead}>
            <div><h2 className={s.cardTitle}><span className={s.num}>02</span>The next best moves</h2><p className={s.cardSub}>Service risk first, then cost.</p></div>
            <Chip tone="mute">{split.open.length} to review</Chip>
          </div>
          {held && <p className={s.caution}><Icon name="TriangleAlert" size={16} /><span>On hold until the schedule feed is current. You can still read each one.</span></p>}
          {all.length === 0 ? <Empty title="No moves to suggest" text="Staffing suggestions need servers and covers by the hour." cta="Add labor data" on={() => setOpen({ kind: 'data' })} /> : (
            <ul className={s.moves}>
              {shown.map((m) => { const st = saved?.[m.id]?.s; return (
                <li key={m.id}>
                  <button type="button" className={`${s.move} ${s[`move_${m.tone}`]} ${st ? s.moveDone : ''}`} onClick={() => setOpen({ kind: 'move', id: m.id })}>
                    <span className={s.moveIcon}><Icon name={st === 'planned' ? 'CircleCheck' : MOVE_ICON[m.tone]} size={18} /></span>
                    <span className={s.moveText}>
                      <span className={s.moveTitle}>{m.title}</span>
                      <span className={s.moveWorth}>{st === 'planned' ? 'Planned · schedule unchanged' : st === 'skipped' ? 'Not for us' : m.kind === 'candidate' ? `${cvMoney(m.value)} ${m.prevent ? 'overtime avoided this week' : 'a week, potential'}` : m.kind === 'draft' ? 'Ready to review' : `${m.worth} · ${m.worthNote}`}</span>
                    </span>
                    <span className={s.moveEnd}>{!st && <Chip tone={m.tone === 'risk' ? 'bad' : m.tone === 'check' ? 'warn' : 'mute'}>{m.tag}</Chip>}<Icon name="ChevronRight" size={18} className={s.chev} /></span>
                  </button>
                </li>
              ); })}
            </ul>
          )}
          <div className={s.cardFoot}>
            <span className={s.sumSub}>Advice only. Nothing here changes a live schedule.</span>
            {all.length > shown.length || showAll ? <button type="button" className={s.textLink} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Review all ${all.length}`}<Icon name={showAll ? 'ChevronUp' : 'ChevronDown'} size={15} /></button> : null}
          </div>
        </section>
      </div>

      <button type="button" className={s.moreToggle} aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? 'Hide patterns and results' : 'Show patterns and results'}<Icon name={more ? 'ChevronUp' : 'ChevronDown'} size={16} /></button>

      {/* ---- 03 and 04 */}
      <div className={`${s.gridBottom} ${more ? s.moreOpen : ''}`}>
        <section className={s.card} aria-label="Service load by day and hour">
          <div className={s.cardHead}>
            <div><h2 className={s.cardTitle}><span className={s.num}>03</span>Spot the pattern</h2><p className={s.cardSub}>Covers per server-hour, by day and hour{own ? '' : ', averaged over the last 13 weeks'}. Pick any cell.</p></div>
            <button type="button" className={s.outBtn} onClick={() => setOpen({ kind: 'read' })}>How to read</button>
          </div>
          {!grid || !grid.rows.length ? <Empty title="No hourly service load yet" text="Add covers and servers by the hour for this location." cta="Add labor data" on={() => setOpen({ kind: 'data' })} /> : (
            <>
              <LoadGrid grid={grid} sel={gridSel} onSel={setCell} />
              <div className={s.scale}><span>Lower load</span><i /><span>Higher load</span><span className={s.scaleNote}>High load isn’t always understaffed</span></div>
              <div className={s.cardFoot}>
                <span className={s.sumStrong}>{dayName(grid.rows[gridSel.ri].day)} {grid.hours[gridSel.ci].label}: {grid.rows[gridSel.ri].cells[gridSel.ci].toFixed(1)} covers per server-hour</span>
                {services.some((x) => x.day === grid.rows[gridSel.ri].day) && <button type="button" className={s.textLink} onClick={() => toChart(services.find((x) => x.day === grid.rows[gridSel.ri].day).key)}>See that day’s hours<Icon name="ChevronRight" size={15} /></button>}
              </div>
            </>
          )}
        </section>

        <section className={s.card} aria-label="Results of labor changes">
          <div className={s.cardHead}>
            <div><h2 className={s.cardTitle}><span className={s.num}>04</span>Did the changes work?</h2><p className={s.cardSub}>Potential and verified stay separate.</p></div>
          </div>
          {proofs.length + tests.length === 0 ? <p className={s.none}>No labor change has been measured here yet. Once a change is made, a test compares it with matching services.</p> : (
            <ul className={s.results}>
              {proofs.map((p) => { const o = OUTCOME[p.outcome] || OUTCOME.testing; return (
                <li key={p.id}><button type="button" className={s.result} onClick={() => cv.go('packet', { id: p.id })}>
                  <span className={s.resText}><span className={s.resTitle}>{p.title}</span><Chip tone={o.tone} icon={o.icon}>{o.label}</Chip></span>
                  <span className={`${s.resFig} ${p.bookable ? s.up : s.resNone}`}>{p.outcome === 'testing' ? '—' : cvMoney(p.bookable || 0)}{p.bookable ? <small>a week</small> : null}</span>
                  <Icon name="ChevronRight" size={18} className={s.chev} />
                </button></li>
              ); })}
              {tests.map((w) => { const o = OUTCOME[w.status] || OUTCOME.testing; return (
                <li key={w.id}><button type="button" className={s.result} onClick={() => cv.go('packet', { id: w.id })}>
                  <span className={s.resText}><span className={s.resTitle}>{w.title}</span><Chip tone={o.tone} icon={o.icon}>{w.status === 'running' ? `Day ${w.day} of 28` : o.label}</Chip></span>
                  <span className={`${s.resFig} ${w.status === 'verified' ? s.up : s.resNone}`}>{w.status === 'verified' ? cvMoney(w.bookedCents / 100, { cents: true }) : '—'}</span>
                  <Icon name="ChevronRight" size={18} className={s.chev} />
                </button></li>
              ); })}
            </ul>
          )}
          <div className={s.cardFoot}>
            <span className={s.sumSub}>Potential, then made, then measured, then verified.</span>
            <button type="button" className={s.textLink} onClick={() => cv.go('proof')}>Full history<Icon name="ChevronRight" size={15} /></button>
          </div>
        </section>
      </div>

      {openMove && <MovePanel m={openMove} svc={moveSvc(openMove)} state={saved?.[openMove.id]?.s} own={own} plan={plans?.[openMove.svc]} task={cutTask(openMove).task} cv={cv}
        onPlan={onPlan} onSkip={(m) => { mark(m, 'skipped'); setOpen(null); }} onUndo={(m) => mark(m, null)} onClose={() => setOpen(null)} />}
      {open?.kind === 'cost' && <CostPanel d={d} target={target} onClose={() => setOpen(null)} />}
      {open?.kind === 'data' && <DataPanel feed={feed} own={own} entries={entries || []} today={CV_NOW.iso} weekFrom={weekFrom} weekTo={weekTo} cv={cv} onClose={() => setOpen(null)}
        onSave={(e) => { setEntries((cur) => withEntry(cur, e), `Labor: entered ${e.date} by hand`); cv.toast(`Saved ${fmtDay(e.date)}, entered by hand.`); }}
        onRemove={(date) => setEntries((cur) => (cur || []).filter((x) => x.date !== date), `Labor: removed hand entry for ${date}`)} />}
      {open?.kind === 'read' && (
        <Panel over="How to read" title="Covers per server-hour" onClose={() => setOpen(null)}>
          <p className={s.blockText}>Covers served in an hour, divided by the servers on the floor. A high number can mean a productive hour or a stretched one. A low number can mean side work, or more servers than the hour needed.</p>
          <p className={s.caution}><Icon name="TriangleAlert" size={16} /><span>Never cut staffing from this number alone. Check it against the hours in step 01, guest experience and what each role has to do.</span></p>
        </Panel>
      )}
    </div>
  );
}

function Empty({ title, text, cta, on }) {
  return (
    <div className={s.empty}>
      <Icon name="CircleDashed" size={22} />
      <b>{title}</b>
      <span>{text}</span>
      <button type="button" className={s.outBtn} onClick={on}>{cta}<Icon name="ChevronRight" size={15} /></button>
    </div>
  );
}

export { CvLabour };
