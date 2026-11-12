'use client';

import * as React from 'react';
import { Icon, Button } from '../../kit';
import { useCv, cvFill, cvMoney, CV_D, CV_ROOM, Pill, PageHead, Claim, Callout, cvPlanCandidates, cvChoosePlan } from '../core';
import { engine, useEngine, useSaved } from '../../engine';
import { findingBlocked, findingTest } from '../../../lib/data/findings';
import {
  agendaFor, agendaMinutes, choiceKind, decisionUntil, DAYS, DEFAULT_SCHEDULE, DISMISS_DAYS, followupId, HOLD_DAYS, isPlanItem,
  itemClaim, MEETING_LIMITS, meetingRecord, meetingStats, meetingSummary, nextMeeting, openFollowups, slotLabel, trimDone,
} from '../../../lib/data/page/meeting';
import s from './meeting.module.css';

/* ================================================================ Weekly meeting
 * A fixed agenda filled from the room's data. Running it keeps a draft in this
 * browser (a refresh picks up where you were); finishing saves one `meeting`
 * entry for the room, applies the decision to the finding (hold or dismiss),
 * and carries follow-ups forward until someone ticks them off. */

const store = {
  get(k) { try { const r = window.localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } },
  set(k, v) { try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: keep going in memory */ } },
};
const scopeOf = (eng) => (eng.mode === 'server' ? eng.org?.id || 'server' : 'local');
const DRAFT = (eng) => `coversight-demo:meeting-draft:${scopeOf(eng)}:${eng.room}`;
const HISTORY = (room) => `coversight-demo:meeting-history:${room}`;

