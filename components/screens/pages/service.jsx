'use client';

import * as React from 'react';

import { Icon, Button } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_NOW, Claim, Money, Pill, PageHead } from '../core';
import { ServiceCheck } from '../touches';
import { DenseService } from '../dense-sections';
import { covercastPace, shiftPulseDay } from '../../../lib/data/forecast/index.js';
import { useCovercast } from '../covercast';
import {
  addDays, bandSpread, clockLabel, clockMinutes, cutApprovalId, dayOfDate, dayOutlook, fencesOf, hhmm, hourRows, isCutFor, localNow,
  manualNight, MEALS, mealOf, MIN_CALIBRATED, needsFrom, pacing, planTotals, serviceRecap, servicePlan, slotRows, SLOT_MIN, toCsv,
} from '../../../lib/data/page/service.js';
import { GuestsChart, HourChart } from './service.charts';
import s from './service.module.css';

/*
 * The Service page: during the day, which service needs you and what to do.
 *
 * Level 1, the answer: one card says what to do, when, why and what happens,
 * with the page's one persimmon button. Level 2, one chart that follows the
 * service and the tab (Forecast, Staffing, Performance), with the hours ahead
 * beside it. Level 3, the detail tabs: every 15 minutes, hour by hour, checks
 * and rules, the money, past decisions and busy times, with a CSV export.
 *
 * Sources, in order: Toast live (when connected), your own count (typed in),
 * the plan from your recent same weekdays. The sample group shows a fixed
 * dinner scene and says so. Nothing typed in is ever shown as live.
 */

const FULL_DAY = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const dayOf = (d) => FULL_DAY[d] ?? d;
const POLL_MS = 120_000;
const VIEW_KEY = 'cv.service.view';
const DEFAULT_VIEW = { meal: 'dinner', when: 'today', tab: 'forecast', detail: 'slots', role: null };
const MEAL_ICON = { lunch: 'Sun', dinner: 'Moon', day: 'CalendarDays' };
const HANDOFF = { gm: 'GM', floor: 'floor manager' };

/* Coversight's own names for the parts of this page. */
const NAMES = { page: 'Covercast', call: 'Right-Size Call', pace: 'Pace Line', map: 'Staffing Map', guard: 'Floor Guard', proof: 'Clock-in Proof', brief: 'Pre-shift Brief' };
const ROLES = [['owner', 'Owner'], ['gm', 'GM'], ['floor', 'Floor manager']];
/** The promise each role buys this page for, in the page head. */
const PROMISE = {
  owner: 'Labor that follows your guests, every service',
  gm: 'Every send-home call made on time, not guessed',
  floor: 'A covered floor from first seating to close',
};

/**
 * The outcome first, per role: what tonight's answer saves or protects. Built
 * only from figures the page already computed; a missing figure drops the
 * line, it is never filled in.
 */
function outcomeFor(role, answer, { impact, perServer, usualRate, on, recap, meal, day }) {
  const cut = answer.cut;
  if (answer.done && recap?.idleHours) return { text: role === 'floor' ? `Next ${day}: a schedule sized to the guests you had` : `Next ${day}’s ${meal} can likely run with fewer servers` };
  if (answer.done && recap?.shortHours) return { text: `Next ${day}’s ${meal} needs one more on the floor` };
  if (answer.tone === 'neutral' || answer.empty) return null;
  if (cut) {
    if (role === 'owner') return { text: 'Labor back in line, even at the busiest likely finish' };
    if (role === 'floor') return perServer != null ? { text: `Your team stays covered to close: about ${perServer} guests per server an hour${usualRate ? ` (your usual is ${usualRate})` : ''}` } : { text: 'Your team covers the busiest likely finish' };
    return { text: `One call, made in time: ${on} → ${on - 1} servers${impact != null ? `, about ${cvMoney(impact)} of labor back` : ''}`, money: impact != null };
  }
  if (answer.short) return { text: role === 'owner' ? 'Protect sales at the rush: no table waits on a stretched server' : role === 'floor' ? 'Nobody stretched past their tables at the rush' : 'Staff the rush before it happens, not during it' };
  if (answer.tone === 'warn') return role === 'owner' ? { text: 'Protect tonight’s sales: keep the floor as it is' } : role === 'floor' ? { text: 'Keep everyone until the pace settles' } : { text: 'No send-home for now: guests are ahead of the forecast' };
  if (answer.blocked) return { text: 'Your own minimum sets the floor' };
  if (answer.tone === 'wait') return { text: role === 'owner' ? 'No labor at risk yet: checked again before any money is spent' : 'The call comes once the likely range is narrow enough' };
  return { text: role === 'owner' ? 'Labor matches demand: nothing to trim' : role === 'floor' ? 'Floor fully covered for the peak' : 'Staffing fits: no call needed' };
}
const hoursLabel = (m) => `${clockLabel(m.from * 60).replace(':00', '')}–${clockLabel(m.to * 60).replace(':00', '')}`;
const niceDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const pct = (p) => (p === 0 ? 'right on' : `${Math.abs(p)}% ${p < 0 ? 'under' : 'over'}`);
/** What tonight is compared with: Covercast’s forecast when it runs the page, else the usual night. */
const refOf = (L, Day) => (L?.engine ? 'Covercast’s forecast' : `a usual ${Day}`);
const plural = (w) => (/ch$/.test(w) ? `${w}es` : `${w}s`);
const SLOT_FLOOR = 6 * 60; // a picked value at or above this is a time in minutes, below it an hour

/** The role switch is a demo tool: shown only with ?tools=1, like the shell's own view-as. */
function useDemoTools() {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => { try { setOn(window.localStorage.getItem('cv-tools') === '1'); } catch { /* private window */ } }, []);
  return on;
}

/** The view (service, day, tabs) is remembered per browser, across rooms. */
function useView() {
  const [view, set] = React.useState(DEFAULT_VIEW);
  React.useEffect(() => {
    try { const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) || 'null'); if (v && typeof v === 'object') set({ ...DEFAULT_VIEW, ...v }); } catch { /* private window */ }
  }, []);
  const update = (patch) => set((v) => {
    const next = { ...v, ...patch };
    try { window.localStorage.setItem(VIEW_KEY, JSON.stringify(next)); } catch { /* private window */ }
    return next;
  });
  return [view, update];
}

async function call(path, init) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

/** Lunch and dinner today, live from Toast, refreshed every two minutes while the page is open and visible. */
function useLive(roomId, enabled) {
  const [live, setLive] = React.useState(null);
  React.useEffect(() => {
    if (!enabled) return undefined;
    let stop = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      call(`/api/page/service?roomId=${encodeURIComponent(roomId)}&meal=all`).then((b) => { if (!stop) setLive(b); }).catch(() => { if (!stop) setLive((l) => l ?? { error: true }); });
    };
    load();
    const t = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', load); };
  }, [roomId, enabled]);
  return live;
}

/* ================================================================ one shape for every live source */

/** A live service from Toast, in the page's one shape. */
function fromToast(r) {
  const n = r.night, c = n.call;
  return {
    source: 'toast', comp: n.comp, actual: n.actual, now: n.actual.length, start: n.win.start, end: n.win.end,
    factor: c.factor, spread: c.spread, calibrated: !!c.band?.calibrated, nights: n.weeks, so: c.so, cmp: c.cmp, pace: c.pace,
    remaining: c.remaining, range: c.range, serversNow: c.serversNow, needTop: c.needTop, needMid: c.needMid, floor: c.floor ?? null, mode: c.mode,
    at: c.at, value: c.value, checks: c.checks, why: c.why, checkAt: c.checkAt, stale: n.stale, dataThrough: n.dataThrough,
    execution: n.execution, fetchedAt: r.fetchedAt, engine: n.engine ?? null,
  };
}

/** The sample's fixed dinner scene, in the same shape. Its figures are the seed's, labelled as a sample. */
function fromSample(sv, cc, date, plan, fences) {
  // The scene's own call (cut, wait, quiet) stands; the pace and the likely finish are Covercast's when it has the day.
  const start = 17 * 60;
  const win = { start, end: start + sv.comp.length * SLOT_MIN };
  const cp = covercastPace(cc, date, { actual: sv.actual, now: sv.now, start, slots: sv.comp.length, service: 'dinner' });
  const useCc = !!cp;
  const comp = useCc ? cp.comp : sv.comp;
  const p = useCc
    ? (({ comp: _c, engine: _e, ...rest }) => rest)(cp)
    : pacing({ comp: sv.comp, actual: sv.actual, now: sv.now, spread: sv.mode === 'wait' ? 0.2 : bandSpread(sv.now, sv.comp.length) * 0.65 });
  const tile = sv.tiles.find((t) => t[0] === 'Servers on');
  const on = tile ? +tile[1] : null;
  // Servers needed come from the same forecast as the pace (the top of its range, from the send-home on), never the scene's typed tile.
  const at = sv.mode === 'cut' ? start + 12 * SLOT_MIN : start + (sv.now + 1) * SLOT_MIN;
  const needs = plan?.rate ? needsFrom({ comp, factor: p.factor, spread: p.spread, fromMin: at, win, rate: plan.rate }) : { needTop: null, needMid: null };
  const floor = fences ? fences.minDinner : null;
  return {
    source: 'sample', comp, actual: sv.actual, start, end: win.end, ...p, engine: useCc ? 'Covercast' : null,
    calibrated: true, nights: 4, serversNow: on, needTop: needs.needTop, needMid: needs.needMid, floor, mode: sv.mode === 'cut' ? 'cut' : sv.mode === 'wait' ? 'wait' : 'quiet',
    at: sv.mode === 'cut' ? at : null, value: sv.mode === 'cut' && plan?.wage ? Math.round(((win.end - at) / 60) * plan.wage) : null, why: null, checkAt: sv.mode === 'wait' ? 19 * 60 + 45 : null,
    stale: false, dataThrough: null, execution: null, fetchedAt: null, approval: sv.approval,
    who: (CV_D.room.queue || []).find((q) => q.approval && q.approval === sv.approval)?.when?.replace(/^staff:/, '') ?? null,
    vitals: Object.fromEntries((sv.tiles || []).map((x) => [x[0], { value: x[1], vs: x[2] }])),
    checks: [
      { key: 'demand', label: `${on != null ? on - 1 : '—'} servers cover the top of the likely range to close`, ok: on != null && needs.needTop != null ? on - 1 >= needs.needTop : null },
      { key: 'history', label: 'Covercast’s range measured on your own past dinners', ok: !!p.measured },
      { key: 'floor', label: 'Your fewest-servers rule still holds', ok: true },
      { key: 'roles', label: 'Sections and roles stay covered', ok: null, note: 'Sample: check the floor plan.' },
    ],
  };
}

