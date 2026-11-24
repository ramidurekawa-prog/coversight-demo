'use client';

// The pre-shift staffing call, shown the same way on Today and Service: the
// hours scheduled against what Covercast (or the room's own history) says
// each hour needs, the evidence the call rests on, and once approved what
// became of it. Every figure comes from lib/data/page/staffing.js; nothing
// is worked out here.
import * as React from 'react';

import { Button, Icon } from '../kit';
import { localNow } from '../../lib/data/page/service.js';
import { ADJUST_REASONS, coveredNote, shortDate, staffingCardId, staffingCards, staffingDecision, staffingOutcome } from '../../lib/data/page/staffing.js';
import { applyOp, cardState, queueView } from '../../lib/data/page/today.js';
import { engine, useEngine, useSaved } from '../engine';
import { CV_D, Claim, useCv } from './core';
import { useCovercast } from './covercast';
import { Editor } from './pages/inputs-editor';
import s from './staffing.module.css';

/* Pages remount when the data changes (shell.jsx keys them by version), so an editor opened in
   place would close the moment its rows are saved. This keeps that one bit of view state. */
const sticky = new Map();
/** useState that survives the page remount after a save. */
export function useSticky(key, initial = null) {
  const [v, setV] = React.useState(() => (sticky.has(key) ? sticky.get(key) : initial));
  const set = React.useCallback((next) => { if (next == null) sticky.delete(key); else sticky.set(key, next); setV(next); }, [key]);
  return [v, set];
}

const usd = (c) => `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`;

/** The room's local date and minutes, ticking each minute, so a deadline passes on screen. */
function useLocalNow(tz) {
  const [t, setT] = React.useState(() => Date.now());
  React.useEffect(() => { const i = setInterval(() => setT(Date.now()), 60_000); return () => clearInterval(i); }, []);
  return localNow(new Date(t), tz);
}

/**
 * Everything the staffing call reads in the browser, the same inputs the
 * server re-checks an approval with: the room, its fences, its tasks, its
 * saved inputs and (unless the history is typed by hand) Covercast.
 */
export function useStaffingInputs() {
  const eng = useEngine();
  const room = CV_D.room;
  const [fences] = useSaved('fences', null);
  const wantsCast = !room.serviceOwn && (!!room.fromToast || (room.shifts || []).length > 0);
  const cc = useCovercast(room, CV_D.id, eng.mode === 'server', wantsCast);
  const clock = useLocalNow(room.tz);
  const tasks = (eng.tasks || []).filter((t) => t.roomId === CV_D.id);
  const entries = eng.inputs?.[CV_D.id] || {};
  // The manager's own changes to the guests expected (a large party, an event): the call is worked out on them.
  const [adjust] = useSaved('staffing.adjust', null);
  return { room, fences, cc: wantsCast ? cc : null, tasks, entries, adjust, today: clock.date, nowMin: clock.minutes };
}

const sigOf = (x) => [x.room, x.fences, x.cc, x.tasks, x.entries, x.adjust, x.today, x.nowMin];

/**
 * Remembers each call that needed a decision (staffing.seen), so one the
 * schedule later covers leaves the active list as history ("Covered"), and
 * nothing keeps warning about it.
 */