const clock = (secs) => { const a = Math.abs(Math.round(secs)); return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`; };
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const dayDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const KIND = {
  approve: { tone: 'good', icon: 'CircleCheck', label: 'Approved' },
  hold: { tone: 'warn', icon: 'Hourglass', label: 'On hold' },
  dismiss: { tone: 'neutral', icon: 'Undo2', label: 'Not for us' },
  other: { tone: 'info', icon: 'Gavel', label: 'Decided' },
  deferred: { tone: 'neutral', icon: 'Clock', label: 'Deferred' },
};

/** The room's finished meetings: from the server when signed in, else this browser. */
function useHistory(eng, last) {
  const [list, setList] = React.useState(null);
  const { room, mode } = eng;
  const load = React.useCallback(() => {
    if (mode === 'server') {
      return fetch(`/api/page/meeting?room=${encodeURIComponent(room)}`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((b) => setList((b.meetings || []).map((m) => ({ ...m.value, id: m.id, by: m.by }))))
        .catch(() => setList((cur) => cur ?? (last ? [{ ...last, id: 'last' }] : [])));
    }
    if (mode === 'local') setList(store.get(HISTORY(room)) || (last ? [{ ...last, id: 'last' }] : []));
    return Promise.resolve();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, mode]);
  React.useEffect(() => { setList(null); void load(); }, [load]);
  const add = (rec) => setList((l) => {
    const next = [{ ...rec, id: `new-${rec.at}` }, ...(l || [])].slice(0, MEETING_LIMITS.history);
    if (mode !== 'server') store.set(HISTORY(room), next);
    return next;
  });
  const clear = () => { setList([]); if (mode !== 'server') store.set(HISTORY(room), null); };
  return { list, add, clear, reload: load };
}

function MeetingSend({ rec, label = 'Email the summary' }) {
  const cv = useCv();
  const eng = useEngine();
  const m = meetingSummary(rec, CV_ROOM.name);
  return (
    <a className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }} href={`mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`}
      onClick={() => { if (eng.mode === 'server') engine.draftEmail({ kind: 'gm-note', subject: m.subject, body: m.body.slice(0, 5000) }).catch(() => null); cv.toast('Opening the summary in your email. A copy is kept in the outbox.'); }}>
      <Icon name="Mail" size={14} /> {label}
    </a>
  );
}

/** Everything a saved meeting holds. Older records (a log only) still read. */
function MeetingDetail({ rec, compact }) {
  const cv = useCv();
  const k = rec.decision ? KIND[rec.decision.kind] || KIND.other : null;
  const notes = (rec.items || []).filter((i) => i.note);
  const blocks = [
    rec.decision && (
      <div key="d" className="cv-col" style={{ gap: 6 }}>
        <h5>Decision</h5>
        <span className="cv-small">{rec.decision.title ? <><b>{rec.decision.title}</b>: </> : null}{rec.decision.choice}</span>
        <span className="cv-row" style={{ gap: 8 }}>
          <Pill tone={k.tone} icon={k.icon}>{k.label}</Pill>
          {rec.decision.id && !compact && <button className="cv-link" onClick={() => cv.go('finding', { id: rec.decision.id })}>Open the finding<Icon name="ArrowRight" size={13} /></button>}
        </span>
      </div>
    ),
    rec.plan?.length > 0 && (
      <div key="p" className="cv-col" style={{ gap: 6 }}>
        <h5>Plan committed</h5>
        <ul className="cv-ul" style={{ gap: 6 }}>{rec.plan.map((p) => <li key={p}><Icon name="Route" size={14} />{p}</li>)}</ul>
      </div>
    ),
    notes.length > 0 && (
      <div key="n" className="cv-col" style={{ gap: 6 }}>
        <h5>Notes</h5>
        <ul className="cv-ul" style={{ gap: 6 }}>{notes.map((i) => <li key={i.k}><Icon name="PencilLine" size={14} /><span><b>{i.k}.</b> {i.note}</span></li>)}</ul>
      </div>
    ),
    rec.followups?.length > 0 && (
      <div key="f" className="cv-col" style={{ gap: 6 }}>
        <h5>Follow-ups</h5>
        <ul className="cv-ul" style={{ gap: 6 }}>{rec.followups.map((f) => <li key={f.id}><Icon name="ListChecks" size={14} /><span>{f.text}{f.owner && <span className="cv-faint"> · {f.owner}</span>}</span></li>)}</ul>
      </div>
    ),
    !rec.items && rec.log?.length > 0 && (
      <div key="l" className="cv-col" style={{ gap: 6 }}>
        <h5>Logged</h5>
        <ul className="cv-ul" style={{ gap: 6 }}>{rec.log.map((l) => <li key={l}><Icon name="Check" size={14} />{l}</li>)}</ul>
      </div>
    ),
  ].filter(Boolean);
  if (!blocks.length) return <span className="cv-small cv-muted">Nothing was decided or noted.</span>;
  return <div className={`${s.detail} ${compact ? '' : s.detailGrid}`}>{blocks}</div>;
}

function Tick({ on, label, onClick }) {
  return (
    <button type="button" className={`${s.tick} ${on ? s.on : ''}`} role="checkbox" aria-checked={on} aria-label={label} onClick={onClick}>
      {on && <Icon name="Check" size={12} stroke={3} />}
    </button>
  );
}

function AddFollowup({ owners, onAdd }) {
  const [text, setText] = React.useState('');
  const [owner, setOwner] = React.useState(owners[0] || '');
  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onAdd({ text: t.slice(0, MEETING_LIMITS.followupText), owner: owner.trim().slice(0, MEETING_LIMITS.owner) });
    setText('');
  };
  return (
    <form className={s.add} onSubmit={submit}>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={MEETING_LIMITS.followupText} placeholder="Who does what by when" aria-label="Follow-up" />
      <div className={s.addRow}>
        <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={MEETING_LIMITS.owner} list="cv-meeting-owners" placeholder="Owner" aria-label="Owner" />
        <Button size="sm" variant="secondary" icon="Plus" type="submit" disabled={!text.trim()}>Add</Button>
      </div>
      <datalist id="cv-meeting-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
    </form>
  );
}

function SlotCard({ schedule, setSchedule, agendaMins, now }) {
  const [edit, setEdit] = React.useState(null);
  const next = nextMeeting(schedule, now);
  const today = next.toDateString() === now.toDateString();
  return (
    <section className="cv-card">
      <div className="cv-card-head"><span className="cv-h4">The slot</span>{!edit && <Button size="sm" variant="ghost" icon="PencilLine" onClick={() => setEdit({ ...schedule })}>Change</Button>}</div>
      {edit ? (
        <form className="cv-col" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); setSchedule(edit, `Weekly meeting moved to ${slotLabel(edit)}`); setEdit(null); }}>
          <div className={s.slotForm}>
            <select className="input" value={edit.day} onChange={(e) => setEdit({ ...edit, day: +e.target.value })} aria-label="Day">{DAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}</select>
            <input className="input" type="time" step="900" value={edit.time} onChange={(e) => setEdit({ ...edit, time: e.target.value })} aria-label="Time" required />
          </div>
          <div className="cv-row" style={{ gap: 6 }}><Button size="sm" type="submit" disabled={!/^\d\d:\d\d$/.test(edit.time)}>Save</Button><Button size="sm" variant="ghost" type="button" onClick={() => setEdit(null)}>Cancel</Button></div>
        </form>
      ) : (
        <div className={s.slot}>
          <b>{slotLabel(schedule)}</b>
          <span className="cv-small cv-muted">{today ? 'Today' : `Next: ${shortDate(next.toISOString())}`} · {agendaMins} minutes · Owner{CV_ROOM.gm ? ` + ${CV_ROOM.gm}` : ' + GM'}</span>
        </div>
      )}
    </section>
  );
}

function RecordCard({ list, done, setDone, open, setOpen, sample, onClear, now }) {
  const [all, setAll] = React.useState(false);
  const st = meetingStats(list || [], now);
  const shown = all ? list || [] : (list || []).slice(0, 5);
  return (
    <section className="cv-card">
      <div className="cv-card-head"><span className="cv-h4">This room&apos;s record</span>{list?.length > 0 && <span className="cv-xs cv-faint">{list.length} saved</span>}</div>
      <div className={s.stats}>
        <div className={s.stat}><b>{st.held}/{st.of}</b><span>weeks met, of the last {st.of}</span></div>
        <div className={s.stat}><b>{st.avgMins == null ? '–' : `${st.avgMins} min`}</b><span>average length</span></div>
        <div className={s.stat}><b>{st.decisions == null ? '–' : `${Math.round(st.decisions * 100)}%`}</b><span>ended with a decision</span></div>
      </div>
      {list === null ? <span className="cv-small cv-muted">Loading the record…</span>
        : !list.length ? <span className="cv-small cv-muted">No meetings saved for {CV_ROOM.short || CV_ROOM.name} yet. Each one you finish is kept here with its decision, notes and follow-ups.</span>
          : (
            <div className={s.hist}>
              {shown.map((m) => {
                const k = m.decision ? KIND[m.decision.kind] || KIND.other : null;
                const isOpen = open === m.id;
                return (
                  <div key={m.id}>
                    <button type="button" className={s.histBtn} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : m.id)}>
                      <span className={s.histWhen}><b>{shortDate(m.at)}</b><span>{[m.mins != null && `${m.mins} min`, m.by && `saved by ${m.by}`, m.decision?.title].filter(Boolean).join(' · ') || 'Logged'}</span></span>
                      {k ? <Pill tone={k.tone} icon={k.icon}>{k.label}</Pill> : <span />}
                      <Icon name="ChevronDown" size={16} className={s.chev} />
                    </button>
                    {isOpen && (
                      <div className={s.histBody}>
                        <MeetingDetail rec={m} compact />
                        {(m.followups || []).length > 0 && <span className="cv-xs cv-faint">{m.followups.filter((f) => done[f.id]).length} of {m.followups.length} follow-ups done</span>}
                        <div className="cv-row" style={{ gap: 6 }}><MeetingSend rec={m} label="Email it" />{m.decision?.id && <FindingLink id={m.decision.id} />}</div>
                      </div>
                    )}
                  </div>
                );
              })}
              {list.length > 5 && <button className="cv-link" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${list.length}`}</button>}
            </div>
          )}
      {sample && list?.length > 0 && (
        <div className="cv-row" style={{ gap: 6 }}>
          <Button size="sm" variant="ghost" icon="Undo2" onClick={() => { onClear(); setDone({}); }}>Clear the sample record</Button>
        </div>
      )}
    </section>
  );
}
function FindingLink({ id }) {
  const cv = useCv();
  return <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('finding', { id })}>The finding</Button>;
}