/**
 * The sample's lunch today, already over at the sample's 7:15 pm: its guests
 * every 15 minutes against the plan's usual for each hour, in the same shape.
 */
function fromSampleLunch(lt, plan) {
  const comp = plan.hours.flatMap((h) => Array.from({ length: 60 / SLOT_MIN }, () => h.covers / (60 / SLOT_MIN)));
  const p = pacing({ comp, actual: lt.slots, now: lt.slots.length, spread: 0 });
  return {
    source: 'sample', comp, actual: lt.slots, start: lt.start, end: lt.start + comp.length * SLOT_MIN, ...p, engine: plan.engine ? 'Covercast' : null, calibrated: true, nights: plan.weeks,
    serversNow: lt.servers, needTop: null, needMid: null, mode: 'done', at: null, value: null, why: null, checkAt: null,
    stale: false, dataThrough: null, execution: null, fetchedAt: null, checks: [], who: null, vitals: null,
  };
}

/* ================================================================ the answer for one service */

/**
 * What to do for a service: the headline (what and when), why, what happens if
 * you say yes, and the one cut it allows. Never more than one call.
 */
function answerFor({ meal, plan, L, manual, isToday, nowMin, day, fences, own }) {
  const M = MEALS[meal];
  const Day = dayOf(day);
  const usual = plan ? plan.hours.reduce((t, h) => t + h.covers, 0) : null;
  const peak = plan ? plan.hours.reduce((a, b) => (b.peak > a.peak ? b : a)) : null;
  const before = isToday && nowMin < M.from * 60 - 30;
  const after = isToday && nowMin >= (L?.end ?? M.to * 60);
  // The hour most short of servers on the busiest recent week, if any.
  const short = plan ? plan.hours.filter((h) => h.need > Math.round(h.servers)).reduce((a, b) => (!a || b.need - Math.round(b.servers) > a.need - Math.round(a.servers) ? b : a), null) : null;
  const planCut = plan?.cutFrom != null && (!isToday || plan.cutFrom * 60 > nowMin) ? plan.cutFrom * 60 : null;
  const planned = (kicker) => planCut != null
    ? { tone: 'act', kicker, title: `Plan: 1 server can go home at ${clockLabel(planCut)}`, why: `On each of your last ${plan.weeks} ${Day}s, every hour from then had a spare server, even the busiest week.`, next: 'Look at the room first. Approving puts the 7shifts step on Today; nothing changes in 7shifts until someone does it.', cut: isToday ? { at: planCut, servers: Math.round(plan.hours.find((h) => h.hour === plan.cutFrom).servers), source: 'plan' } : null }
    : short ? { tone: 'warn', kicker, short: true, title: `Add ${short.need - Math.round(short.servers)} server${short.need - Math.round(short.servers) === 1 ? '' : 's'} for the ${clockLabel(short.hour * 60)} rush`, why: `Usually ${Math.round(short.servers)} on, and the busiest recent ${Day} needed ${short.need} at that hour.` }
    : { tone: 'good', kicker, blocked: !!plan.blocked, title: plan.blocked ? (plan.blocked.why === 'floor' ? `Keep at least ${meal === 'dinner' ? fences.minDinner : fences.minAny} servers on` : 'Keep everyone on') : `Keep ${Math.round(peak.servers)} servers on for the ${clockLabel(peak.hour * 60)} peak`, why: plan.blocked ? plan.blocked.text : plan.engine ? `Covercast expects ${usual} covers, and every hour needs the servers usually on.` : `Usually ${usual} covers. Every hour on recent ${Day}s used all its servers.` };

  if (!plan && !L && !manual) return { tone: 'neutral', kicker: `${M.label} · no data yet`, title: `No ${M.label.toLowerCase()} history yet`, why: own ? `Needs Toast orders and time entries for ${M.label.toLowerCase()} on ${Day}s.` : `The sample group only has dinner. Pick Dinner to see the sample night.`, empty: own };
  if (!isToday) return planned(`${NAMES.brief} · ${M.label}, ${Day}`);
  if (L && after) return { tone: 'good', done: true, kicker: `${M.label} is done`, title: `${L.so} guests served`, why: `${pct(L.pace)[0].toUpperCase()}${pct(L.pace).slice(1)} ${refOf(L, Day)}${L.engine ? ` of ${Math.round(L.comp.reduce((t, c) => t + c, 0))}` : ''}.` };
  if (manual && after) return { tone: 'good', kicker: `${M.label} is done`, title: `${manual.covers} guests by your count`, why: manual.typical ? `A usual ${Day} has ${manual.typical} by ${clockLabel(clockMinutes(manual.at))}.` : 'Your count.' };
  if (before && !L && !manual) return plan ? planned(`${NAMES.brief} · ${M.label} starts at ${clockLabel(M.from * 60)}`) : { tone: 'neutral', kicker: `${M.label} starts at ${clockLabel(M.from * 60)}`, title: 'Nothing to do yet', why: '' };

  if (L) {
    const vs = `Guests are ${pct(L.pace)} ${refOf(L, Day)}`;
    const lo = Math.round(L.cmp * (1 - L.spread)), hi = Math.round(L.cmp * (1 + L.spread));
    if (L.mode === 'cut') return { tone: 'act', kicker: `${NAMES.call} · decide by ${clockLabel(L.at)}`, title: `Send 1 server home at ${clockLabel(L.at)}`, why: `${vs}. ${L.serversNow - 1} servers can handle up to ${L.so + L.range[1]} guests, the top of the likely range.`, next: `Approving puts the 7shifts step on Today. Nothing changes in 7shifts until someone does it${L.source === 'toast' ? ', and Toast clock-ins confirm it' : ''}.`, cut: { at: L.at, servers: L.serversNow, source: 'live' } };
    if (L.mode === 'stale') return { tone: 'warn', kicker: 'Toast is late', title: 'No call until Toast catches up', why: `No new orders since ${L.dataThrough != null ? clockLabel(L.dataThrough) : 'service started'}. Check the room yourself.` };
    if (L.so > hi) return { tone: 'warn', kicker: L.engine ? 'Busier than forecast' : 'Busier than usual', title: L.serversNow != null ? `Keep all ${L.serversNow} servers on` : 'Keep everyone on', why: `${vs}, above its likely range. Keep everyone on until the pace settles.` };
    if (L.mode === 'wait') return { tone: 'wait', kicker: 'Watching', title: L.why === 'history' ? 'Looks quiet, but too few past days to act' : `Looks quiet. Next check ${clockLabel(L.checkAt)}`, why: L.why === 'history' ? `Needs ${MIN_CALIBRATED} recent ${Day}s to be sure; has ${L.nights}. Keep everyone on.` : `${vs}, but the likely range is still too wide to send anyone home.` };
    if (L.mode === 'late') return { tone: 'good', kicker: 'Nothing to do', title: 'Keep everyone on to close', why: `It’s past your latest time to send someone home (${clockLabel(fences.cutBy)}).` };
    if (L.mode === 'unknown') return { tone: 'neutral', kicker: 'No servers clocked in', title: 'No staffing call yet', why: 'Nobody with a server job is clocked in on Toast.' };
    if (L.mode === 'early') return { tone: 'neutral', kicker: `${M.label} just started`, title: `First check at ${clockLabel(L.checkAt)}`, why: 'Too early to tell how it’s going.' };
    return { tone: 'good', kicker: 'On track', title: 'Keep everyone on', why: L.so < lo ? `${vs}, but everyone on is still needed.` : `${vs}. Likely ${L.so + L.range[0]}–${L.so + L.range[1]} guests by close.` };
  }
  if (manual) {
    if (manual.tone === 'warn') return { tone: 'warn', kicker: `${manual.label} · your count`, title: 'Keep everyone on', why: `Your ${manual.covers} guests is above the busiest recent ${Day} by then (${manual.busiest}).` };
    if (manual.staff === 'short') return { tone: 'warn', kicker: 'Short on the floor · your count', title: 'Add 1 server if you can', why: `${manual.servers} on, and the busiest recent ${Day} needed ${manual.need} at this hour.` };
    return plan ? planned(`${manual.label} · your count`) : { tone: 'neutral', kicker: 'Your count', title: `${manual.covers} guests so far`, why: `No ${M.label.toLowerCase()} history to compare with yet.` };
  }
  return planned(`${NAMES.brief} · ${M.label}`);
}