export function useSeenCalls(decisions) {
  const [seen, setSeen] = useSaved('staffing.seen', null);
  const acts = (decisions || []).filter((d) => d && d.state === 'act');
  const sig = acts.map((d) => `${d.id}:${d.version}`).join('|');
  React.useEffect(() => {
    const cur = seen || {};
    const fresh = acts.filter((d) => cur[d.id]?.version !== d.version);
    if (!fresh.length) return;
    const next = { ...cur };
    for (const d of fresh) next[d.id] = { title: d.title, kind: d.kind, version: d.version, at: new Date().toISOString(), ...(d.proposedId ? { approvalId: d.proposedId } : {}) };
    setSeen(Object.fromEntries(Object.entries(next).sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, 30)));
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return seen || {};
}

/** Calls shown earlier that the schedule now covers: kept as history, out of the active list. */
export function useCoveredCalls() {
  const x = useStaffingInputs();
  const [seen] = useSaved('staffing.seen', null);
  return React.useMemo(() => Object.entries(seen || {}).map(([id, rec]) => {
    const m = /^staff:(\d{4}-\d{2}-\d{2}):(lunch|dinner)$/.exec(id);
    if (!m || m[1] < x.today) return null;
    const dec = staffingDecision(x.room, { ...x, date: m[1], meal: /** @type {'lunch'|'dinner'} */ (m[2]) });
    const note = coveredNote(rec, dec);
    return note ? { id, dec, ...note } : null;
  }).filter(Boolean), [seen, ...sigOf(x)]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Today's staffing cards for the room in view. */
export function useStaffingCards() {
  const x = useStaffingInputs();
  const cards = React.useMemo(() => staffingCards(x.room, x), sigOf(x)); // eslint-disable-line react-hooks/exhaustive-deps
  useSeenCalls(cards.map((c) => c.staffing));
  return cards;
}

/** One service's call, read fresh; `choose` is a nearer time the manager picked from its options. */
export function useStaffingDecision(date, meal, choose = null) {
  const x = useStaffingInputs();
  return React.useMemo(() => (date && meal ? staffingDecision(x.room, { ...x, date, meal, choose }) : null), [...sigOf(x), date, meal, choose]); // eslint-disable-line react-hooks/exhaustive-deps
}

async function call(path, init) {
  const r = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
  return b;
}

/**
 * Today's queue, for the staffing cards only: the same record and ops Today
 * uses (decline, snooze, assign), so "keep the schedule" said on Service is
 * the same decision Today shows. Signed in, the server's queue; else this
 * browser's saved one.
 */
export function useStaffingQueue(x) {
  const eng = useEngine();
  const server = eng.mode === 'server';
  const cards = React.useMemo(() => staffingCards(x.room, x), sigOf(x)); // eslint-disable-line react-hooks/exhaustive-deps
  const own = !!CV_D.room.fromToast;
  const tz = CV_D.room.tz;
  const [saved, setSaved] = useSaved('queue', null);
  const [remote, setRemote] = React.useState(/** @type {any} */ (null));
  const taskSig = x.tasks.map((t) => `${t.approvalId}:${t.status}`).join('|');
  React.useEffect(() => {
    if (!server) return undefined;
    let live = true;
    call(`/api/page/today?room=${encodeURIComponent(CV_D.id)}`).then((b) => { if (live) setRemote(b); }).catch(() => {});
    return () => { live = false; };
  }, [server, taskSig]);
  const view = server && remote ? remote.state : queueView(saved, { today: x.today, own, tz, cards });
  const stateOf = (date, meal) => {
    const c = cards.find((k) => k.id === staffingCardId(date, meal));
    return c ? cardState(c, view) : null;
  };
  /** @returns {Promise<{ ok: boolean, error?: string }>} */
  const run = async (op, date, meal, { reason, summary, to, name } = /** @type {any} */ ({})) => {
    const cardId = staffingCardId(date, meal);
    try {
      const next = applyOp(view, { op, cardId, reason, to, name }, { cards, today: x.today, own, tz });
      if (!server) { setSaved(next, summary); return { ok: true }; }
      setRemote(await call('/api/page/today', { method: 'POST', body: JSON.stringify({ roomId: CV_D.id, op, cardId, reason, to, name }) }));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };
  /** Who the card is with, if someone was asked to approve it. */
  const heldBy = (date, meal) => view.assigned?.[staffingCardId(date, meal)] || null;
  return { stateOf, run, heldBy, people: (server && remote?.people) || [] };
}

/**
 * Approve a staffing change: one task, the server's own check first. In the
 * browser-only demo the evidence is the decision as shown; signed in, the
 * server rebuilds it and refuses if the numbers moved.
 * @returns {Promise<{ ok: true, task: any } | { ok: false, error: string }>}
 */
export function approveStaffing(dec) {
  if (!dec?.approvalId) return Promise.resolve({ ok: false, error: 'This change can’t be approved as it stands. Look at the latest call.' });
  let error = null;
  const evidence = { rule: dec.rule, version: dec.version, at: new Date().toISOString(), change: dec.change, estimate: dec.estimate, forecast: dec.forecast, schedule: dec.schedule, hours: dec.hours, guardrails: dec.guardrails, title: dec.title, edited: dec.edited ?? null, window: dec.window ?? null, changes: (dec.changes || []).slice(0, 10) };
  return engine.createTask(dec.approvalId, { title: dec.title, system: dec.system, diff: dec.diff, evidence, onError: (m) => { error = m; } })
    .then((t) => (t ? { ok: true, task: t } : { ok: false, error: error || 'Not approved. Look at the latest call and try again.' }));
}

/**
 * The one chart the call rests on, hour by hour: guests on top (the likely
 * count, its range, the forecast before a manager's change, and what really
 * came in), servers below (scheduled, after the change, needed, and who was
 * on the clock), and the one stretch at risk marked across both.
 */
export function StaffingHours({ dec, compact = false }) {
  const rows = dec?.hoursRows || [];
  if (!rows.length) return null;
  const halves = rows.flatMap((r) => (r.halves || [{ scheduled: r.scheduled, after: r.after }]));
  const top = Math.max(1, ...rows.map((r) => Math.max(r.need, r.actual ?? 0)), ...halves.map((h) => Math.max(h.scheduled ?? 0, h.after ?? 0)));
  const unit = compact ? 14 : 20;
  const seg = (now, after, need, k) => (k < Math.min(after, now) ? s.segOn : k < now ? s.segRemoved : k < after ? s.segAdded : k < need ? s.segShort : s.segEmpty);
  const any = (f) => halves.some(f) || rows.some((r) => f(r));
  const win = dec.window || null;
  const inWin = (r) => win && r.hour * 60 >= win.from && r.hour * 60 < win.to;
  // Guests: one scale for the likely count, the range, the forecast before a change, and what came in.
  const gTop = Math.max(1, ...rows.map((r) => Math.max(r.high ?? 0, r.covers ?? 0, r.guests ?? 0, r.orig?.peak ?? 0)));
  const pct = (v) => `${Math.max(0, Math.min(100, (v / gTop) * 100))}%`;
  const hasRange = rows.some((r) => r.high != null && r.high !== r.covers);
  const hasOrig = rows.some((r) => r.adjusted);
  const hasGuests = rows.some((r) => r.guests != null);
  const hasActual = rows.some((r) => r.actual != null);
  return (
    <figure className={`${s.hours} ${compact ? s.compact : ''}`} aria-label={`Guests and servers by hour for ${dec.label.toLowerCase()}`}>
      <div className={s.cols}>
        {rows.map((r) => {
          const hs = r.halves || [{ t: r.hour * 60, scheduled: r.scheduled, after: r.after }];
          const changed = hs.some((h) => h.after !== h.scheduled);
          const lo = r.low ?? r.covers;
          return (
            <div key={r.hour} className={`${s.col} ${changed ? s.colChanged : ''} ${inWin(r) ? s.colRisk : ''}`}>
              {!compact && (
                <div className={s.guests} aria-hidden="true" title={`${r.label}: ${r.covers} guests likely${r.high !== r.covers ? `, up to ${r.high}` : ''}${r.adjusted ? ` (was ${r.orig.covers}${r.orig.peak !== r.orig.covers ? `–${r.orig.peak}` : ''} before your change)` : ''}${r.guests != null ? `; ${r.guests} came in` : ''}`}>
                  {r.high != null && r.high !== lo && <span className={s.gRange} style={{ bottom: pct(lo), height: `calc(${pct(r.high)} - ${pct(lo)})` }} />}
                  {r.adjusted ? <span className={s.gOrig} style={{ bottom: pct(r.orig.covers) }} /> : null}
                  <span className={s.gLikely} style={{ bottom: pct(r.covers) }} />
                  {r.guests != null && <span className={s.gActual} style={{ bottom: `calc(${pct(r.guests)} - 4px)` }} />}
                </div>
              )}
              <div className={s.pair}>
                {hs.map((h) => (
                  <div key={h.t} className={s.stack} style={{ height: `${top * unit}px` }}>
                    {Array.from({ length: top }, (_, i) => <span key={i} className={seg(h.scheduled ?? 0, h.after ?? h.scheduled ?? 0, r.need, top - 1 - i)} />)}
                  </div>
                ))}
                <span className={s.needLine} style={{ bottom: `${(r.need / top) * 100}%` }} aria-hidden="true" />
                {r.actual != null && <span className={s.actualLine} style={{ bottom: `${(r.actual / top) * 100}%` }} aria-hidden="true" />}
              </div>
              <span className={s.hourLabel}>{r.label.replace(':00', '')}</span>
              {!compact && <span className={s.cov}>{r.covers}{r.high !== r.covers ? <small>–{r.high}</small> : null}</span>}
              {!compact && (() => {
                // The gap for this hour after the change, at its thinnest half hour: spare, exact, or short.
                const g = Math.min(...hs.map((h) => (h.after ?? h.scheduled ?? 0))) - r.need;
                return <span className={`${s.gap} ${g > 0 ? s.gapSpare : g < 0 ? s.gapShort : ''}`} title={g > 0 ? `${g} more than needed` : g < 0 ? `${-g} short` : 'Exactly what’s needed'}>{g > 0 ? `+${g}` : g < 0 ? `−${-g}` : '0'}</span>;
              })()}
            </div>
          );
        })}
      </div>
      <figcaption className={s.key}>
        {!compact && <span><i className={s.gLikelyKey} />Guests likely</span>}
        {!compact && hasRange && <span><i className={s.gRangeKey} />Likely range</span>}
        {!compact && hasOrig && <span><i className={s.gOrigKey} />Before your change</span>}
        {!compact && hasGuests && <span><i className={s.gActualKey} />Guests who came</span>}
        <span><i className={s.segOn} />Servers scheduled</span>
        {any((h) => h.after < h.scheduled) && <span><i className={s.segRemoved} />Not needed</span>}
        {any((h) => h.after > h.scheduled) && <span><i className={s.segAdded} />Added</span>}
        {rows.some((r) => (r.halves || []).some((h) => h.after < r.need)) && <span><i className={s.segShort} />Short</span>}
        <span><i className={s.needKey} />Servers needed</span>
        {hasActual && <span><i className={s.actualKey} />On the clock</span>}
        {!compact && <span className={s.covKey}>Under each hour: guests, then servers spare (+) or short (−)</span>}
      </figcaption>
      {win && <p className={s.riskNote}><Icon name="TriangleAlert" size={14} /><b>Watch {win.label}.</b> {win.why}.</p>}
      <table className={s.srOnly}>
        <caption>Guests and servers by hour</caption>
        <thead><tr><th>Hour</th><th>Guests likely</th><th>Guests top</th><th>Before your change</th><th>Guests who came</th><th>Servers needed</th><th>Scheduled</th><th>After the change</th><th>On the clock</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.hour}><td>{r.label}</td><td>{r.covers}</td><td>{r.high}</td><td>{r.adjusted ? r.orig.covers : ''}</td><td>{r.guests ?? ''}</td><td>{r.need}</td><td>{(r.halves || []).map((h) => h.scheduled).join(' then ') || r.scheduled}</td><td>{(r.halves || []).map((h) => h.after).join(' then ') || r.after}</td><td>{r.actual ?? ''}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Scheduled, needed and on the clock for the same hours, side by side (7shifts' labor budget view). */
export function StaffingCompare({ dec }) {
  const rows = dec?.hoursRows || [];
  if (!rows.length) return null;
  const hasActual = rows.some((r) => r.actual != null);
  const changed = rows.some((r) => r.after !== r.scheduled);
  return (
    <div className="cv-tablewrap">
      <table className={`cv-table ${s.compare}`}>
        <thead><tr><th scope="col">Servers</th>{rows.map((r) => <th key={r.hour} scope="col" className="r">{r.label.replace(':00', '')}</th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">Scheduled</th>{rows.map((r) => <td key={r.hour} className="r">{r.scheduled}</td>)}</tr>
          {changed && <tr><th scope="row">After the change</th>{rows.map((r) => <td key={r.hour} className="r">{r.after}</td>)}</tr>}
          <tr><th scope="row">Needed</th>{rows.map((r) => <td key={r.hour} className="r">{r.need}</td>)}</tr>
          {hasActual && <tr><th scope="row">On the clock</th>{rows.map((r) => <td key={r.hour} className={`r ${r.actual != null && r.actual < r.need ? s.gapShort : ''}`}>{r.actual ?? '—'}</td>)}</tr>}
        </tbody>
      </table>
    </div>
  );
}

const SRC = { hand: 'Your guests-by-hour entries', toast: 'Your Toast data', sample: 'Sample restaurant data' };

/** What the call rests on: forecast and its range, the schedule, the rate, the guardrails, and what changed the outlook. */
export function StaffingEvidence({ dec }) {
  if (!dec?.forecast) return null;
  const f = dec.forecast;
  const e = dec.estimate;
  return (
    <div className={s.evidence}>
      <dl className={s.facts}>
        <dt>Forecast</dt>
        <dd>{f.covers} guests{f.low != null ? `, likely ${f.low}–${f.high}` : f.high ? `, up to ${f.high} on the busiest recent ${dec.label.toLowerCase()}` : ''} · {f.hours}{f.original ? ` · ${f.original.covers} before your change` : ''}</dd>
        <dt>From</dt>
        <dd>{f.engine ? `Covercast on ${SRC[f.source].toLowerCase()}` : SRC[f.source]} · {f.weeks} past {dec.day} {dec.label.toLowerCase()}s · {f.rate} guests a server an hour</dd>
        <dt>Schedule</dt>
        <dd>{dec.schedule.servers} server shift{dec.schedule.servers === 1 ? '' : 's'} on {shortDate(dec.date)}{dec.schedule.savedLabel ? ` · saved ${dec.schedule.savedLabel}` : ''}{dec.schedule.source === 'sample' ? ' · sample schedule' : ''}</dd>
        {e && <><dt>{e.cost ? 'Cost' : 'Estimate'}</dt><dd className={s.money}><b>{usd(e.cents)}</b> {e.cost ? 'more labor' : 'less labor'} · {e.minutes} min × {usd(e.rateCents)}/hr ({e.rateLabel}) <Claim k="est" label={e.cost ? 'Estimated cost' : 'Estimated, before offsets'} /></dd></>}
      </dl>
      {dec.guardrails && (
        <ul className={s.guards} aria-label="Checks">
          {dec.guardrails.map((g) => (
            <li key={g.key} className={g.ok === true ? s.ok : g.ok === false ? s.bad : s.yours}>
              <Icon name={g.ok === true ? 'CircleCheck' : g.ok === false ? 'CircleX' : 'CircleHelp'} size={15} />
              <span>{g.label}{g.note ? <small> {g.note}</small> : null}</span>
            </li>
          ))}
        </ul>
      )}
      {dec.risk && <p className={s.risk}><Icon name="TriangleAlert" size={14} />{dec.risk}</p>}
      <OutlookChanges changes={dec.changes} />
    </div>
  );
}

/** Which data moved the outlook, and when (Tenzo's lesson: show what changed, so a bad source can be found). */
export function OutlookChanges({ changes }) {
  if (!changes?.length) return null;
  return (
    <div className="cv-col" style={{ gap: 4 }}>
      <span className="cv-over">What changed the outlook</span>
      <ul className={s.changes}>
        {changes.slice(0, 6).map((c, i) => <li key={i}><b>{c.when}</b> · {c.what}{c.by ? `, ${c.by}` : ''}</li>)}
      </ul>
    </div>
  );
}

/** The proof behind the dollar: decision, what was done, baseline, records, the sum, offsets, what's missing and who can supply it. */
export function StaffingProof({ proof }) {
  if (!proof) return null;
  const a = proof.amounts || {};
  const money = (c) => (c == null ? '—' : `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toFixed(2)}`);
  return (
    <section className={s.proof} aria-label="How this dollar was worked out">
      {proof.kind === 'saving' && (
        <div className={s.proofAmounts}>
          <div className={s.proofAmt}><span>Estimated before the shift <Claim k="est" /></span><b>{money(a.estimated)}</b></div>
          <div className={`${s.proofAmt} ${a.observed ? s.proofAmtGood : ''}`}><span>Observed labor difference <Claim k="obs" /></span><b>{money(a.observed)}</b></div>
          <div className={s.proofAmt}><span>Verified savings <Claim k="book" label="Bookable" /></span><b>{money(a.verified)}</b></div>
        </div>
      )}
      <ul className={s.proofLines}>
        {proof.lines.map((l) => (
          <li key={l.key} className={l.total ? s.proofTotal : ''}>
            <b>{l.label}{l.claim && l.cents != null ? <> <Claim k={l.claim} /></> : null}</b>
            {l.items ? <small>{l.items.map((it) => `${it.label}: ${it.text}`).join(' · ')}</small> : <small>{l.text}</small>}
            {l.cents != null && <span className="pCents">{money(l.cents)}</span>}
          </li>
        ))}
        {proof.payroll && <li><b>Payroll check</b><small>{proof.payroll.text}</small></li>}
        <li className={s.proofTotal}><b>Could count once verified</b><small>{proof.countable.text}</small><span className="pCents">{money(proof.countable.cents)}</span></li>
        <li><b>Counted as verified savings</b><small>{proof.verified.text}</small><span className="pCents">{money(proof.verified.cents)}</span></li>
      </ul>
      {proof.missing.length > 0 && (
        <ul className={s.proofMissing} aria-label="Still missing">
          {proof.missing.map((m) => <li key={m.key}><span><b>Missing: {m.what}.</b> {m.who} can add it. {m.how}.</span></li>)}
        </ul>
      )}
    </section>
  );
}

/** What happened after an approval: decision, made, clock-ins, observed, and why it isn't counted as savings. The dollar opens its proof. */
export function StaffingOutcome({ task, room = CV_D.room }) {
  const o = React.useMemo(() => (task ? staffingOutcome(task, room) : null), [task, room]);
  const [open, setOpen] = useSticky(`proof:${task?.approvalId || ''}`, false);
  if (!o) return null;
  return (
    <div className="cv-col" style={{ gap: 10 }}>
      <ol className={s.stages} aria-label="What happened">
        {o.stages.map((st) => (
          <li key={st.key} className={s[`st_${st.state}`] || ''}>
            <Icon name={st.state === 'done' ? 'CircleCheck' : st.state === 'warn' ? 'TriangleAlert' : st.state === 'no' ? 'Ban' : 'Clock'} size={15} />
            <span className={s.stLabel}>{st.label}{st.key === 'observed' ? <> <Claim k="obs" /></> : null}</span>
            <span className={s.stText}>{st.key === 'observed' && o.proof
              ? <button type="button" className={s.moneyBtn} aria-expanded={!!open} onClick={() => setOpen(!open)} title="See how this was worked out">{st.text}</button>
              : st.text}</span>
          </li>
        ))}
      </ol>
      {o.guard?.vs && (
        <p className={s.risk} style={{ color: 'var(--fg-1)' }}><Icon name="Users" size={14} />Forecast {o.guard.vs.forecast}{o.guard.vs.adjusted != null ? `, ${o.guard.vs.adjusted} after your change (${o.guard.vs.adjustments.map((x) => x.label.toLowerCase()).join(', ')})` : ''} · {o.guard.vs.actual} came in.</p>
      )}
      {o.proof && <button type="button" className={s.fix} aria-expanded={!!open} onClick={() => setOpen(!open)}>{open ? 'Hide how it’s worked out' : 'How this is worked out'}<Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} /></button>}
      {open && <StaffingProof proof={o.proof} />}
    </div>
  );
}

/**
 * A manager's local knowledge (Tenzo's forecast review): more or fewer guests
 * in one hour, with the reason. Saved for the room (staffing.adjust) and the
 * call is worked out again on it; the forecast as it was is kept, and the
 * change can be taken back.
 */
export function AdjustGuests({ dec }) {
  const [saved, setSaved] = useSaved('staffing.adjust', null);
  const eng = useEngine();
  const hours = (dec?.hoursRows || []).map((r) => r.hour);
  const [hour, setHour] = React.useState(() => hours[Math.floor(hours.length / 2)] ?? null);
  const [guests, setGuests] = React.useState('');
  const [reason, setReason] = React.useState(null);
  const [note, setNote] = React.useState('');
  if (!dec || !hours.length) return null;
  const list = Array.isArray(saved?.list) ? saved.list : [];
  const mine = list.filter((a) => a.date === dec.date && a.meal === dec.meal);
  const n = parseInt(guests, 10);
  const ok = hour != null && Number.isInteger(n) && n !== 0 && Math.abs(n) <= 500 && reason;
  const by = eng.viewer?.name || undefined;
  const add = () => {
    if (!ok) return;
    const entry = { id: `adj-${Date.now().toString(36)}`, date: dec.date, meal: dec.meal, hour, guests: n, reason, ...(note.trim() ? { note: note.trim().slice(0, 80) } : {}), at: new Date().toISOString(), ...(by ? { by } : {}) };
    setSaved({ list: [...list.filter((a) => a.date >= dec.date || a.date >= new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)), entry].slice(-60) }, `${dec.label} ${dec.date}: ${n > 0 ? '+' : ''}${n} guests at ${hour}:00 (${ADJUST_REASONS[reason]})`);
    setGuests(''); setReason(null); setNote('');
  };
  const remove = (id) => setSaved({ list: list.filter((a) => a.id !== id) }, `${dec.label} ${dec.date}: took back a change to the guests expected`);
  const label = (h) => new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' }).toLowerCase();
  return (
    <div className={s.adjust}>
      <span className="cv-over">Know something the forecast doesn’t?</span>
      {mine.length > 0 && (
        <ul className={s.adjList} aria-label="Your changes to the guests expected">
          {mine.map((a) => (
            <li key={a.id}>
              <Icon name="PencilLine" size={14} />
              <span><b>{a.guests > 0 ? '+' : '−'}{Math.abs(a.guests)} guests at {label(a.hour)}</b> · {ADJUST_REASONS[a.reason]}{a.note ? ` (${a.note})` : ''} <small>{a.by ? `${a.by}, ` : ''}{new Date(a.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</small></span>
              <button type="button" className={s.fix} onClick={() => remove(a.id)}>Take back</button>
            </li>
          ))}
        </ul>
      )}
      <div className={s.adjustRow}>
        <label className="cv-row" style={{ gap: 6 }}><span className="cv-small">At</span>
          <select value={hour ?? ''} onChange={(e) => setHour(Number(e.target.value))} aria-label="Hour">{hours.map((h) => <option key={h} value={h}>{label(h)}</option>)}</select>
        </label>
        <label className="cv-row" style={{ gap: 6 }}><span className="cv-small">Guests</span>
          <input type="number" inputMode="numeric" value={guests} placeholder="+20 or −10" onChange={(e) => setGuests(e.target.value)} aria-label="More guests (or fewer, with a minus)" />
        </label>
      </div>
      <div className={s.reasons} role="group" aria-label="Why">
        {Object.entries(ADJUST_REASONS).map(([k, l]) => <button key={k} type="button" className={s.reason} aria-pressed={reason === k} onClick={() => setReason(k)}>{l}</button>)}
      </div>
      <div className={s.adjustRow}>
        <input type="text" value={note} maxLength={80} placeholder="A note, if it helps (optional)" onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        <Button size="sm" icon="Check" disabled={!ok} onClick={add}>Update the forecast</Button>
      </div>
      <span className="cv-xs cv-faint">The forecast as it was is kept. The call above is worked out again with your change; you can take it back.</span>
    </div>
  );
}

/** The suggested time stays editable: any nearer one the call allows, each re-checked by the server before approval. */
export function TimeChoice({ dec, choose, onChoose }) {
  if (!dec?.options?.length) return null;
  const verb = dec.kind === 'start' ? 'Start at' : 'End at';
  const cur = choose || dec.options.find((o) => o.recommended)?.approvalId;
  return (
    <div className={s.choose} role="group" aria-label={`${verb}: pick a time`}>
      <span>{verb}</span>
      {dec.options.map((o) => (
        <button key={o.approvalId} type="button" className={s.reason} aria-pressed={cur === o.approvalId} onClick={() => onChoose(o.recommended ? null : o.approvalId)}>
          {o.label}<small>{o.recommended ? 'suggested' : o.cents != null ? usd(o.cents) : `${o.minutes} min`}</small>
        </button>
      ))}
    </div>
  );
}

/** Who can approve, and where the approval stands (Ramp's inbox: what's pending, with whom, and done). */
export function ApprovalLine({ dec, held = null, status = null, people = [] }) {
  if (!dec) return null;
  // Who asked, by name: never a raw account id.
  const by = held?.from ? (people.find((p) => p.id === held.from)?.name ?? (String(held.from).startsWith('user:') ? null : held.from)) : null;
  const t = dec.task;
  const state = t ? ({ open: 'Approved · to be made', done: 'Made · waiting for clock-ins', verified: 'Made · clock-ins match', mismatch: 'Made · clock-ins don’t match' }[t.status] || 'Approved')
    : held ? `Waiting on ${held.label}${held.at ? `, asked ${new Date(held.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}` : ''}${by ? ` by ${by}` : ''}`
      : status || (dec.state === 'act' ? 'Needs approval' : null);
  return (
    <p className={s.approval}>
      <span><Icon name="UserCheck" size={14} /> <b>{dec.approvers || 'The GM or the owner'}</b> approves</span>
      {state && <span><Icon name={t ? 'CircleCheck' : held ? 'Hourglass' : 'CircleDot'} size={14} /> {state}</span>}
      {dec.room && <span><Icon name="MapPin" size={14} /> {dec.room}</span>}
    </p>
  );
}

/** A refresh that failed: the view stays as it was, with how old it is and a retry. */
export function RefreshNote({ failedAt, syncedAt, onRetry, busy = false }) {
  if (!failedAt) return null;
  const t = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return (
    <p className={s.refresh} role="status">
      <Icon name="WifiOff" size={15} />
      <span>Couldn’t refresh at {t(failedAt)}. {syncedAt ? `Showing what was current at ${t(syncedAt)}.` : 'Showing the last saved view.'}</span>
      <Button size="sm" variant="secondary" icon="RefreshCw" disabled={busy} onClick={onRetry}>{busy ? 'Trying…' : 'Try again'}</Button>
    </p>
  );
}

/** "What the call needs": each input ready, limited, stale, missing or later, with its fix. */
export function StaffingReadiness({ readiness, onFix }) {
  if (!readiness) return null;
  const ICON = { ready: 'CircleCheck', limited: 'CircleDot', stale: 'TriangleAlert', missing: 'CircleX', later: 'Clock' };
  const WORD = { ready: 'Ready', limited: 'Limited', stale: 'Out of date', missing: 'Missing', later: 'After the shift' };
  return (
    <ul className={s.ready}>
      {readiness.items.map((it) => (
        <li key={it.key} className={s[`r_${it.state}`]}>
          <Icon name={ICON[it.state]} size={16} />
          <span className={s.rMain}><b>{it.label}</b> <span className={s.rState}>{WORD[it.state]}{it.state === 'ready' ? '' : it.need === 'required' ? ' · blocks the staffing check' : it.need === 'dollars' ? ' · needed for the dollar figure' : it.need === 'proof' ? ' · needed to prove it worked' : ''}</span><small>{it.detail}</small></span>
          {it.fix && it.state !== 'ready' && onFix && <button type="button" className={s.fix} onClick={() => onFix(it.fix)}>{it.fix.label}<Icon name="ArrowRight" size={13} /></button>}
        </li>
      ))}
    </ul>
  );
}

const STATE_CHIP = {
  act: { icon: 'CircleDot', label: 'Needs your decision', cls: 'chipAct' },
  hold: { icon: 'CircleCheck', label: 'No change needed', cls: 'chipOk' },
  blocked: { icon: 'CircleAlert', label: 'Needs data first', cls: 'chipWarn' },
  decided: { icon: 'CircleCheck', label: 'Approved', cls: 'chipOk' },
  late: { icon: 'Clock', label: 'Past the time to change it', cls: 'chipMuted' },
  live: { icon: 'Activity', label: 'Under way', cls: 'chipMuted' },
  over: { icon: 'Moon', label: 'Over', cls: 'chipMuted' },
};

/** Roles that may approve a schedule change (the server enforces it: server/page/staffing.ts STAFFING_APPROVERS). */
const APPROVER_ROLES = ['owner', 'admin', 'gm'];
/** Can the person looking approve? Signed in, by their role; the browser-only demo has no floor-manager view. */
export function useCanApprove() {
  const eng = useEngine();
  return eng.mode !== 'server' || APPROVER_ROLES.includes(eng.viewer?.role);
}

/**
 * Service's "before the shift" call for the date and service in view: the
 * same decision, card id and record Today shows. Approve makes the one task;
 * "Keep the schedule" is Today's decline. A floor manager asks a GM instead.
 * Hidden for a room with nothing to check (no own data and no schedule entered).
 */
export function ShiftCall({ date, meal, back = null }) {
  const cv = useCv();
  const eng = useEngine();
  const room = CV_D.room;
  const x = useStaffingInputs();
  const [choose, setChoose] = useSticky(`service-choose:${CV_D.id}:${date}:${meal}`);
  const dec = React.useMemo(() => (date && meal ? staffingDecision(x.room, { ...x, date, meal, choose }) : null), [...sigOf(x), date, meal, choose]); // eslint-disable-line react-hooks/exhaustive-deps
  useSeenCalls(dec ? [dec] : []);
  const [seen] = useSaved('staffing.seen', null);
  const covered = dec ? coveredNote(seen?.[dec.id], dec) : null;
  const q = useStaffingQueue(x);
  const canApprove = useCanApprove();
  const [busy, setBusy] = React.useState(false);
  const [why, setWhy] = React.useState(false);
  const [adjusting, setAdjusting] = useSticky(`service-adjust:${CV_D.id}:${date}:${meal}`, false);
  const [msg, setMsg] = React.useState(/** @type {{ tone: string, text: string }|null} */ (null));
  // Fixed in place: the missing schedule or history opens right here, on that service's rows.
  const [fixing, setFixing] = useSticky(`service-fix:${CV_D.id}:${date}:${meal}`);
  React.useEffect(() => { setMsg(null); setWhy(false); }, [date, meal]);
  const eligible = !!(room.fromToast || room.serviceOwn || (room.shifts || []).length);
  // Once the service is under way (or over) Service's live call and the outcome below it take over.
  if (!dec || !eligible || ['closed', 'live', 'over'].includes(dec.state)) return null;
  const qs = q.stateOf(date, meal);
  const kept = qs === 'declined';
  const held = q.heldBy(date, meal);
  const heldLine = held ? { label: held.to === 'gm' ? 'the GM' : held.to === 'owner' ? 'the owner' : held.name || 'a manager', at: held.at, from: held.from } : null;
  const chip = kept ? { icon: 'CircleMinus', label: 'You kept the schedule', cls: 'chipMuted' }
    : covered ? { icon: 'CircleCheck', label: 'Covered', cls: 'chipOk' }
      : held && dec.state === 'act' ? { icon: 'Hourglass', label: 'Waiting on approval', cls: 'chipWarn' }
        : STATE_CHIP[dec.state] || STATE_CHIP.hold;
  const fix = (f) => setFixing(f);
  const approve = async () => {
    if (busy) return;
    setBusy(true);
    const r = await approveStaffing(dec);
    setBusy(false);
    if (r.ok) setChoose(null);
    setMsg(r.ok ? { tone: 'ok', text: `Approved: ${dec.title}. Nothing changes until someone makes it in your schedule and tells the person. It’s on Today under Being handled.` } : { tone: 'bad', text: `Not approved. ${r.error}` });
  };
  const ask = async () => {
    if (busy) return;
    setBusy(true);
    const r = await q.run('assign', date, meal, { to: 'gm', summary: `${dec.label} ${date}: asked the GM to approve` });
    setBusy(false);
    setMsg(r.ok ? { tone: 'ok', text: 'Asked the GM to approve. It shows on their Today, and here, as waiting on them.' } : { tone: 'bad', text: r.error || 'Not saved.' });
  };
  const keep = async () => {
    if (busy) return;
    setBusy(true);
    const r = await q.run('refuse', date, meal, { reason: 'not_now', summary: `${dec.label} ${date}: kept the schedule` });
    setBusy(false);
    setMsg(r.ok ? { tone: 'ok', text: 'Kept the schedule. Saved with your name; Today shows the same.' } : { tone: 'bad', text: r.error || 'Not saved.' });
  };
  const undo = async () => {
    setBusy(true);
    const r = await q.run('undo', date, meal, { summary: `${dec.label} ${date}: back on the list` });
    setBusy(false);
    setMsg(r.ok ? null : { tone: 'bad', text: r.error || 'Not saved.' });
  };
  const when = `${dec.label} · ${shortDate(date)}`;
  const showChart = ['act', 'hold', 'late', 'decided'].includes(dec.state) && dec.hoursRows;
  return (
    <section className={`cv-card ${s.call}`} aria-labelledby="shift-call-h">
      <RefreshNote failedAt={eng.refresh?.failedAt} syncedAt={eng.refresh?.syncedAt} onRetry={() => engine.hydrate()} />
      <div className={s.callHead}>
        <span className={s.callOver}><Icon name="CalendarClock" size={15} />Before the shift · {when}</span>
        <span className={`${s.chip} ${s[chip.cls]}`}><Icon name={chip.icon} size={13} />{chip.label}</span>
        {back === 'today' && <button type="button" className={s.fix} onClick={() => cv.go('today', { card: dec.id })}><Icon name="ArrowLeft" size={13} />Back to Today</button>}
      </div>
      <h3 id="shift-call-h" className={s.callTitle}>{dec.state === 'decided' ? dec.task.title : dec.title}</h3>
      {covered ? <p className={s.callWhy}>{covered.text}</p> : dec.why && dec.state !== 'decided' && <p className={s.callWhy}>{dec.why}</p>}
      {['act', 'decided'].includes(dec.state) && <ApprovalLine dec={dec} held={dec.state === 'act' ? heldLine : null} people={q.people} />}

      {dec.state === 'blocked' && <StaffingReadiness readiness={dec.readiness} onFix={fix} />}
      {showChart && <StaffingHours dec={dec} />}
      {dec.state === 'decided' && <StaffingOutcome task={dec.task} />}
      {dec.state === 'act' && !kept && <TimeChoice dec={dec} choose={choose} onChoose={setChoose} />}

      {dec.state === 'act' && !kept && (
        <div className={s.callActs}>
          {canApprove
            ? <Button icon="Check" disabled={busy} onClick={approve}>{busy ? 'Checking…' : `Approve: ${dec.short}`}</Button>
            : <Button icon="UserCheck" disabled={busy || !!held} onClick={ask}>{held ? 'Asked the GM' : 'Ask the GM to approve'}</Button>}
          <Button variant="secondary" disabled={busy} onClick={keep}>Keep the schedule</Button>
          <Button variant="ghost" iconRight={why ? 'ChevronUp' : 'ChevronDown'} aria-expanded={why} onClick={() => setWhy(!why)}>Show me why</Button>
        </div>
      )}
      {dec.state === 'act' && dec.estimate && !why && (
        <p className={s.callMoney}><b>{usd(dec.estimate.cents)}</b> {dec.estimate.cost ? 'more labor' : 'less labor this shift'} <Claim k="est" label={dec.estimate.cost ? 'Estimated cost' : 'Estimated, before offsets'} /></p>
      )}
      {kept && <div className={s.callActs}><Button size="sm" variant="ghost" icon="Undo2" disabled={busy} onClick={undo}>Put it back</Button></div>}
      {(why || dec.state === 'hold') && dec.forecast && <><StaffingCompare dec={dec} /><StaffingEvidence dec={dec} /></>}
      {dec.state === 'hold' && dec.readiness?.items?.some((i) => i.state !== 'ready' && i.fix) && (
        <StaffingReadiness readiness={{ ...dec.readiness, items: dec.readiness.items.filter((i) => i.state !== 'ready') }} onFix={fix} />
      )}
      {['act', 'hold', 'late'].includes(dec.state) && dec.hoursRows && (
        adjusting
          ? <><AdjustGuests dec={dec} /><button type="button" className={s.fix} onClick={() => setAdjusting(false)}>Done</button></>
          : <button type="button" className={s.fix} onClick={() => setAdjusting(true)}><Icon name="PencilLine" size={13} />Something different tonight? Update the guests expected</button>
      )}
      {fixing && (
        <div className={s.inlineFix}>
          <Editor key={`${CV_D.id}-${fixing.kind}-${fixing.date}`} kind={fixing.kind} seed={null} startMode="grid"
            context={{ date: fixing.date, meal: fixing.meal, back: null, today: x.today }} onBack={() => setFixing(null)} />
          <button type="button" className={s.fix} onClick={() => setFixing(null)}>Close</button>
        </div>
      )}
      {msg && <p className={`${s.callMsg} ${msg.tone === 'bad' ? s.msgBad : s.msgOk}`} role="status"><Icon name={msg.tone === 'bad' ? 'CircleX' : 'CircleCheck'} size={15} />{msg.text}</p>}
    </section>
  );
}