function CvMeeting() {
  const cv = useCv();
  const eng = useEngine();
  const sample = !(eng.mode === 'server' && eng.org && !eng.org.sample);
  const agenda = agendaFor(CV_D, cvFill);
  const mins = agendaMinutes(agenda);
  const [last, setLast] = useSaved('meeting', null);
  const [dismissed, setFindings] = useSaved('findings', {});
  const [done, setDoneSaved] = useSaved('meeting.followups', {});
  const [schedule, setSchedule] = useSaved('meeting.schedule', DEFAULT_SCHEDULE);
  const [planSaved] = useSaved('plan', { hours: CV_D.room.managerHours });
  const hist = useHistory(eng, last);
  const [open, setOpen] = React.useState(null);
  const [finished, setFinished] = React.useState(null);
  const [discard, setDiscard] = React.useState(false);

  /* The meeting in progress, kept in this browser so a refresh doesn't lose it. */
  const dk = DRAFT(eng);
  const [draft, setDraftState] = React.useState(null);
  React.useEffect(() => { if (eng.mode !== 'pending') setDraftState(store.get(dk)); setFinished(null); }, [dk, eng.mode]);
  const setDraft = (next) => setDraftState((cur) => { const v = typeof next === 'function' ? next(cur) : next; store.set(dk, v); return v; });
  const [, tick] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => { if (!draft) return undefined; const t = setInterval(tick, 1000); return () => clearInterval(t); }, [!!draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = new Date();
  const nowIso = now.toISOString();
  const i = draft ? Math.min(draft.i, agenda.length - 1) : -1;
  const running = !!draft;

  const dItem = agenda.find((a) => a.decision);
  const cand = dItem?.cand ? CV_D.candidates.find((c) => c.id === dItem.cand.id) : null;
  const kindOf = (choice) => (dItem && choice ? choiceKind(choice, dItem.decision.indexOf(choice)) : null);

  /* The plan as it will stand: the saved manager hours, without findings held or
   * dismissed, including the one this meeting is holding or dismissing. */
  const off = { ...dismissed };
  const pending = kindOf(draft?.choice);
  if (cand && (pending === 'hold' || pending === 'dismiss')) off[cand.id] = decisionUntil(pending, now);
  const cands = cvPlanCandidates().filter((c) => !(off[c.id] && off[c.id] > nowIso));
  const { sorted, chosen } = cvChoosePlan(cands, planSaved.hours);
  const planList = sorted.filter((c) => chosen.has(c.id));
  const hours = String(planSaved.hours).replace(/\.0+$/, '');
  const blocked = cand ? findingBlocked(cand, CV_D.room) : null;
  const heldUntil = cand && dismissed[cand.id] && dismissed[cand.id] > nowIso ? dismissed[cand.id] : null;
  const owners = [...new Set(['Owner', CV_ROOM.gm].filter(Boolean))];

  /* Ticked off on this visit: kept in view, struck through, so a mis-tap can be undone. */
  const [justDone, setJustDone] = React.useState(() => new Set());
  const openList = openFollowups(hist.list || [], Object.fromEntries(Object.entries(done).filter(([id]) => !justDone.has(id))));
  const openCount = openList.filter((f) => !done[f.id]).length;
  const setDone = (next, summary) => setDoneSaved((m) => trimDone(typeof next === 'function' ? next(m) : next), summary);
  const toggle = (f) => { setJustDone((x) => new Set(x).add(f.id)); setDone((m) => { const n = { ...m }; if (n[f.id]) delete n[f.id]; else n[f.id] = new Date().toISOString(); return n; }, `${done[f.id] ? 'Reopened' : 'Done'}: ${f.text}`.slice(0, 200)); };

  const start = () => { setFinished(null); setDraft({ startedAt: nowIso, itemAt: nowIso, i: 0, notes: {}, choice: null, followups: [] }); };
  const go = (n) => setDraft((d) => ({ ...d, i: n, itemAt: new Date().toISOString() }));
  const effect = (choice) => {
    const kind = kindOf(choice);
    if (!cand) return null;
    if (kind === 'hold') return `Takes it off the plan for ${HOLD_DAYS} days. It comes back on ${dayDate(decisionUntil('hold', now))}.`;
    if (kind === 'dismiss') return `Takes it off the plan for ${DISMISS_DAYS} days, the same as "Not for us" on the finding.`;
    if (kind === 'approve') return `${blocked ? `${blocked} ` : ''}Adds a follow-up to ${findingTest(cand) ? 'start its test from the finding' : 'make the change'}. Nothing is counted until a test verifies it.`;
    return null;
  };

  const finish = () => {
    const at = new Date();
    const kind = kindOf(draft.choice);
    let followups = draft.followups || [];
    if (kind === 'approve' && cand && followups.length < MEETING_LIMITS.followups) {
      followups = [...followups, { id: followupId(), text: `${findingTest(cand) ? 'Start the test' : 'Make the change'}: ${cand.title || cand.id}`.slice(0, MEETING_LIMITS.followupText), owner: 'Owner' }];
    }
    const rec = meetingRecord({ ...draft, followups, plan: planList.map((c) => c.title || c.id) }, agenda, at);
    setLast(rec, `Weekly meeting finished: ${rec.mins} min${rec.decision ? `, ${rec.decision.choice}` : ''}`.slice(0, 400));
    const until = decisionUntil(kind, at);
    if (until && cand) setFindings((m) => ({ ...m, [cand.id]: until }), `${cand.title || cand.id}: ${draft.choice} (weekly meeting)`.slice(0, 400));
    hist.add(rec);
    setFinished(rec);
    setDraft(null);
    setOpen(null);
    if (eng.mode === 'server') setTimeout(() => void hist.reload(), 1500);
    cv.toast(eng.mode === 'server' ? 'Meeting saved to the room’s record.' : 'Meeting saved in this browser.');
  };

  const totalSecs = running ? (now - new Date(draft.startedAt)) / 1000 : 0;
  const itemSecs = running ? (now - new Date(draft.itemAt)) / 1000 : 0;
  const fk = finished?.decision ? KIND[finished.decision.kind] || KIND.other : null;

  return (
    <div className="cv-page wide">
      <PageHead over={`${slotLabel(schedule)} · ${CV_ROOM.name} · Owner${CV_ROOM.gm ? ` + ${CV_ROOM.gm}` : ' + GM'} · ${mins} minutes`} q="The weekly meeting"
        sub="A fixed agenda filled in from this room's data. You leave with one decision made, the week's plan committed, and follow-ups with a name on each."
        right={running ? (
          <div className="cv-row" style={{ gap: 12 }}>
            <div className={s.clock}><span className={s.total}>{clock(totalSecs)}</span><span className="cv-xs cv-faint">of {mins}:00</span></div>
            {discard ? (
              <span className="cv-row" style={{ gap: 6 }}><span className="cv-small cv-muted">Discard this meeting?</span><Button size="sm" variant="destructive" onClick={() => { setDraft(null); setDiscard(false); }}>Discard</Button><Button size="sm" variant="ghost" onClick={() => setDiscard(false)}>Keep going</Button></span>
            ) : <Button size="sm" variant="ghost" onClick={() => setDiscard(true)}>Discard</Button>}
          </div>
        ) : finished ? <Pill tone="good" icon="CircleCheck">Saved · {finished.mins} min</Pill>
          : <Button icon="Play" onClick={start}>Start the meeting</Button>} />

      <div className={s.layout}>
        <div className={s.main}>
          {finished && (
            <section className="cv-card">
              <div className="cv-card-head">
                <span className="cv-h4">Saved · {shortDate(finished.at)}, {finished.mins} min</span>
                {fk && <Pill tone={fk.tone} icon={fk.icon}>{fk.label}</Pill>}
              </div>
              <MeetingDetail rec={finished} />
              <span className="cv-small cv-muted">{sample ? 'This is the sample, so it stays in your copy of it.' : 'It’s on the room’s record below. Send it to whoever wasn’t in the room.'}</span>
              <div className="cv-row" style={{ gap: 6 }}>
                <MeetingSend rec={finished} />
                <Button size="sm" variant="ghost" onClick={() => setFinished(null)}>Close</Button>
              </div>
            </section>
          )}

          <section className="cv-card flush" aria-label="Agenda">
            {running && (
              <div className={s.progress} aria-hidden="true">
                {agenda.map((a, n) => <span key={a.key} className={`${s.seg} ${n < i ? s.done : n === i ? s.now : ''}`} style={{ flex: a.mins || 1 }} />)}
              </div>
            )}
            {agenda.map((a, n) => {
              const state = !running ? (finished ? 'done' : 'wait') : n < i ? 'done' : n === i ? 'now' : 'wait';
              const claim = itemClaim(a, a.cand);
              const left = a.mins * 60 - itemSecs;
              const note = draft?.notes?.[a.key] || '';
              const plan = isPlanItem(a);
              const savedItem = finished?.items?.[n];
              return (
                <div key={a.key} className={`${s.row} ${state === 'now' ? s.now : ''} ${state === 'done' ? s.done : ''}`} aria-current={state === 'now' ? 'step' : undefined}>
                  <span className={`cv-q-ico ${state === 'done' ? 'good' : state === 'now' ? 'accent' : ''}`}><Icon name={state === 'done' ? 'Check' : a.icon} size={18} /></span>
                  <div className="cv-col" style={{ gap: 6, minWidth: 0 }}>
                    <div className={s.head}>
                      <span className={s.title}>{a.k}</span>
                      <span className="cv-xs cv-faint cv-num">{a.mins} min</span>
                      {claim && <Claim k={claim} />}
                      {a.decision && heldUntil && state !== 'done' && <Pill tone="warn" icon="Hourglass">On hold until {dayDate(heldUntil)}</Pill>}
                    </div>
                    <span className={s.body}>{plan ? `${planList.length} ${planList.length === 1 ? 'action fits' : 'actions fit'} ${hours} manager-hours this week.` : a.body}</span>

                    {plan && (state === 'now' || (!running && !finished)) && planList.length > 0 && (
                      <div className={s.plan}>
                        {planList.map((c) => (
                          <div key={c.id} className={s.planRow}>
                            <span>{c.title || c.id}</span>
                            <span className={s.planVal}>{cvMoney(Math.round(c.value))}/wk<Claim k={c.claim} /></span>
                          </div>
                        ))}
                      </div>
                    )}

                    {state === 'done' && running && (draft.notes?.[a.key] || (a.decision && draft.choice)) && (
                      <div className={s.recorded}>
                        {a.decision && draft.choice && <span><Icon name="Gavel" size={13} />{draft.choice}</span>}
                        {draft.notes?.[a.key] && <span><Icon name="PencilLine" size={13} />{draft.notes[a.key]}</span>}
                      </div>
                    )}
                    {finished && savedItem && (savedItem.note || savedItem.decision) && (
                      <div className={s.recorded}>
                        {savedItem.decision && <span><Icon name="Gavel" size={13} />{savedItem.decision}</span>}
                        {savedItem.note && <span><Icon name="PencilLine" size={13} />{savedItem.note}</span>}
                      </div>
                    )}

                    {state === 'now' && (
                      <div className={s.work}>
                        {a.decision && (
                          <>
                            <div className={s.choices} role="radiogroup" aria-label="Decision">
                              {a.decision.map((d) => (
                                <Button key={d} size="sm" role="radio" aria-checked={draft.choice === d} variant={draft.choice === d ? 'primary' : 'secondary'} onClick={() => setDraft((x) => ({ ...x, choice: x.choice === d ? null : d }))}>{d}</Button>
                              ))}
                            </div>
                            {draft.choice ? (effect(draft.choice) && <span className={s.hint}><Icon name="Info" size={13} />{effect(draft.choice)}</span>)
                              : <span className={s.hint}><Icon name="Info" size={13} />Pick one, or go on and it&apos;s logged as deferred.</span>}
                            {blocked && !draft.choice && <Callout tone="warn" icon="TriangleAlert">{blocked}</Callout>}
                          </>
                        )}
                        <textarea className={`input ${s.note}`} rows={2} value={note} maxLength={MEETING_LIMITS.note} placeholder="Notes for the record (optional)" aria-label={`Notes on ${a.k}`}
                          onChange={(e) => { const v = e.target.value; setDraft((x) => ({ ...x, notes: { ...x.notes, [a.key]: v } })); }} />
                        <div className={s.stepper}>
                          <span className={`${s.left} ${left < 0 ? s.over : ''}`}>{left < 0 ? `${clock(left)} over` : `${clock(left)} left`}</span>
                          <div className="cv-row" style={{ gap: 6 }}>
                            {n > 0 && <Button size="sm" variant="ghost" icon="ArrowLeft" onClick={() => go(n - 1)}>Back</Button>}
                            {n === agenda.length - 1
                              ? <Button size="sm" icon="CircleCheck" onClick={finish}>Finish and save</Button>
                              : <Button size="sm" iconRight="ArrowRight" onClick={() => go(n + 1)}>Next</Button>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className={s.tail}>
                    {a.go && <Button size="sm" variant="ghost" onClick={() => cv.go(a.go)}>Open</Button>}
                    {a.decision && a.cand && <Button size="sm" variant="ghost" onClick={() => cv.go('finding', { id: a.cand.id })}>Finding</Button>}
                  </div>
                </div>
              );
            })}
          </section>
        </div>

        <aside className={s.side}>
          <section className="cv-card">
            <div className="cv-card-head"><span className="cv-h4">Follow-ups</span>{openCount > 0 ? <Pill tone="warn">{openCount} open</Pill> : openList.length > 0 ? <Pill tone="good" icon="Check">All done</Pill> : null}</div>
            {openList.length > 0 ? (
              <div className={s.fups}>
                {openList.map((f) => (
                  <div key={f.id} className={`${s.fup} ${done[f.id] ? s.closed : ''}`}>
                    <Tick on={!!done[f.id]} label={`Done: ${f.text}`} onClick={() => toggle(f)} />
                    <div className="cv-col" style={{ gap: 1, minWidth: 0 }}><span className={s.fupText}>{f.text}</span><span className={s.fupMeta}>{[f.owner, `from ${dayDate(f.from)}`].filter(Boolean).join(' · ')}</span></div>
                    <span />
                  </div>
                ))}
              </div>
            ) : <span className="cv-small cv-muted">{hist.list === null ? 'Loading…' : 'Nothing open. Follow-ups added in a meeting stay here until someone ticks them off.'}</span>}
            {running && (
              <>
                <div className="cv-sep" />
                <span className="cv-small" style={{ fontWeight: 600 }}>From this meeting</span>
                {(draft.followups || []).length > 0 && (
                  <div className={s.fups}>
                    {draft.followups.map((f) => (
                      <div key={f.id} className={s.fup}>
                        <Icon name="ListChecks" size={16} />
                        <div className="cv-col" style={{ gap: 1, minWidth: 0 }}><span className={s.fupText}>{f.text}</span>{f.owner && <span className={s.fupMeta}>{f.owner}</span>}</div>
                        <button type="button" className={s.iconBtn} aria-label={`Remove: ${f.text}`} onClick={() => setDraft((x) => ({ ...x, followups: x.followups.filter((y) => y.id !== f.id) }))}><Icon name="Trash2" size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
                {(draft.followups || []).length < MEETING_LIMITS.followups - 1
                  ? <AddFollowup owners={owners} onAdd={(f) => setDraft((x) => ({ ...x, followups: [...(x.followups || []), { id: followupId(), ...f }] }))} />
                  : <span className="cv-xs cv-faint">That&apos;s the most one meeting can carry.</span>}
              </>
            )}
          </section>

          <RecordCard list={hist.list} done={done} setDone={setDone} open={open} setOpen={setOpen} sample={sample} now={now}
            onClear={() => { setLast(null, 'Sample meeting record cleared'); hist.clear(); setFinished(null); }} />

          <SlotCard schedule={schedule} setSchedule={setSchedule} agendaMins={mins} now={now} />
        </aside>
      </div>
    </div>
  );
}

export { CvMeeting };