/* ================================================================ small pieces */

const TONE_ICON = { act: 'UserMinus', good: 'CircleCheck', warn: 'TriangleAlert', neutral: 'Activity', wait: 'Hourglass' };

function Seg({ value, options, onChange, label, wide = false }) {
  return (
    <div className={`${s.seg} ${wide ? s.segWide : ''}`} role="group" aria-label={label}>
      {options.map(([k, text, icon]) => (
        <button key={k} type="button" className={`${s.segBtn} ${value === k ? s.segOn : ''}`} aria-pressed={value === k} onClick={() => onChange(k)}>
          {icon && <Icon name={icon} size={15} />}{text}
        </button>
      ))}
    </div>
  );
}

/** A service card in the strip: also the switch between Lunch, Dinner and Full day. */
function MealCard({ id, active, onPick, title, hours, state, big, unit, foot, tone }) {
  return (
    <button type="button" className={`${s.meal} ${active ? s.mealOn : ''}`} aria-pressed={active} onClick={() => onPick(id)}>
      <span className={s.mealTop}>
        <span className={s.mealName}><Icon name={MEAL_ICON[id]} size={16} />{title}{hours && <span className={s.mealHours}>{hours}</span>}</span>
        {state && <span className={`${s.mealState} ${s[`ms_${tone}`] || ''}`}>{state}</span>}
      </span>
      <span className={s.mealMain}><span className={`${s.mealBig} ${big == null ? s.none : ''}`}>{big ?? '—'}</span><span className={s.mealUnit}>{unit}</span></span>
      <span className={s.mealFoot}>{foot}</span>
    </button>
  );
}

/** Servers as seats: filled are needed, open are spare, dashed is the one to send home, red outline is a gap. */
function Seats({ on, need, gone }) {
  if (on == null) return null;
  return (
    <span className={s.seats} aria-hidden="true">
      {Array.from({ length: Math.min(Math.max(on, need ?? 0), 12) }, (_, i) => <span key={i} className={`${s.seatDot} ${i >= on ? s.seatShort : i < (need ?? on) ? '' : gone && i === on - 1 ? s.seatGone : s.seatSpare}`} />)}
    </span>
  );
}

