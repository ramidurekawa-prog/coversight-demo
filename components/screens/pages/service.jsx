'use client';

import * as React from 'react';

import { Icon, Button } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_NOW, Claim, Money, Pill, PageHead } from '../core';
import { DenseService } from '../dense-sections';
import { servicePace } from '../../../lib/data/model';
import {
  addDays, bandSpread, clockLabel, clockMinutes, cutApprovalId, dayOfDate, dayOutlook, fencesOf, hhmm, hourRows, isCutFor, localNow,
  manualNight, MEALS, mealOf, MIN_CALIBRATED, pacing, servicePlan, slotRows, SLOT_MIN, toCsv,
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
const DEFAULT_VIEW = { meal: 'dinner', when: 'today', tab: 'forecast', detail: 'slots' };
const MEAL_ICON = { lunch: 'Sun', dinner: 'Moon', day: 'CalendarDays' };
const HANDOFF = { gm: 'GM', floor: 'floor manager' };
const hoursLabel = (m) => `${clockLabel(m.from * 60).replace(':00', '')}–${clockLabel(m.to * 60).replace(':00', '')}`;
const niceDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const pct = (p) => (p === 0 ? 'right on' : `${Math.abs(p)}% ${p < 0 ? 'under' : 'over'}`);
const SLOT_FLOOR = 6 * 60; // a picked value at or above this is a time in minutes, below it an hour

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
    remaining: c.remaining, range: c.range, serversNow: c.serversNow, needTop: c.needTop, needMid: c.needMid, mode: c.mode,
    at: c.at, value: c.value, checks: c.checks, why: c.why, checkAt: c.checkAt, stale: n.stale, dataThrough: n.dataThrough,
    execution: n.execution, fetchedAt: r.fetchedAt,
  };
}