function Checks({ checks }) {
  return (
    <ul className={s.checks} aria-label="Checks before sending someone home">
      {checks.map((c) => (
        <li key={c.key} className={c.ok === true ? s.pass : c.ok === false ? s.fail : s.yours}>
          <Icon name={c.ok === true ? 'CircleCheck' : c.ok === false ? 'CircleX' : 'CircleHelp'} size={16} />
          <span><span className="sr-only">{c.ok === true ? 'Passes: ' : c.ok === false ? 'Fails: ' : 'Yours to check: '}</span>{c.label}{c.note ? <span className="cv-faint"> {c.note}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

function Note({ tone = 'neutral', icon = 'Info', children, action }) {
  return <div className={`${s.note} ${s[`n_${tone}`] || ''}`}><Icon name={icon} size={16} /><span>{children}</span>{action}</div>;
}

/** Your own count, typed in: guests so far, servers on, and as of when. Never shown as live. */
function ManualForm({ meal, entry, nowMin, onSave, primary }) {
  const [covers, setCovers] = React.useState(entry?.covers ?? '');
  const [servers, setServers] = React.useState(entry?.servers ?? '');
  const [at, setAt] = React.useState(entry?.at ?? hhmm(Math.floor(nowMin / SLOT_MIN) * SLOT_MIN));
  const ok = covers !== '' && Number.isInteger(+covers) && +covers >= 0 && +covers <= 5000 && (servers === '' || (Number.isInteger(+servers) && +servers >= 0 && +servers <= 200)) && /^\d{2}:\d{2}$/.test(at);
  const step = (set, v, d, max) => set(String(Math.max(0, Math.min(max, (v === '' ? 0 : +v) + d))));
  return (
    <form className={s.manual} onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ meal, at, covers: +covers, servers: servers === '' ? null : +servers }); }}>
      <label className={s.field}><span>Guests so far</span>
        <span className={s.stepper}><button type="button" aria-label="One fewer guest" onClick={() => step(setCovers, covers, -1, 5000)}>−</button><input className="input" type="number" inputMode="numeric" min="0" max="5000" value={covers} onChange={(e) => setCovers(e.target.value)} required /><button type="button" aria-label="One more guest" onClick={() => step(setCovers, covers, 1, 5000)}>+</button></span>
      </label>
      <label className={s.field}><span>Servers on now</span>
        <span className={s.stepper}><button type="button" aria-label="One fewer server" onClick={() => step(setServers, servers, -1, 200)}>−</button><input className="input" type="number" inputMode="numeric" min="0" max="200" value={servers} onChange={(e) => setServers(e.target.value)} /><button type="button" aria-label="One more server" onClick={() => step(setServers, servers, 1, 200)}>+</button></span>
      </label>
      <label className={`${s.field} ${s.fieldTime}`}><span>As of</span><input className="input" type="time" step="900" value={at} onChange={(e) => setAt(e.target.value)} /></label>
      <Button type="submit" variant={primary ? 'primary' : 'secondary'} icon="Check" disabled={!ok} className={primary ? s.cta : undefined}>{entry ? 'Update count' : 'Save count'}</Button>
    </form>
  );
}

/* ================================================================ the page */

function CvService() {
  const cv = useCv();
  const eng = useEngine();
  const server = eng.mode === 'server';
  const own = !!CV_D.room.fromToast;
  const [view, setView] = useView();
  const tools = useDemoTools();
  const [more, setMore] = React.useState(false);
  const [showDetail, setShowDetail] = React.useState(false);
  const live = useLive(CV_D.id, server && own);
  const [fencesSaved] = useSaved('fences', null);
  const myRole = ['gm', 'floor'].includes(eng.viewer?.role) ? eng.viewer.role : cv.role === 'gm' ? 'gm' : 'owner';
  const role = view.role ?? myRole;
  const fences = fencesOf(fencesSaved);

  // The clock: the room's own when Toast answered, the sample's fixed evening, else this device's.
  const clock = own
    ? (live?.dinner?.date ? { date: live.dinner.date, day: live.dinner.day, minutes: live.dinner.nowMin } : localNow(new Date()))
    : { date: CV_NOW.iso, day: dayOfDate(CV_NOW.iso), minutes: clockMinutes(CV_NOW.time) ?? 19 * 60 + 15 };
  const date = view.when === 'today' ? clock.date : view.when === 'tomorrow' ? addDays(clock.date, 1) : /^\d{4}-\d{2}-\d{2}$/.test(view.when) ? view.when : clock.date;
  const isToday = date === clock.date;
  const day = dayOfDate(date);
  const nowMin = clock.minutes;

  const cc = useCovercast(CV_D.room, CV_D.id, server);
  const sp = cc ? shiftPulseDay(cc, date) : null;
  const plans = { lunch: servicePlan(CV_D.room, day, fencesSaved, 'lunch', sp?.lunch ?? null), dinner: servicePlan(CV_D.room, day, fencesSaved, 'dinner', sp?.dinner ?? null) };
  const outlook = dayOutlook(plans);

  // Live per service (today only).
  const liveFor = (m) => {
    if (!isToday) return null;
    if (!own) {
      if (m === 'dinner') return CV_D.room.service ? fromSample(CV_D.room.service, cc, date, plans.dinner, fences) : null;
      const lt = CV_D.room.levers?.lunchToday;
      return lt && lt.day === day && plans.lunch ? fromSampleLunch(lt, plans.lunch) : null;
    }
    const r = live?.[m];
    return r?.live ? fromToast(r) : null;
  };
  const lives = { lunch: liveFor('lunch'), dinner: liveFor('dinner') };

  // Your own counts today; the latest per service is the one used.
  const [manualSaved, setManual] = useSaved('service.manual', null);
  const entries = manualSaved?.date === clock.date && Array.isArray(manualSaved.entries) ? manualSaved.entries : [];
  const latest = (m) => [...entries].reverse().find((e) => e.meal === m) ?? null;
  const manualFor = (m) => {
    const e = isToday && !lives[m] ? latest(m) : null;
    if (!e) return null;
    const r = plans[m] ? manualNight({ plan: plans[m], covers: e.covers, servers: e.servers, atMin: clockMinutes(e.at) ?? nowMin }) : null;
    return { ...(r ?? { covers: e.covers, servers: e.servers, typical: null, busiest: null, need: null, tone: 'neutral', label: 'Your count', staff: null, pace: null }), at: e.at, saved: e.saved };
  };
  const manuals = { lunch: manualFor('lunch'), dinner: manualFor('dinner') };

  // Which service the page is about: the one picked, or for Full day the one on now.
  const current = isToday ? mealOf(Math.floor(nowMin / 60)) : 'dinner';
  const meal = view.meal === 'day' ? current : view.meal === 'lunch' ? 'lunch' : 'dinner';
  const M = MEALS[meal];
  const plan = plans[meal];
  const L = lives[meal];
  const manual = manuals[meal];
  const wage = plan?.wage ?? null;
  const answer = answerFor({ meal, plan, L, manual, isToday, nowMin, day, fences, own });
  const rows = hourRows(plan);

  // Today's one decision (one send-home a day), and the task it made.
  const [saved, setNight] = useSaved('service.night', null);
  const night = saved?.date === clock.date ? saved : null;
  const task = (eng.tasks || []).find((t) => t.roomId === CV_D.id && isCutFor(t.approvalId, clock.date) && t.status !== 'cancelled');
  const later = night?.answer === 'later' && night.until && clockMinutes(night.until) > nowMin ? night : null;
  const [busy, setBusy] = React.useState(false);
  const [sel, setSel] = React.useState(null); // a picked time (minutes, ≥ 6 am) or an hour

  const record = (next, summary) => {
    const entry = { date: clock.date, meal, answer: next.answer, at: next.at ?? null, ...(next.approvalId ? { approvalId: next.approvalId } : {}), ...(next.to ? { to: next.to } : {}), when: new Date().toISOString() };
    const past = [entry, ...(saved?.past ?? [])].slice(0, 30);
    const value = { date: clock.date, meal, answer: next.answer, at: next.at ?? null, ...(next.approvalId ? { approvalId: next.approvalId } : {}), ...(next.until ? { until: next.until } : {}), ...(next.to ? { to: next.to } : {}), past };
    setNight(value, summary);
  };

  const cut = answer.cut;
  const approve = async () => {
    if (!cut || busy) return;
    if (!own) { cv.approve(L?.approval ?? 'tue-cut', () => record({ answer: 'yes', at: hhmm(cut.at), approvalId: L?.approval }, `${M.label}: send 1 server home at ${clockLabel(cut.at)} approved`)); return; }
    setBusy(true);
    try {
      let a;
      if (server) a = (await call('/api/page/service/cut', { method: 'POST', body: JSON.stringify({ roomId: CV_D.id, date: clock.date, at: hhmm(cut.at) }) })).approval;
      else a = { approvalId: cutApprovalId(clock.date, cut.at), title: `${day} ${clock.date}: one fewer server from ${clockLabel(cut.at)} to close`, system: '7shifts', diff: [[`${day} ${clockLabel(cut.at)} to close`, `${cut.servers} servers`, `${cut.servers - 1} servers`]] };
      await engine.createTask(a.approvalId, a);
      record({ answer: 'yes', at: hhmm(cut.at), approvalId: a.approvalId }, `${M.label}: send 1 server home at ${clockLabel(cut.at)} approved`);
      cv.toast('Approved. The 7shifts step is on Today. Nothing has changed in 7shifts yet.');
    } catch (err) {
      cv.toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const decline = () => { record({ answer: 'no', at: cut ? hhmm(cut.at) : null }, `${M.label}: kept everyone on`); cv.toast('Kept everyone on. Saved.'); };
  const snooze = () => {
    const until = hhmm(Math.min(23 * 60 + 45, Math.ceil((nowMin + 30) / SLOT_MIN) * SLOT_MIN));
    record({ answer: 'later', at: cut ? hhmm(cut.at) : null, until }, `${M.label}: decide again at ${clockLabel(clockMinutes(until))}`);
    cv.toast(`We’ll ask again at ${clockLabel(clockMinutes(until))}.`);
  };
  const handoff = (to) => {
    record({ answer: 'ask', at: cut ? hhmm(cut.at) : null, to }, `${M.label}: send-home call handed to the ${HANDOFF[to]}`);
    cv.toast(`Saved: handed to the ${HANDOFF[to]}.`);
  };
  const reopen = async () => {
    if (task?.status === 'open') await engine.taskAction(task.id, 'cancel');
    record({ answer: 'ask', at: null }, 'Service answer reopened');
  };
  const saveManual = (e) => {
    const next = { date: clock.date, entries: [...entries, { ...e, saved: new Date().toISOString() }].slice(-24) };
    setManual(next, `${MEALS[e.meal].label} count for ${clockLabel(clockMinutes(e.at))}: ${e.covers} guests${e.servers != null ? `, ${e.servers} servers` : ''}`);
    cv.toast('Saved your count. The page uses it now.');
  };

  // The source line: what this is, and how fresh. Typed counts never read as live.
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 6e4); return m <= 1 ? 'just now' : `${m} min ago`; };
  const weeks = plan?.weeks ?? plans.lunch?.weeks ?? plans.dinner?.weeks;
  const source = !isToday ? { dot: '', text: plan?.engine ? `Covercast plan for ${niceDate(date)} · not a live count` : `Plan for ${niceDate(date)} · ${weeks ? `from your last ${weeks} ${dayOf(day)}s` : 'no history yet'} · not a live count` }
    : L?.source === 'toast' ? { dot: L.stale ? '' : s.live, text: `Live from Toast · orders through ${L.dataThrough != null ? clockLabel(L.dataThrough) : '—'} · updated ${ago(L.fetchedAt)}` }
      : L?.source === 'sample' ? { dot: '', text: 'Sample night · a fixed scene, not live data' }
        : manual ? { dot: s.typed, text: `Your count · typed for ${clockLabel(clockMinutes(manual.at))} · not a live feed` }
          : plan ? { dot: '', text: `Plan from your recent ${dayOf(day)}s · no live count yet` } : { dot: '', text: `No ${M.label.toLowerCase()} data yet` };

  const lv = live?.[meal];
  const banner = !own || !server || !isToday ? null
    : live == null ? <Note icon="Loader">Checking Toast…</Note>
      : live.error ? <Note tone="warn" icon="TriangleAlert">Couldn’t reach Coversight just now. Type your count in the card.</Note>
        : lv?.why === 'not-connected' ? <Note icon="PlugZap" action={<Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('connect')}>Connect Toast</Button>}>Toast isn’t connected. Type your count in the card, or connect Toast to track service live.</Note>
          : lv?.why === 'error' ? <Note tone="warn" icon="TriangleAlert">{lv.message || 'Couldn’t reach Toast.'} Type your count in the card.</Note>
            : lv?.why === 'no-history' ? <Note icon="Hourglass">Live tracking starts once two recent {dayOf(day)}s are synced from Toast. Type your count until then.</Note>
              : null;

  /* ---------- the strip: Lunch, Dinner, Full day ---------- */
  const mealCard = (m) => {
    const p = plans[m], l = lives[m], mn = manuals[m], Mm = MEALS[m];
    const o = outlook[m];
    const state = !isToday ? 'Plan' : nowMin >= (l?.end ?? Mm.to * 60) ? 'Done' : nowMin >= Mm.from * 60 - 30 ? 'Now' : 'Later';
    if (l) {
      const done = nowMin >= l.end;
      const usualTotal = Math.round(l.comp.reduce((t, c) => t + c, 0));
      const ref = l.engine ? 'forecast' : 'usual';
      return { big: done ? l.so : l.so + l.remaining, unit: done ? 'guests served' : 'guests expected', foot: done ? `${pct(l.pace)} ${ref}` : `${l.so} so far · ${ref} ${usualTotal}`, state: done ? 'Done' : l.mode === 'cut' ? 'Overstaffed' : l.so > Math.round(l.cmp * (1 + l.spread)) ? (l.engine ? 'Busier than forecast' : 'Busier than usual') : l.source === 'sample' ? 'Sample' : 'Live', tone: done ? 'done' : l.mode === 'cut' ? 'bad' : l.so > Math.round(l.cmp * (1 + l.spread)) ? 'warn' : 'now' };
    }
    if (mn) return { big: mn.covers, unit: 'guests, your count', foot: `for ${clockLabel(clockMinutes(mn.at))}${mn.typical ? ` · usual by then ${mn.typical}` : ''}`, state: state === 'Done' ? 'Done' : 'Typed', tone: 'typed' };
    if (!p) return { big: null, unit: 'no history', foot: isToday && own && state !== 'Later' ? 'Type your count to track it' : `No ${Mm.label.toLowerCase()} data for ${dayOf(day)}s`, state: null, tone: '' };
    return { big: o.usual, unit: p.engine ? 'covers forecast' : 'usual covers', foot: p.engine ? `likely up to ${o.busiest}` : `busiest recent week ${o.busiest}`, state, tone: state === 'Now' ? 'now' : '' };
  };
  const lc = mealCard('lunch'), dc = mealCard('dinner');
  const both = lc.big != null && dc.big != null;
  const dayTotal = both ? lc.big + dc.big : lc.big ?? dc.big ?? null;
  const dayFoot = !both && dayTotal != null ? `${lc.big != null ? 'lunch' : 'dinner'} only · no ${lc.big != null ? 'dinner' : 'lunch'} data` : [lc, dc].some((c) => ['Live', 'Typed', 'Done', 'Sample'].includes(c.state)) ? 'served + expected, both services' : outlook.services ? `usual for a ${dayOf(day)}` : 'no history yet';

  /* ---------- level 1: the answer ---------- */
  const ex = L?.execution;
  const decided = night && (night.answer === 'yes' || night.answer === 'no') ? night : null;
  const yes = !!task || decided?.answer === 'yes';
  const state = cut && (yes || decided || later) ? (
    <div className={s.stateBox}>
      {yes
        ? (() => {
          const [icon, label, tone] = ex?.state === 'breach' ? ['TriangleAlert', 'Guests above the range since: consider calling them back', 'bad']
            : ex?.state === 'confirmed' ? ['CircleCheck', `${NAMES.proof} · confirmed`, 'good']
              : task?.status === 'done' ? ['ListChecks', 'Marked done on Today · not yet seen in Toast', 'info']
                : ['Hourglass', 'Approved · waiting for the 7shifts change', 'info'];
          return <Pill tone={tone} icon={icon}>{label}</Pill>;
        })()
        : decided?.answer === 'no' ? <Pill icon="CircleMinus">Kept everyone on</Pill>
          : <Pill icon="Timer">We’ll ask again at {clockLabel(clockMinutes(later.until))}</Pill>}
      {ex?.text && <span className="cv-xs cv-muted">{ex.text}</span>}
      <div className={s.actions}>
        {yes && <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('today')}>Open Today</Button>}
        <Button size="sm" variant="ghost" icon="Undo2" onClick={reopen}>{later ? 'Decide now' : task?.status === 'open' ? 'Undo' : 'Change'}</Button>
      </div>
    </div>
  ) : null;

  const showManual = isToday && own && !L;
  const before = cut ? { on: cut.servers, need: cut.servers - 1 } : null;
  const impact = cut ? (cut.source === 'live' ? L.value : plan?.value ?? null) : null;
  const hoursLeft = cut ? Math.max(0, ((L?.end ?? M.to * 60) - cut.at) / 60) : 0;
  const hl = hoursLeft % 1 ? hoursLeft.toFixed(1) : String(hoursLeft);

  // Guests each remaining server would look after an hour, from the send-home to close.
  const perServer = (() => {
    if (!cut || cut.servers < 2 || !hoursLeft) return null;
    // Same source as the usual rate it's compared with: the recent same weekdays, hour by hour.
    const left = rows.filter((r) => r.hour * 60 >= cut.at).reduce((t, r) => t + r.usual, 0);
    return left > 0 ? Math.round(left / hoursLeft / (cut.servers - 1)) : null;
  })();
  // A finished service, looked back on (today only): idle or short server-hours from its own counts.
  const recap = isToday && L && nowMin >= L.end && L.serversNow != null ? serviceRecap({ plan, slots: L.actual, start: L.start, servers: L.serversNow, wage }) : null;
  const promise = outcomeFor(role, answer, { impact, perServer, usualRate: plan?.rate ? Math.round(plan.rate) : null, on: cut?.servers, recap, meal: M.label.toLowerCase(), day: dayOf(day) });

  /* ---------- level 2 ---------- */
  const tab = view.tab;
  const nowHour = isToday ? Math.floor(nowMin / 60) : null;
  const ended = isToday && nowMin >= (L?.end ?? M.to * 60);
  const ahead = rows.filter((r) => !isToday || ended || r.hour >= Math.floor(nowMin / 60));
  const selHour = sel == null ? null : sel >= SLOT_FLOOR ? Math.floor(sel / 60) : sel;
  // Tonight, at and after now, the tooltip reads the same servers-on and needed as the vitals; earlier times read the plan.
  const tonightNeed = L && L.needTop != null ? Math.max(L.needTop, L.floor ?? 0) : null;
  const staffAt = (min) => {
    if (L && L.serversNow != null && tonightNeed != null && min >= L.start + (L.now - 1) * SLOT_MIN && nowMin < L.end) return `${L.serversNow} on · ${tonightNeed} needed${tonightNeed > L.needTop ? ' (your minimum)' : ''}`;
    const h = rows.find((r) => r.hour === Math.floor(min / 60));
    return h ? `${Math.round(h.servers)} usually on · ${h.need} needed` : null;
  };
  const refWord = L?.engine ? 'forecast' : 'usual';

  const chartTitle = `${NAMES.pace} · ` + (tab === 'forecast' ? (L ? `${M.label} guests through closing` : `${M.label} covers each hour`) : tab === 'staffing' ? `${M.label} servers on and needed` : `${M.label} guests per server`);
  const chartSub = !L && !plan ? '' : tab === 'forecast' ? (L ? `Served so far, ${refOf(L, dayOf(day))}, and the likely finish.` : plan.engine ? 'Covercast’s forecast and the top of its likely range.' : `A usual ${dayOf(day)} and the busiest of your last ${plan.weeks}.`)
    : tab === 'staffing' ? (plan?.engine ? 'Servers usually on each hour, against what Covercast says is needed (never below your minimum).' : 'Servers usually on each hour, against what the busiest recent week needed.') : 'Guests each server handles each hour, against your own average.';
  const stats = tab === 'forecast' && L ? [
    ['Guests so far', L.so],
    [L.now < L.comp.length ? 'Expected at close' : 'At close', L.so + L.remaining],
    ['Likely finish', L.now < L.comp.length ? `${L.so + L.range[0]}–${L.so + L.range[1]}` : '—'],
  ] : rows.length ? (tab === 'performance' ? [
    ['Your average', plan.rate.toFixed(1)],
    ['Busiest hour', `${Math.max(...rows.map((r) => r.perServer ?? 0))}`],
    ['Quietest hour', `${Math.min(...rows.map((r) => r.perServer ?? Infinity))}`],
  ] : tab === 'staffing' ? [
    ['Spare server-hours', rows.reduce((t, r) => t + r.spare, 0)],
    ['Short server-hours', rows.reduce((t, r) => t + r.short, 0)],
    ['Peak needed', Math.max(...rows.map((r) => r.need))],
  ] : [
    [plan.engine ? 'Covers forecast' : 'Usual covers', planTotals(plan).covers],
    [plan.engine ? 'Likely range' : 'Busiest week', plan.engine ? `${planTotals(plan).low}–${planTotals(plan).high}` : planTotals(plan).high],
    ['Peak servers needed', Math.max(...rows.map((r) => r.need))],
  ]) : [];

  /* ---------- level 3 ---------- */
  const slots = L ? slotRows({ comp: L.comp, actual: L.actual, now: L.now, factor: L.factor, spread: L.spread, start: L.start }) : [];
  const exportCsv = () => {
    const parts = [];
    for (const m of ['lunch', 'dinner']) {
      const l = lives[m];
      if (l) parts.push(`# ${MEALS[m].label} ${date}, every 15 minutes (${l.source === 'sample' ? 'sample' : 'Toast'})`, toCsv(slotRows({ comp: l.comp, actual: l.actual, now: l.now, factor: l.factor, spread: l.spread, start: l.start }).map((r) => ({ time: r.label, usual: r.usual, served: r.served, expected: r.expected, low: r.low, high: r.high }))));
      if (plans[m]) parts.push(`# ${MEALS[m].label} on ${dayOf(day)}s, hour by hour (last ${plans[m].weeks} weeks)`, toCsv(hourRows(plans[m]).map((r) => ({ hour: r.label, usual_covers: r.usual, busiest_covers: r.busiest, servers_usually_on: r.servers, servers_needed: r.need, spare: r.spare, short: r.short, guests_per_server: r.perServer }))));
      const typed = entries.filter((e) => e.meal === m);
      if (typed.length) parts.push(`# ${MEALS[m].label} ${clock.date}, your counts (typed, not live)`, toCsv(typed.map((e) => ({ as_of: e.at, guests: e.covers, servers: e.servers, saved: e.saved }))));
    }
    if (!parts.length) { cv.toast('Nothing to export yet.'); return; }
    const blob = new Blob([`${parts.join('\n\n')}\n`], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `service-${CV_D.id}-${date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const checks = L?.checks ?? (plan ? [
    { key: 'peak', label: 'Every hour after had a spare server, even in its busiest week', ok: plan.spareFrom != null },
    { key: 'history', label: `At least ${MIN_CALIBRATED} recent ${dayOf(day)}s`, ok: plan.weeks >= MIN_CALIBRATED },
    { key: 'floor', label: `At least ${meal === 'dinner' ? fences.minDinner : fences.minAny} servers stay on`, ok: plan.blocked?.why !== 'floor' },
    { key: 'cutBy', label: `Before ${clockLabel(fences.cutBy)}, your latest time`, ok: plan.blocked?.why !== 'late' },
    { key: 'live', label: 'Today’s real guests', ok: null, note: 'This is a plan from recent weeks. Look at the room first.' },
    { key: 'roles', label: 'Sections and roles stay covered', ok: null, note: 'Toast doesn’t show sections.' },
  ] : []);
  const past = (saved?.past ?? []).filter((p) => p.answer !== 'ask' || p.to).slice(0, 12);
  const outcome = (p) => {
    if (p.answer === 'later') return 'Asked to decide later';
    if (p.answer === 'no') return 'Kept everyone on';
    if (p.answer === 'ask') return p.to ? `Handed to the ${HANDOFF[p.to]}` : 'Reopened';
    const t = (eng.tasks || []).find((x) => x.approvalId === p.approvalId);
    if (!t) return 'Approved';
    return { open: 'Approved · not done yet', done: 'Marked done on Today', verified: 'Confirmed', mismatch: 'Didn’t match Toast', cancelled: 'Undone' }[t.status] ?? 'Approved';
  };
  const detailTabs = [['slots', 'Every 15 minutes'], ['hours', 'Hour by hour'], ['rules', NAMES.guard], ['money', 'The money'], ['past', 'Past decisions'], ['busy', 'Busy times']];
  const pick = sel == null ? null : sel >= SLOT_FLOOR ? sel : sel * 60;

  // The problem and the fix, side by side: only figures the page already computed.
  const okChecks = checks.filter((c) => c.ok === true).length;
  const yourChecks = checks.filter((c) => c.ok == null).length;
  const spareHrs = rows.reduce((t, r) => t + r.spare, 0);
  const peakNeed = rows.length ? Math.max(...rows.map((r) => r.need)) : null;
  const busier = L && !ended && L.so > Math.round(L.cmp * (1 + L.spread));
  const pf = cut ? {
    problem: { head: `Overstaffed after ${clockLabel(cut.at)}`, big: '1 idle server', foot: `for about ${hl} hour${hoursLeft === 1 ? '' : 's'}${impact != null ? ` · ${cvMoney(impact)} of labor` : ''}`, est: impact != null },
    fix: { label: NAMES.call, head: `Send ${L?.who ?? '1 server'} home at ${clockLabel(cut.at)}`, ba: [before.on, before.need], foot: `${L ? `Handles up to ${L.so + L.range[1]} guests · ` : ''}${NAMES.guard}: ${okChecks} checks pass${yourChecks ? `, ${yourChecks} for you to look at` : ''}` },
  } : recap?.idleHours ? {
    problem: { head: `${M.label} ran overstaffed`, big: `${recap.idleHours} idle server-hour${recap.idleHours === 1 ? '' : 's'}`, foot: `${recap.hours[0].on} on all ${M.label.toLowerCase()} for ${recap.guests} guests${recap.idleCost != null ? ` · about ${cvMoney(recap.idleCost)} of labor` : ''}`, est: recap.idleCost != null },
    fix: { label: NAMES.brief, head: `Next ${dayOf(day)}: staff to the ${clockLabel(recap.busiest * 60)} peak`, big: `${recap.peakNeed} server${recap.peakNeed === 1 ? '' : 's'}`, foot: `instead of ${recap.hours[0].on}${recap.peakByRule ? ', your own minimum' : `, at your own ${Math.round(plan.rate)} guests per server an hour`}` },
  } : recap?.shortHours ? {
    problem: { head: `${M.label} ran short`, big: `${recap.shortHours} short server-hour${recap.shortHours === 1 ? '' : 's'}`, foot: `${recap.hours[0].on} on for ${recap.guests} guests` },
    fix: { label: NAMES.brief, head: `Next ${dayOf(day)}: add one for the ${clockLabel(recap.busiest * 60)} peak`, big: `${recap.peakNeed} servers`, foot: `at your own ${Math.round(plan.rate)} guests per server an hour` },
  } : busier ? {
    problem: { head: L.engine ? 'Busier than forecast' : 'Busier than usual', big: `${Math.abs(L.pace)}% over`, foot: `guests against ${refOf(L, dayOf(day))}` },
    fix: { label: NAMES.guard, head: 'Keep everyone on', big: L.serversNow != null ? `${L.serversNow} servers` : 'Everyone', foot: 'until the pace settles back into the likely range' },
  } : !L && !manual && plan && answer.short ? {
    problem: { head: `Short at the ${clockLabel(rows.reduce((a, b) => (b.short > a.short ? b : a)).hour * 60)} rush`, big: `${rows.reduce((t, r) => t + r.short, 0)} short server-hour${rows.reduce((t, r) => t + r.short, 0) === 1 ? '' : 's'}`, foot: `on the busiest recent ${dayOf(day)}: slower tables, stretched servers` },
    fix: { label: NAMES.brief, head: plan.engine ? 'Schedule for the top of the likely range' : 'Schedule for the busiest recent day', big: `${peakNeed} servers`, foot: `at the peak, at your own ${Math.round(plan.rate)} guests per server an hour` },
  } : !L && !manual && plan && spareHrs > 0 ? {
    problem: { head: plan.engine ? `Idle labor in the ${dayOf(day)} plan` : `Idle labor on a usual ${dayOf(day)}`, big: `${spareHrs} server-hour${spareHrs === 1 ? '' : 's'}`, foot: wage ? `about ${cvMoney(spareHrs * wage)} with nothing to do` : 'with nothing to do', est: !!wage },
    fix: { label: NAMES.brief, head: `Schedule for the ${clockLabel(rows.find((r) => r.need === peakNeed).hour * 60)} peak`, big: `${peakNeed} server${peakNeed === 1 ? '' : 's'}`, foot: rows.find((r) => r.need === peakNeed)?.byRule ? 'at the peak · your own minimum' : plan.engine ? 'at the peak, sized to the top of the likely range' : 'at the peak, even in the busiest recent week' },
  } : null;

  // Service vitals: the four numbers a manager checks on the floor. Missing ones say where they'd come from.
  const num = (v) => { const m = String(v ?? '').match(/\d+(\.\d+)?/); return m ? +m[0] : null; };
  const vit = !isToday || (!L && !manual) ? null : (() => {
    const usualTotal = L ? Math.round(L.comp.reduce((a, b) => a + b, 0)) : null;
    const done = L && nowMin >= L.end;
    const on = L ? L.serversNow : manual?.servers ?? null;
    const need = recap ? recap.peakNeed : L ? tonightNeed : manual?.need ?? null;
    const byRule = recap ? recap.peakByRule : L ? tonightNeed != null && tonightNeed > L.needTop : false;
    const tk = L?.vitals?.['Ticket time'], tn = L?.vitals?.['Turn time'];
    const later = (what, from, go) => ({ value: '—', foot: from, go });
    return [
      { icon: 'Users', label: done ? 'Guests served' : 'Guests so far', value: L ? L.so : manual.covers, foot: L ? (done ? `${refWord} ${usualTotal}` : `${refWord} by now ${Math.round(L.cmp)}`) : manual.typical != null ? `usual by then ${manual.typical}` : 'your count', tone: L && Math.abs(L.pace) >= 15 ? 'warn' : '' },
      { icon: 'UserCheck', label: done ? 'Servers on' : 'Servers on now', value: on ?? '—', foot: need != null ? `${need} needed${done ? ' at the peak' : ''}${byRule ? ' · your minimum' : busier && !done ? ' if the pace settles' : ''}` : 'no clock-ins yet', tone: on != null && need != null ? (on < need ? 'bad' : on > need ? 'warn' : 'ok') : '' },
      tk ? { icon: 'Timer', label: 'Ticket time', value: tk.value, foot: `kitchen line ${num(tk.vs)} min`, tone: num(tk.value) > num(tk.vs) ? 'bad' : 'ok' }
        : { icon: 'Timer', label: 'Ticket time', ...later('ticket', own ? 'Connect a kitchen display' : 'Sample: dinner only', own ? 'connect' : null) },
      tn ? { icon: 'Armchair', label: 'Table turn', value: tn.value, foot: `your limit ${num(tn.vs)} min`, tone: num(tn.value) > num(tn.vs) ? 'bad' : 'ok' }
        : { icon: 'Armchair', label: 'Table turn', ...later('turn', own ? 'Comes with Toast table data' : 'Sample: dinner only', null) },
    ];
  })();

  // Covercast's own account of the forecast: what moved it, and where its range comes from.
  // Tonight's line reads the same live figures as the card and the stats; the plan's reads planTotals.
  const Day = dayOf(day);
  const drivers = (plan?.engine?.drivers?.items || []).filter((x) => x.source !== 'none' && x.label).map((x) => (x.key === 'trend'
    ? (x.pct ? `${Math.abs(x.pct)}% ${x.pct < 0 ? 'under' : 'over'} your 8-week ${Day} average (recent trend)` : `in line with your 8-week ${Day} average`)
    : x.label));
  const pt = planTotals(plan);
  const rep = cc?.shiftPulse ?? null;
  const liveCut = L ? (Object.keys(rep?.liveScore?.[meal] ?? {}).map(Number).filter((c) => c * 60 <= nowMin).at(-1) ?? null) : null;
  const held = L && liveCut != null ? rep?.liveScore?.[meal]?.[liveCut]?.coverage : rep?.plan?.[meal]?.coverage;
  const liveOn = L?.engine && isToday && L.now < L.comp.length;
  const ccNote = !(plan?.engine || L?.engine) ? null : [
    liveOn ? `${M.label} now expected ${L.so + L.remaining}, likely ${L.so + L.range[0]}–${L.so + L.range[1]}${pt?.from === 'Covercast' ? ` (${pt.covers} forecast before service)` : ''}`
      : L?.engine && isToday ? `${M.label}: ${L.so} served${pt?.from === 'Covercast' ? `, against ${pt.covers} forecast` : ''}`
        : pt?.from === 'Covercast' ? `${M.label} ${clockLabel(plan.hours[0].hour * 60)}–${clockLabel((plan.hours.at(-1).hour + 1) * 60)}: ${pt.covers} covers, likely ${pt.low}–${pt.high}` : null,
    ...drivers.slice(0, 2),
    liveOn && L.trust != null ? `tonight’s pace counts for ${L.trust}% so far` : null,
    held != null ? `the likely range held on ${held}% of your past ${plural(M.label.toLowerCase())}` : plan?.engine?.rangeFrom === 'service' ? `range measured on your own past ${plural(M.label.toLowerCase())}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="cv-page">
      <div className={s.lead}>
        <PageHead over={`${NAMES.page} · ${CV_ROOM.name} · ${dayOf(day)}${isToday ? ` · ${clockLabel(nowMin)}` : ` · ${niceDate(date)}`}`} q={PROMISE[role]} />
        <div className={s.when}>
          {tools && <Seg label="View as" value={role} onChange={(k) => setView({ role: k })} options={ROLES} />}
          <Seg label="Which day" value={view.when === 'today' || view.when === 'tomorrow' ? view.when : 'date'} onChange={(k) => setView({ when: k })} options={[['today', 'Today'], ['tomorrow', 'Tomorrow']]} />
          <label className={`${s.datePick} ${view.when !== 'today' && view.when !== 'tomorrow' ? s.segOn : ''}`}><span className="sr-only">Pick a date</span><Icon name="CalendarDays" size={15} /><input type="date" value={date} onChange={(e) => e.target.value && setView({ when: e.target.value === clock.date ? 'today' : e.target.value === addDays(clock.date, 1) ? 'tomorrow' : e.target.value })} /></label>
        </div>
      </div>

      <div className="cv-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div className={s.mode}><span className={`${s.dot} ${source.dot}`} />{source.text}</div>
        {!own && <ServiceCheck d={CV_D} period="Last week" />}
      </div>
      {banner}

      <div className={`${s.strip} ${s.stripSlim}`} role="group" aria-label="Lunch, dinner or the full day">
        <MealCard id="lunch" active={view.meal === 'lunch'} onPick={(id) => { setView({ meal: id }); setSel(null); }} title="Lunch" {...lc} foot={null} />
        <MealCard id="dinner" active={view.meal !== 'lunch' && view.meal !== 'day'} onPick={(id) => { setView({ meal: id }); setSel(null); }} title="Dinner" {...dc} foot={null} />
        {both && <MealCard id="day" active={view.meal === 'day'} onPick={(id) => { setView({ meal: id }); setSel(null); }} title="Full day" big={dayTotal} unit={[lc, dc].some((c) => ['Done', 'Sample', 'Live', 'Typed', 'Overstaffed', 'Busier than forecast', 'Busier than usual'].includes(c.state)) ? 'guests' : 'covers forecast'} foot={null} state={null} />}
      </div>

      <section className={`${s.hero} ${s[`h_${answer.tone}`] || ''} ${pf ? s.heroPf : ''}`} aria-labelledby="svc-hero" data-agent-here="today" data-agent-label="Go to the decision">
        <div className={s.heroMain}>
          <span className={s.heroKicker}><Icon name={TONE_ICON[answer.tone] || 'Activity'} size={16} />{view.meal === 'day' ? `Full day · ${M.label} now · ` : ''}{answer.kicker}</span>
          {promise && <p className={s.heroOutcome}><Icon name={role === 'floor' ? 'Users' : role === 'owner' ? 'TrendingUp' : 'Gauge'} size={18} /><span>{promise.text}</span>{promise.money && <Claim k="est" />}</p>}
          <h2 id="svc-hero" className={s.heroTitle} role="status" aria-live="polite">{(() => {
            const m = cut ? clockLabel(cut.at) : null;
            const i = m ? answer.title.lastIndexOf(m) : -1;
            return i < 0 ? answer.title : <>{answer.title.slice(0, i)}<span className={s.mark}>{m}</span>{answer.title.slice(i + m.length)}</>;
          })()}</h2>
          {answer.why && <p className={s.heroSub}>{answer.why}</p>}
          {night?.to && !yes && <span className={s.typedNote}><Icon name="UserPlus" size={14} />Handed to the {HANDOFF[night.to]}.</span>}
          {showManual && <ManualForm key={`${meal}:${manual?.saved ?? 'new'}`} meal={meal} entry={latest(meal)} nowMin={nowMin} onSave={saveManual} primary={!cut || !!state} />}
          {showManual && manual && <span className={s.typedNote}><Icon name="PenLine" size={14} />Typed by you for {clockLabel(clockMinutes(manual.at))}. One count can’t check sections or breaks. Change a number and save to fix it.</span>}
          {cut && (state ?? (
            <div className={s.heroActions}>
              <Button className={s.cta} icon="Check" onClick={approve} disabled={busy}>{busy ? 'Checking…' : `Approve ${clockLabel(cut.at)} send-home`}</Button>
              <Button variant="secondary" onClick={decline} disabled={busy}>Not tonight</Button>
              {!more ? <Button variant="ghost" iconRight="ChevronRight" onClick={() => setMore(true)} aria-expanded={false}>More</Button> : (
                <span className={s.handoff} role="group" aria-label="More choices">
                  <Button size="sm" variant="ghost" icon="Timer" onClick={snooze} disabled={busy}>Ask me in 30 min</Button>
                  <Button size="sm" variant="ghost" icon="UserPlus" onClick={() => handoff('floor')} disabled={busy}>Hand to floor manager</Button>
                  <Button size="sm" variant="ghost" onClick={() => handoff('gm')} disabled={busy}>Hand to GM</Button>
                </span>
              )}
            </div>
          ))}
          {answer.empty && !showManual && <div className={s.heroActions}><Button className={s.cta} iconRight="ArrowRight" onClick={() => cv.go('inputs')}>Add Toast data</Button></div>}
        </div>
        {pf ? (
          <aside className={`${s.heroSide} ${s.pf}`} aria-label="The problem and the fix">
            <div className={s.prob}>
              <span className={s.pfLabel}><Icon name="TriangleAlert" size={14} />The problem</span>
              <span className={s.pfHead}>{pf.problem.head}</span>
              <span className={s.pfBig}>{pf.problem.big}</span>
              <span className={s.pfFoot}>{pf.problem.foot}{pf.problem.est && <Claim k="est" />}</span>
            </div>
            <div className={s.fix}>
              <span className={s.pfLabel}><Icon name="ShieldCheck" size={14} />{pf.fix.label}</span>
              <span className={s.pfHead}>{pf.fix.head}</span>
              {pf.fix.ba ? <span className={s.ba}><b>{pf.fix.ba[0]}</b><Icon name="ArrowRight" size={18} /><b className={s.baAfter}>{pf.fix.ba[1]}</b></span> : <span className={s.pfBig}>{pf.fix.big}</span>}
              {pf.fix.ba && <Seats on={pf.fix.ba[0]} need={pf.fix.ba[1]} gone />}
              <span className={s.pfFoot}>{pf.fix.foot}</span>
            </div>
          </aside>
        ) : (L || manual) && !(vit && !cut) ? <aside className={s.heroSide}>
          {cut ? (
            <div className={`${s.sideStack} ${role === 'floor' ? s.sideFlip : ''}`}>
              <div>
                <span className={s.sideLabel}>Labor back tonight</span>
                {impact != null
                  ? <span className={s.impact}>{!own ? <Money id="service-cut">{cvMoney(impact)}</Money> : cvMoney(impact)}</span>
                  : <span className={`${s.impact} ${s.none}`}>—</span>}
                <span className={s.sideFoot}>{impact != null ? <>Potential <Claim k="est" /></> : 'No wage rates yet'}</span>
              </div>
              <div className={s.sideSep} />
              <div>
                <span className={s.sideLabel}>Servers after {clockLabel(cut.at)}</span>
                <span className={s.ba}><b>{before.on}</b><Icon name="ArrowRight" size={18} /><b className={s.baAfter}>{before.need}</b></span>
                <Seats on={before.on} need={before.need} gone />
              </div>
            </div>
          ) : (
            <div className={s.sideStats}>
              {(L ? [['Guests so far', L.so, `${refWord} by now ${Math.round(L.cmp)}`], ['Servers on now', L.serversNow ?? '—', tonightNeed != null ? `${tonightNeed} needed${tonightNeed > L.needTop ? ' · your minimum' : ''}` : 'no clock-ins']]
                : manual ? [['Guests, your count', manual.covers, manual.typical != null ? `usual by then ${manual.typical}` : 'no history to compare'], ['Servers on', manual.servers ?? '—', manual.need != null ? `${manual.need} needed this hour` : '']]
                  : rows.length ? [[plan.engine ? 'Covers forecast' : 'Usual covers', planTotals(plan).covers, plan.engine ? `likely ${planTotals(plan).low}–${planTotals(plan).high}` : `busiest week ${planTotals(plan).high}`], ['Servers at the peak', Math.max(...rows.map((r) => Math.round(r.servers))), `${Math.max(...rows.map((r) => r.need))} needed`]]
                    : []).map(([k, v, f]) => <div key={k} className={s.sideStat}><span className={s.sideLabel}>{k}</span><span className={`${s.impact} ${v === '—' ? s.none : ''}`}>{v}</span><span className={s.sideFoot}>{f}</span></div>)}
            </div>
          )}
        </aside> : null}
      </section>

      {vit && (
        <div className={s.vitals} aria-label={`${M.label} vitals`}>
          {vit.map((v) => (
            <div key={v.label} className={`${s.vital} ${v.tone ? s[`v_${v.tone}`] : ''}`}>
              <span className={s.vitalLabel}><Icon name={v.icon} size={15} />{v.label}</span>
              <span className={`${s.vitalBig} ${v.value === '—' ? s.none : ''}`}>{v.value}</span>
              {v.go ? <button type="button" className={s.linkish} onClick={() => cv.go(v.go)}>{v.foot}</button> : <span className={s.vitalFoot}>{v.foot}</span>}
            </div>
          ))}
        </div>
      )}

      <div>
        <section className={`cv-card ${s.panel}`}>
          <div className={s.panelHead}>
            <div className={s.chartHead}>
              <h3 className="cv-h4">{chartTitle}</h3>
              {ccNote && <p className={s.ccLine}><span className={s.ccTag}><Icon name="Activity" size={13} />Covercast</span>{ccNote}</p>}
            </div>
            <Seg label="What to show" value={tab} onChange={(k) => setView({ tab: k })} options={[['forecast', 'Forecast', 'TrendingUp'], ['staffing', 'Staffing', 'Users'], ['performance', 'Performance', 'Gauge']]} wide />
          </div>
          {tab === 'forecast' && L ? <GuestsChart L={L} sel={sel != null && sel >= SLOT_FLOOR ? sel : null} onSel={setSel} staffAt={staffAt} usual={L.engine ? 'Covercast forecast' : `Usual ${dayOf(day)}`} refWord={refWord} />
            : rows.length ? <HourChart cc={!!plan?.engine} rows={rows} mode={tab === 'forecast' ? 'covers' : tab === 'staffing' ? 'staff' : 'perf'} sel={selHour} onSel={setSel} cutFrom={plan?.cutFrom} rate={plan?.rate ?? null} nowHour={nowHour} />
              : <Note icon="Clock">No {M.label.toLowerCase()} history for {dayOf(day)}s yet.{showManual ? ' Type your count in the card above.' : ''}</Note>}
          {stats.length > 0 && <div className={s.stats}>{stats.map(([k, v]) => <div key={k} className={s.stat}><span>{k}</span><b>{v}</b></div>)}</div>}
          {pick == null ? null : (() => {
            const h = rows.find((r) => r.hour === Math.floor(pick / 60));
            const sl = slots.find((r) => r.at === pick);
            return (
              <div className={s.pick} aria-live="polite">
                <b>{sl ? clockLabel(pick) : `${clockLabel(pick)} to ${clockLabel(pick + 60)}`}</b>
                {sl && <span>{sl.served != null ? `${sl.served} served` : `about ${sl.expected} expected (likely ${sl.low}–${sl.high})`} · {refWord} {sl.usual}</span>}
                {h && <span>{plan?.engine ? `${h.usual} covers forecast · up to ${h.busiest}` : `${h.usual} covers usually · up to ${h.busiest}`}</span>}
                {h && <span>{Math.round(h.servers)} on · {h.need} needed{h.spare ? ` · ${h.spare} spare` : h.short ? ` · ${h.short} short` : ''}</span>}
                {h?.perServer != null && <span>{h.perServer} guests per server</span>}
                {h && wage && h.spare ? <span>{cvMoney(h.spare * wage)} of spare labor this hour <Claim k="est" /></span> : null}
                {!h && !sl && <span className="cv-faint">No data for this time.</span>}
                <button type="button" className={s.linkish} onClick={() => setSel(null)}>Clear</button>
              </div>
            );
          })()}
        </section>

      </div>

      {!showDetail ? (
        <button type="button" className={s.moreDetail} onClick={() => setShowDetail(true)}><Icon name="ChevronDown" size={16} />Details: every 15 minutes, hour by hour, {NAMES.guard}, the money, past decisions</button>
      ) : <section className={`cv-card ${s.detail}`}>
        <div className={s.detailHead}>
          <div className={s.tabs} role="tablist" aria-label="Details">
            {detailTabs.map(([k, label]) => <button key={k} role="tab" type="button" aria-selected={view.detail === k} className={`${s.tab} ${view.detail === k ? s.tabOn : ''}`} onClick={() => setView({ detail: k })}>{label}</button>)}
          </div>
          <Button size="sm" variant="secondary" icon="Download" onClick={exportCsv}>CSV</Button>
        </div>
        <div className={s.detailBody} role="tabpanel">
          {view.detail === 'slots' && (slots.length ? (
            <div className={s.tableWrap}><table className="cv-table">
              <thead><tr><th>Time</th><th>{L?.engine ? 'Forecast' : 'Usual'}</th><th>Served</th><th>Expected</th><th>Likely</th></tr></thead>
              <tbody>{slots.map((r) => <tr key={r.at} className={r.at === pick ? s.rowNow : ''} onClick={() => setSel(r.at)}><td>{r.label}</td><td>{r.usual}</td><td>{r.served ?? '—'}</td><td>{r.expected ?? '—'}</td><td>{r.low != null ? `${r.low}–${r.high}` : '—'}</td></tr>)}</tbody>
            </table><p className="cv-xs cv-faint">{L.source === 'sample' ? 'Sample night.' : L.engine ? 'Toast, against Covercast’s forecast.' : `Toast, against your last ${L.nights} ${dayOf(day)}s.`} Guests per 15 minutes. The likely range comes from how far off {L.engine ? 'Covercast' : 'this guess'} was on your own past days{L.calibrated ? '' : ', and is still learning'}.</p></div>
          ) : <Note icon="Clock">The 15-minute view shows while {M.label.toLowerCase()} is live from Toast{own ? '' : ' (the sample has it for dinner today)'}. The hour-by-hour plan is under Hour by hour.</Note>)}
          {view.detail === 'hours' && (rows.length ? (
            <div className={s.tableWrap}><table className="cv-table">
              <thead><tr><th>Hour</th><th>{plan?.engine ? 'Forecast' : 'Usual'}</th><th>{plan?.engine ? 'Likely up to' : 'Busiest'}</th><th>On</th><th>Needed</th><th>Spare / short</th><th>Per server</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.hour} className={selHour === r.hour ? s.rowNow : ''} onClick={() => setSel(r.hour)}><td>{r.label}</td><td>{r.usual}</td><td>{r.busiest}</td><td>{r.servers}</td><td>{r.need}{r.byRule ? ' (your minimum)' : ''}</td><td>{r.spare ? `${r.spare} spare` : r.short ? `${r.short} short` : '—'}</td><td>{r.perServer ?? '—'}</td></tr>)}</tbody>
            </table><p className="cv-xs cv-faint">{plan.engine ? `Covercast’s forecast for this ${dayOf(day)}; servers usually on from your last ${plan.weeks} ${dayOf(day)}s${own ? ' in Toast' : ' (sample)'}. “Needed” is sized to the top of Covercast’s likely range` : `Your last ${plan.weeks} ${dayOf(day)}s${own ? ' from Toast' : ' (sample)'}. “Needed” is sized for the busiest of them`} at your own {plan.rate.toFixed(1)} guests per server-hour, and never below your minimum.</p></div>
          ) : <Note icon="Clock">No {M.label.toLowerCase()} history for {dayOf(day)}s yet.</Note>)}
          {view.detail === 'rules' && (
            <div className={s.rules}>
              <div className={s.block}><span className={s.blockTitle}>{NAMES.guard} · checks before anyone goes home</span>{checks.length ? <Checks checks={checks} /> : <span className="cv-xs cv-faint">No checks without data.</span>}</div>
              <div className={s.block}>
                <span className={s.blockTitle}>Your rules</span>
                <div className={s.fences}>
                  <div className={s.fence}><span className="cv-xs cv-faint">Fewest servers on dinner</span><b>{fences.minDinner}</b></div>
                  <div className={s.fence}><span className="cv-xs cv-faint">Fewest servers otherwise</span><b>{fences.minAny}</b></div>
                  <div className={s.fence}><span className="cv-xs cv-faint">Latest time to send someone home</span><b>{clockLabel(fences.cutBy)}</b></div>
                </div>
                <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('fences')}>Change rules</Button>
                <ul className="cv-ul">
                  <li><Icon name="Activity" size={15} />{plan?.engine || L?.engine ? 'Tonight is compared with Covercast’s forecast. The likely range comes from how far off Covercast was on your own past services.' : 'Today is compared with the same weekday on recent weeks. The likely range comes from how far off that guess was on your own past days.'}</li>
                  <li><Icon name="BellOff" size={15} />At most one suggestion and one alert a service, and one send-home a day.</li>
                  <li><Icon name="ShieldCheck" size={15} />Approving puts the step on Today. Nothing changes in 7shifts until someone does it, and Toast clock-ins confirm it.</li>
                </ul>
              </div>
            </div>
          )}
          {view.detail === 'money' && (
            <div className={s.money}>
              {cut && impact != null ? (
                <>
                  <span className={s.impact}>{cvMoney(impact)} <Claim k="est" /></span>
                  <span className="cv-sm">{own && wage ? `1 server × ${hl} hour${hoursLeft === 1 ? '' : 's'} (${clockLabel(cut.at)} to close) × ${cvMoney(wage)} an hour, your blended wage from Toast time entries.` : 'Sample: 1 server from the send-home time to close, at the sample wage.'}</span>
                  <span className="cv-xs cv-faint">Potential only. It’s never counted as saved until the change shows in Toast clock-ins.</span>
                </>
              ) : (
                <span className="cv-sm">{wage ? `No send-home ${isToday ? 'today' : 'planned'}, so no labor to save.` : 'No wage rates in your data, so no dollar figures.'}{rows.some((r) => r.spare) && wage ? ` In this plan, spare server-hours (above what’s needed and your minimum) cost about ${cvMoney(rows.reduce((t, r) => t + r.spare, 0) * wage)}.` : ''}</span>
              )}
            </div>
          )}
          {view.detail === 'past' && (past.length ? (
            <ul className={s.past}>{past.map((p, k) => <li key={k}><b>{p.date}{p.meal ? ` · ${MEALS[p.meal].label}` : ''}</b><span>{p.answer === 'yes' ? `Send 1 home at ${p.at ? clockLabel(clockMinutes(p.at)) : '—'}` : p.answer === 'later' ? 'Decide later' : p.answer === 'no' ? 'Kept everyone on' : 'Send-home call'}{p.to ? ` · handed to the ${HANDOFF[p.to]}` : ''}</span><span className="cv-faint">{outcome(p)}</span></li>)}</ul>
          ) : <Note icon="ListChecks">No decisions yet. Each one shows here with what came of it.</Note>)}
          {view.detail === 'busy' && <DenseService />}
        </div>
      </section>}
    </div>
  );
}

export { CvService };