/** The sample's fixed dinner scene, in the same shape. Its figures are the seed's, labelled as a sample. */
function fromSample(sv) {
  const sp = servicePace(sv);
  const spread = sv.mode === 'wait' ? 0.2 : bandSpread(sv.now, sv.comp.length) * 0.65;
  const p = pacing({ comp: sv.comp, actual: sv.actual, now: sv.now, spread });
  const tile = sv.tiles.find((t) => t[0] === 'Servers on');
  const on = tile ? +tile[1] : null;
  const need = tile ? +((tile[2] || '').match(/\d+/)?.[0] ?? 0) : null;
  const start = 17 * 60;
  return {
    source: 'sample', comp: sv.comp, actual: sv.actual, start, end: start + sv.comp.length * SLOT_MIN, ...p, factor: sp?.factor ?? p.factor,
    calibrated: true, nights: 4, serversNow: on, needTop: need, needMid: need, mode: sv.mode === 'cut' ? 'cut' : sv.mode === 'wait' ? 'wait' : 'quiet',
    at: sv.mode === 'cut' ? start + 12 * SLOT_MIN : null, value: sv.mode === 'cut' ? sv.value : null, why: null, checkAt: sv.mode === 'wait' ? 19 * 60 + 45 : null,
    stale: false, dataThrough: null, execution: null, fetchedAt: null, approval: sv.approval,
    checks: [
      { key: 'demand', label: `${on != null ? on - 1 : '—'} servers cover the busiest likely finish`, ok: sv.mode === 'cut' },
      { key: 'floor', label: 'Your fewest-servers rule still holds', ok: true },
      { key: 'roles', label: 'Sections and roles stay covered', ok: null, note: 'Sample: check the floor plan.' },
    ],
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
  const planCut = plan?.cutFrom != null && (!isToday || plan.cutFrom * 60 > nowMin) ? plan.cutFrom * 60 : null;
  const planned = (kicker) => planCut != null
    ? { tone: 'act', kicker, title: `Plan: 1 server can go home at ${clockLabel(planCut)}`, why: `On each of your last ${plan.weeks} ${Day}s, every hour from then had a spare server, even the busiest week.`, next: 'Look at the room first. Approving puts the 7shifts step on Today; nothing changes in 7shifts until someone does it.', cut: isToday ? { at: planCut, servers: Math.round(plan.hours.find((h) => h.hour === plan.cutFrom).servers), source: 'plan' } : null }
    : { tone: 'good', kicker, title: plan.blocked ? 'Keep everyone on' : `Keep ${Math.round(peak.servers)} servers on for the ${clockLabel(peak.hour * 60)} peak`, why: plan.blocked ? plan.blocked.text : `Usually ${usual} covers. Every hour on recent ${Day}s used all its servers.` };

  if (!plan && !L && !manual) return { tone: 'neutral', kicker: `${M.label} · no data yet`, title: `No ${M.label.toLowerCase()} history yet`, why: own ? `Needs Toast orders and time entries for ${M.label.toLowerCase()} on ${Day}s.` : `The sample group only has dinner. Pick Dinner to see the sample night.`, empty: own };
  if (!isToday) return planned(`${M.label} · ${Day} plan`);
  if (L && after) return { tone: 'good', kicker: `${M.label} is done`, title: `${L.so} guests served`, why: `${pct(L.pace)[0].toUpperCase()}${pct(L.pace).slice(1)} a usual ${Day}.` };
  if (manual && after) return { tone: 'good', kicker: `${M.label} is done`, title: `${manual.covers} guests by your count`, why: manual.typical ? `A usual ${Day} has ${manual.typical} by ${clockLabel(clockMinutes(manual.at))}.` : 'Your count.' };
  if (before && !L && !manual) return plan ? planned(`${M.label} starts at ${clockLabel(M.from * 60)}`) : { tone: 'neutral', kicker: `${M.label} starts at ${clockLabel(M.from * 60)}`, title: 'Nothing to do yet', why: '' };

  if (L) {
    const vs = `Guests are ${pct(L.pace)} a usual ${Day}`;
    const lo = Math.round(L.cmp * (1 - L.spread)), hi = Math.round(L.cmp * (1 + L.spread));
    if (L.mode === 'cut') return { tone: 'act', kicker: 'Do this now', title: `Send 1 server home at ${clockLabel(L.at)}`, why: `${vs}. After ${clockLabel(L.at)}, ${L.serversNow - 1} servers still cover the busiest likely finish.`, next: `Approving puts the 7shifts step on Today. Nothing changes in 7shifts until someone does it${L.source === 'toast' ? ', and Toast clock-ins confirm it' : ''}.`, cut: { at: L.at, servers: L.serversNow, source: 'live' } };
    if (L.mode === 'stale') return { tone: 'warn', kicker: 'Toast is late', title: 'No call until Toast catches up', why: `No new orders since ${L.dataThrough != null ? clockLabel(L.dataThrough) : 'service started'}. Check the room yourself.` };
    if (L.so > hi) return { tone: 'warn', kicker: 'Busier than usual', title: L.serversNow != null ? `Keep all ${L.serversNow} servers on` : 'Keep everyone on', why: `${vs}. Sending anyone home now puts service at risk.` };
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
  return planned(`${M.label} · plan from recent ${Day}s`);
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
  const live = useLive(CV_D.id, server && own);
  const [fencesSaved] = useSaved('fences', null);
  const fences = fencesOf(fencesSaved);

  // The clock: the room's own when Toast answered, the sample's fixed evening, else this device's.
  const clock = own
    ? (live?.dinner?.date ? { date: live.dinner.date, day: live.dinner.day, minutes: live.dinner.nowMin } : localNow(new Date()))
    : { date: CV_NOW.iso, day: dayOfDate(CV_NOW.iso), minutes: clockMinutes(CV_NOW.time) ?? 19 * 60 + 15 };
  const date = view.when === 'today' ? clock.date : view.when === 'tomorrow' ? addDays(clock.date, 1) : /^\d{4}-\d{2}-\d{2}$/.test(view.when) ? view.when : clock.date;
  const isToday = date === clock.date;
  const day = dayOfDate(date);
  const nowMin = clock.minutes;

  const plans = { lunch: servicePlan(CV_D.room, day, fencesSaved, 'lunch'), dinner: servicePlan(CV_D.room, day, fencesSaved, 'dinner') };
  const outlook = dayOutlook(plans);

  // Live per service (today only).
  const liveFor = (m) => {
    if (!isToday) return null;
    if (!own) return m === 'dinner' && CV_D.room.service ? fromSample(CV_D.room.service) : null;
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
  const source = !isToday ? { dot: '', text: `Plan for ${niceDate(date)} · ${weeks ? `from your last ${weeks} ${dayOf(day)}s` : 'no history yet'} · not a live count` }
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
      return { big: done ? l.so : l.so + l.remaining, unit: done ? 'guests served' : 'guests expected', foot: done ? `${pct(l.pace)} usual` : `${l.so} so far · usual ${usualTotal}`, state: done ? 'Done' : l.source === 'sample' ? 'Sample' : 'Live', tone: done ? 'done' : 'now' };
    }
    if (mn) return { big: mn.covers, unit: 'guests, your count', foot: `for ${clockLabel(clockMinutes(mn.at))}${mn.typical ? ` · usual by then ${mn.typical}` : ''}`, state: state === 'Done' ? 'Done' : 'Typed', tone: 'typed' };
    if (!p) return { big: null, unit: 'no history', foot: isToday && own && state !== 'Later' ? 'Type your count to track it' : `No ${Mm.label.toLowerCase()} data for ${dayOf(day)}s`, state: null, tone: '' };
    return { big: o.usual, unit: 'usual covers', foot: `busiest recent week ${o.busiest}`, state, tone: state === 'Now' ? 'now' : '' };
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
            : ex?.state === 'confirmed' ? ['CircleCheck', 'Done · confirmed in Toast clock-ins', 'good']
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

  /* ---------- level 2 ---------- */
  const tab = view.tab;
  const nowHour = isToday ? Math.floor(nowMin / 60) : null;
  const ended = isToday && nowMin >= (L?.end ?? M.to * 60);
  const ahead = rows.filter((r) => !isToday || ended || r.hour >= Math.floor(nowMin / 60));
  const selHour = sel == null ? null : sel >= SLOT_FLOOR ? Math.floor(sel / 60) : sel;
  const staffAt = (min) => { const h = rows.find((r) => r.hour === Math.floor(min / 60)); return h ? `${Math.round(h.servers)} usually on · ${h.need} needed` : null; };

  const chartTitle = tab === 'forecast' ? (L ? `${M.label} · guests through closing` : `${M.label} · covers each hour`) : tab === 'staffing' ? `${M.label} · servers on and needed` : `${M.label} · guests per server`;
  const chartSub = !L && !plan ? '' : tab === 'forecast' ? (L ? `Served so far, a usual ${dayOf(day)}, and the likely finish.` : `A usual ${dayOf(day)} and the busiest of your last ${plan.weeks}.`)
    : tab === 'staffing' ? 'Servers usually on each hour, against what the busiest recent week needed.' : 'Guests each server handles each hour, against your own average.';
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
    ['Usual covers', rows.reduce((t, r) => t + r.usual, 0)],
    ['Busiest week', rows.reduce((t, r) => t + r.busiest, 0)],
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
  const detailTabs = [['slots', 'Every 15 minutes'], ['hours', 'Hour by hour'], ['rules', 'Checks & rules'], ['money', 'The money'], ['past', 'Past decisions'], ['busy', 'Busy times']];
  const pick = sel == null ? null : sel >= SLOT_FLOOR ? sel : sel * 60;

  return (
    <div className="cv-page">
      <div className={s.lead}>
        <PageHead over={`Service · ${CV_ROOM.name} · ${dayOf(day)}${isToday ? ` · ${clockLabel(nowMin)}` : ` · ${niceDate(date)}`}`} q="How is service going?" />
        <div className={s.when}>
          <Seg label="Which day" value={view.when === 'today' || view.when === 'tomorrow' ? view.when : 'date'} onChange={(k) => setView({ when: k })} options={[['today', 'Today'], ['tomorrow', 'Tomorrow']]} />
          <label className={`${s.datePick} ${view.when !== 'today' && view.when !== 'tomorrow' ? s.segOn : ''}`}><span className="sr-only">Pick a date</span><Icon name="CalendarDays" size={15} /><input type="date" value={date} onChange={(e) => e.target.value && setView({ when: e.target.value === clock.date ? 'today' : e.target.value === addDays(clock.date, 1) ? 'tomorrow' : e.target.value })} /></label>
        </div>
      </div>

      <div className={s.mode}><span className={`${s.dot} ${source.dot}`} />{source.text}</div>
      {banner}

      <div className={s.strip} role="group" aria-label="Lunch, dinner or the full day">
        <MealCard id="lunch" active={view.meal === 'lunch'} onPick={(id) => { setView({ meal: id }); setSel(null); }} title="Lunch" hours={hoursLabel(MEALS.lunch)} {...lc} />
        <MealCard id="dinner" active={view.meal !== 'lunch' && view.meal !== 'day'} onPick={(id) => { setView({ meal: id }); setSel(null); }} title="Dinner" hours={hoursLabel(MEALS.dinner)} {...dc} />
        <MealCard id="day" active={view.meal === 'day'} onPick={(id) => { setView({ meal: id }); setSel(null); }} title="Full day" hours="" big={dayTotal} unit="covers" foot={dayFoot} state={null} />
      </div>

      <section className={`${s.hero} ${s[`h_${answer.tone}`] || ''}`} aria-labelledby="svc-hero">
        <div className={s.heroMain}>
          <span className={s.heroKicker}><Icon name={TONE_ICON[answer.tone] || 'Activity'} size={16} />{view.meal === 'day' ? `Full day · ${M.label} now · ` : ''}{answer.kicker}</span>
          <h2 id="svc-hero" className={s.heroTitle} role="status" aria-live="polite">{answer.title}</h2>
          {answer.why && <p className={s.heroSub}>{answer.why}</p>}
          {cut && answer.next && !state && <p className={s.heroNext}><Icon name="ArrowRight" size={15} />{answer.next}</p>}
          {night?.to && !yes && <span className={s.typedNote}><Icon name="UserPlus" size={14} />Handed to the {HANDOFF[night.to]}.</span>}
          {showManual && <ManualForm key={`${meal}:${manual?.saved ?? 'new'}`} meal={meal} entry={latest(meal)} nowMin={nowMin} onSave={saveManual} primary={!cut || !!state} />}
          {showManual && manual && <span className={s.typedNote}><Icon name="PenLine" size={14} />Typed by you for {clockLabel(clockMinutes(manual.at))}. One count can’t check sections or breaks. Change a number and save to fix it.</span>}
          {cut && (state ?? (
            <div className={s.heroActions}>
              <Button className={s.cta} icon="Check" onClick={approve} disabled={busy}>{busy ? 'Checking…' : `Approve ${clockLabel(cut.at)} send-home`}</Button>
              <Button variant="secondary" onClick={decline} disabled={busy}>Not tonight</Button>
              <Button variant="ghost" icon="Timer" onClick={snooze} disabled={busy}>Ask me in 30 min</Button>
              <span className={s.handoff} role="group" aria-label="Hand this to">
                <span className="cv-xs cv-faint">Hand to</span>
                <Button size="sm" variant="ghost" icon="UserPlus" onClick={() => handoff('floor')} disabled={busy}>Floor manager</Button>
                <Button size="sm" variant="ghost" onClick={() => handoff('gm')} disabled={busy}>GM</Button>
              </span>
            </div>
          ))}
          {answer.empty && !showManual && <div className={s.heroActions}><Button className={s.cta} iconRight="ArrowRight" onClick={() => cv.go('inputs')}>Add Toast data</Button></div>}
          {cut && !state && <span className={s.proof}><Icon name="ShieldCheck" size={14} />{own ? 'Checked again on fresh data when you approve.' : 'Sample: approving opens the same check a real one runs.'}</span>}
        </div>
        {(cut || L || manual || rows.length > 0) && <aside className={s.heroSide}>
          {cut ? (
            <>
              <div>
                <span className={s.sideLabel}>Labor you could save after {clockLabel(cut.at)}</span>
                {impact != null
                  ? <span className={s.impact}>{!own ? <Money id="service-cut">{cvMoney(impact)}</Money> : cvMoney(impact)}</span>
                  : <span className={`${s.impact} ${s.none}`}>—</span>}
                <span className={s.sideFoot}>{impact != null ? <>Potential, not saved yet <Claim k="est" /></> : 'No wage rates in your data, so no dollar figure.'}</span>
              </div>
              <div className={s.sideSep} />
              <div>
                <span className={s.sideLabel}>After {clockLabel(cut.at)} · on → needed</span>
                <span className={s.ba}><b>{before.on}</b><Icon name="ArrowRight" size={18} /><b className={s.baAfter}>{before.need}</b></span>
                <Seats on={before.on} need={before.need} gone />
                <span className={s.sideFoot}>Without a change, 1 extra server for about {hl} hour{hoursLeft === 1 ? '' : 's'}. With it, the busiest likely finish is still covered.</span>
              </div>
            </>
          ) : (
            <div className={s.sideStats}>
              {(L ? [['Guests so far', L.so, `usual by now ${Math.round(L.cmp)}`], ['Servers on now', L.serversNow ?? '—', L.needTop != null ? `${L.needMid === L.needTop ? L.needTop : `${L.needMid}–${L.needTop}`} needed` : 'no clock-ins']]
                : manual ? [['Guests, your count', manual.covers, manual.typical != null ? `usual by then ${manual.typical}` : 'no history to compare'], ['Servers on', manual.servers ?? '—', manual.need != null ? `${manual.need} needed this hour` : '']]
                  : rows.length ? [['Usual covers', rows.reduce((t, r) => t + r.usual, 0), `busiest week ${rows.reduce((t, r) => t + r.busiest, 0)}`], ['Servers at the peak', Math.max(...rows.map((r) => Math.round(r.servers))), `${Math.max(...rows.map((r) => r.need))} needed`]]
                    : []).map(([k, v, f]) => <div key={k} className={s.sideStat}><span className={s.sideLabel}>{k}</span><span className={`${s.impact} ${v === '—' ? s.none : ''}`}>{v}</span><span className={s.sideFoot}>{f}</span></div>)}
            </div>
          )}
        </aside>}
      </section>

      <div className={s.grid}>
        <section className={`cv-card ${s.panel}`}>
          <div className={s.panelHead}>
            <div><h3 className="cv-h4">{chartTitle}</h3><p className="cv-xs cv-faint">{chartSub}</p></div>
            <Seg label="What to show" value={tab} onChange={(k) => setView({ tab: k })} options={[['forecast', 'Forecast', 'TrendingUp'], ['staffing', 'Staffing', 'Users'], ['performance', 'Performance', 'Gauge']]} wide />
          </div>
          {tab === 'forecast' && L ? <GuestsChart L={L} sel={sel != null && sel >= SLOT_FLOOR ? sel : null} onSel={setSel} staffAt={staffAt} usual={`Usual ${dayOf(day)}`} />
            : rows.length ? <HourChart rows={rows} mode={tab === 'forecast' ? 'covers' : tab === 'staffing' ? 'staff' : 'perf'} sel={selHour} onSel={setSel} cutFrom={plan?.cutFrom} rate={plan?.rate ?? null} nowHour={nowHour} />
              : <Note icon="Clock">No {M.label.toLowerCase()} history for {dayOf(day)}s yet.{showManual ? ' Type your count in the card above.' : ''}</Note>}
          {stats.length > 0 && <div className={s.stats}>{stats.map(([k, v]) => <div key={k} className={s.stat}><span>{k}</span><b>{v}</b></div>)}</div>}
          {pick == null ? (rows.length || L ? <span className="cv-xs cv-faint">Tap a time on the chart for its breakdown.</span> : null) : (() => {
            const h = rows.find((r) => r.hour === Math.floor(pick / 60));
            const sl = slots.find((r) => r.at === pick);
            return (
              <div className={s.pick} aria-live="polite">
                <b>{sl ? clockLabel(pick) : `${clockLabel(pick)} to ${clockLabel(pick + 60)}`}</b>
                {sl && <span>{sl.served != null ? `${sl.served} served` : `about ${sl.expected} expected (likely ${sl.low}–${sl.high})`} · usual {sl.usual}</span>}
                {h && <span>{h.usual} covers usually · up to {h.busiest}</span>}
                {h && <span>{Math.round(h.servers)} on · {h.need} needed{h.spare ? ` · ${h.spare} spare` : h.short ? ` · ${h.short} short` : ''}</span>}
                {h?.perServer != null && <span>{h.perServer} guests per server</span>}
                {h && wage && h.spare ? <span>{cvMoney(h.spare * wage)} of spare labor this hour <Claim k="est" /></span> : null}
                {!h && !sl && <span className="cv-faint">No data for this time.</span>}
                <button type="button" className={s.linkish} onClick={() => setSel(null)}>Clear</button>
              </div>
            );
          })()}
        </section>

        <section className={`cv-card ${s.panel}`}>
          <h3 className="cv-h4">Where staffing meets demand</h3>
          <p className="cv-xs cv-faint">{isToday && !ended ? 'The hours ahead' : `Each hour of ${M.label.toLowerCase()}`}, sized for the busiest recent week.</p>
          {ahead.length ? (
            <ul className={s.windows}>
              {ahead.slice(0, 6).map((r) => {
                const gone = !!cut && r.hour * 60 >= cut.at;
                const tag = r.short ? ['bad', `${r.short} short`] : r.spare ? ['warn', `${r.spare} spare`] : ['good', 'Covered'];
                return (
                  <li key={r.hour}>
                    <button type="button" className={`${s.window} ${selHour === r.hour ? s.windowOn : ''}`} onClick={() => setSel(r.hour)} aria-pressed={selHour === r.hour}>
                      <span className={s.windowTop}><b>{clockLabel(r.hour * 60)}</b><span className={`${s.tag} ${s[`t_${tag[0]}`]}`}>{tag[1]}</span></span>
                      <span className="cv-xs cv-faint">usually {Math.round(r.servers)} on · {r.need} needed · about {r.usual} guests</span>
                      <Seats on={Math.round(r.servers)} need={r.need} gone={gone} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <Note icon="Clock">No hours to show for {M.label.toLowerCase()} yet.</Note>}
          {(L?.serversNow != null || manual?.servers != null) && <p className="cv-xs cv-muted">Right now: {L?.serversNow ?? manual.servers} on{L?.source === 'toast' ? ', from Toast clock-ins' : L?.source === 'sample' ? ' (sample)' : ', your count'}.</p>}
        </section>
      </div>

      <section className={`cv-card ${s.detail}`}>
        <div className={s.detailHead}>
          <div className={s.tabs} role="tablist" aria-label="Details">
            {detailTabs.map(([k, label]) => <button key={k} role="tab" type="button" aria-selected={view.detail === k} className={`${s.tab} ${view.detail === k ? s.tabOn : ''}`} onClick={() => setView({ detail: k })}>{label}</button>)}
          </div>
          <Button size="sm" variant="secondary" icon="Download" onClick={exportCsv}>CSV</Button>
        </div>
        <div className={s.detailBody} role="tabpanel">
          {view.detail === 'slots' && (slots.length ? (
            <div className={s.tableWrap}><table className="cv-table">
              <thead><tr><th>Time</th><th>Usual</th><th>Served</th><th>Expected</th><th>Likely</th></tr></thead>
              <tbody>{slots.map((r) => <tr key={r.at} className={r.at === pick ? s.rowNow : ''} onClick={() => setSel(r.at)}><td>{r.label}</td><td>{r.usual}</td><td>{r.served ?? '—'}</td><td>{r.expected ?? '—'}</td><td>{r.low != null ? `${r.low}–${r.high}` : '—'}</td></tr>)}</tbody>
            </table><p className="cv-xs cv-faint">{L.source === 'sample' ? 'Sample night.' : `Toast, against your last ${L.nights} ${dayOf(day)}s.`} Guests per 15 minutes. The likely range comes from how far off this guess was on your own past days{L.calibrated ? '' : ', and is still learning'}.</p></div>
          ) : <Note icon="Clock">The 15-minute view shows while {M.label.toLowerCase()} is live from Toast{own ? '' : ' (the sample has it for dinner today)'}. The hour-by-hour plan is under Hour by hour.</Note>)}
          {view.detail === 'hours' && (rows.length ? (
            <div className={s.tableWrap}><table className="cv-table">
              <thead><tr><th>Hour</th><th>Usual</th><th>Busiest</th><th>On</th><th>Needed</th><th>Spare / short</th><th>Per server</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.hour} className={selHour === r.hour ? s.rowNow : ''} onClick={() => setSel(r.hour)}><td>{r.label}</td><td>{r.usual}</td><td>{r.busiest}</td><td>{r.servers}</td><td>{r.need}</td><td>{r.spare ? `${r.spare} spare` : r.short ? `${r.short} short` : '—'}</td><td>{r.perServer ?? '—'}</td></tr>)}</tbody>
            </table><p className="cv-xs cv-faint">Your last {plan.weeks} {dayOf(day)}s{own ? ' from Toast' : ' (sample)'}. “Needed” is sized for the busiest of them at your own {plan.rate.toFixed(1)} guests per server-hour.</p></div>
          ) : <Note icon="Clock">No {M.label.toLowerCase()} history for {dayOf(day)}s yet.</Note>)}
          {view.detail === 'rules' && (
            <div className={s.rules}>
              <div className={s.block}><span className={s.blockTitle}>Checks before anyone goes home</span>{checks.length ? <Checks checks={checks} /> : <span className="cv-xs cv-faint">No checks without data.</span>}</div>
              <div className={s.block}>
                <span className={s.blockTitle}>Your rules</span>
                <div className={s.fences}>
                  <div className={s.fence}><span className="cv-xs cv-faint">Fewest servers on dinner</span><b>{fences.minDinner}</b></div>
                  <div className={s.fence}><span className="cv-xs cv-faint">Fewest servers otherwise</span><b>{fences.minAny}</b></div>
                  <div className={s.fence}><span className="cv-xs cv-faint">Latest time to send someone home</span><b>{clockLabel(fences.cutBy)}</b></div>
                </div>
                <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('fences')}>Change rules</Button>
                <ul className="cv-ul">
                  <li><Icon name="Activity" size={15} />Today is compared with the same weekday on recent weeks. The likely range comes from how far off that guess was on your own past days.</li>
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
                <span className="cv-sm">{wage ? `No send-home ${isToday ? 'today' : 'planned'}, so no labor to save.` : 'No wage rates in your data, so no dollar figures.'}{rows.some((r) => r.spare) && wage ? ` On a usual ${dayOf(day)}, spare server-hours cost about ${cvMoney(rows.reduce((t, r) => t + r.spare, 0) * wage)}.` : ''}</span>
              )}
            </div>
          )}
          {view.detail === 'past' && (past.length ? (
            <ul className={s.past}>{past.map((p, k) => <li key={k}><b>{p.date}{p.meal ? ` · ${MEALS[p.meal].label}` : ''}</b><span>{p.answer === 'yes' ? `Send 1 home at ${p.at ? clockLabel(clockMinutes(p.at)) : '—'}` : p.answer === 'later' ? 'Decide later' : p.answer === 'no' ? 'Kept everyone on' : 'Send-home call'}{p.to ? ` · handed to the ${HANDOFF[p.to]}` : ''}</span><span className="cv-faint">{outcome(p)}</span></li>)}</ul>
          ) : <Note icon="ListChecks">No decisions yet. Each one shows here with what came of it.</Note>)}
          {view.detail === 'busy' && <DenseService />}
        </div>
      </section>
    </div>
  );
}

export { CvService };
