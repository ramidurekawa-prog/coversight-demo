'use client';

import * as React from 'react';
import { Icon, Button } from '../../kit';
import { useCv, CV_D, CV_ROOM, Pill, PageHead, Claim, Callout } from '../core';
import { engine, useEngine, useSaved } from '../../engine';
import {
  actionProgress, activeActions, buildAgenda, DAYS, DEFAULT_SCHEDULE, DISMISS_DAYS, draftAction, finalizeMeeting, finalizeProblems, HOLD_DAYS,
  isoDay, MEETING_LIMITS as ML, meetingStats, nextMeeting, OUTCOMES, readiness, SEGMENTS, setOutcome, slotLabel, summaryEmail, summaryText,
} from '../../../lib/data/page/meeting';
import { localApi, serverApi } from './meeting.api';
import s from './meeting.module.css';

/* ================================================================ Weekly meeting
 * Turns a short management meeting into accountable decisions. The agenda is
 * built from this room's data and last meeting's unfinished actions; running
 * it saves progress on the server as it goes (one editor at a time); finishing
 * turns each decision into an action with an owner, a due date and a
 * definition of done, which the page then follows through on. */

const clock = (secs) => { const a = Math.max(0, Math.round(Math.abs(secs))); return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`; };
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const dayLabel = (ymd) => (ymd ? new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '');
const minsLabel = (m) => (Number.isInteger(m) ? `${m} min` : `${m.toFixed(1).replace(/\.0$/, '')} min`);
/** The words on each choice button. */
const OPTION_LABEL = { accepted: 'Accept', changed: 'Accept with changes', evidence: 'Need more evidence', deferred: 'Defer', rejected: 'Not for us', discussed: 'Mark discussed', done: 'It’s done', kept: 'Still on it', reassigned: 'Change owner or date', cancelled: 'Cancel it', continue: 'Continue', adjust: 'Adjust', stop: 'Stop', investigate: 'Investigate' };
const NEEDS_ACTION = new Set(['accepted', 'changed', 'evidence', 'adjust', 'stop', 'investigate', 'reassigned']);
const PROGRESS_TONE = { done: 'good', verified: 'good', monitoring: 'info', overdue: 'warn', deferred: 'neutral', cancelled: 'neutral', assigned: 'neutral' };

function useNow(on) {
  const [, tick] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => { if (!on) return undefined; const t = setInterval(tick, 1000); return () => clearInterval(t); }, [on]);
  return new Date();
}

function Figures({ figures }) {
  if (!figures?.length) return null;
  return (
    <div className={s.figs}>
      {figures.map((f) => (
        <div key={f.label} className={s.fig}>
          <span className={s.figLabel}>{f.label}</span>
          <span className={s.figVal}>{f.value}</span>
          {f.claim && <Claim k={f.claim} />}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ the summary */
function SummaryActions({ rec }) {
  const cv = useCv();
  const eng = useEngine();
  const [draft, setDraft] = React.useState(null);
  const name = rec.roomName || CV_ROOM.name;
  const m = summaryEmail(rec, name);
  const copy = async () => {
    try { await navigator.clipboard.writeText(summaryText(rec, name)); cv.toast('Summary copied.'); } catch { cv.toast('Copying is blocked in this browser. Use Download instead.'); }
  };
  const download = () => {
    const blob = new Blob([summaryText(rec, name)], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `weekly-meeting-${isoDay(rec.at)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const saveDraft = () => {
    engine.draftEmail({ kind: 'gm-note', subject: m.subject, body: m.body }).then(() => setDraft('saved')).catch(() => setDraft('failed'));
  };
  return (
    <div className="cv-col" style={{ gap: 6 }}>
      <div className="cv-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <a className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }} href={`mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`}><Icon name="Mail" size={14} /> Open in email</a>
        {eng.mode === 'server' && <Button size="sm" variant="ghost" icon="FilePen" onClick={saveDraft} disabled={draft === 'saved'}>{draft === 'saved' ? 'Draft saved' : 'Save as a draft'}</Button>}
        <Button size="sm" variant="ghost" icon="Copy" onClick={copy}>Copy</Button>
        <Button size="sm" variant="ghost" icon="Download" onClick={download}>Download</Button>
      </div>
      <span className="cv-xs cv-faint" role="status">{draft === 'saved' ? 'Saved to the outbox as a draft. Nothing has been sent.' : draft === 'failed' ? 'The draft wasn’t saved. Try again, or use Copy.' : 'Opening it in your email app sends nothing until you press send there.'}</span>
    </div>
  );
}

function MeetingDetail({ rec }) {
  const cv = useCv();
  const dec = (rec.decisions || []).filter((x) => x.outcome !== 'discussed' && x.outcome !== 'kept');
  return (
    <div className={s.detail}>
      {rec.summary && <p className="cv-small" style={{ margin: 0, fontWeight: 600 }}>{rec.summary}</p>}
      {rec.observations?.length > 0 && <div className="cv-col" style={{ gap: 4 }}><h5>Performance</h5>{rec.observations.map((o) => <span key={o} className="cv-small cv-muted">{o}</span>)}</div>}
      {rec.actions?.length > 0 && (
        <div className="cv-col" style={{ gap: 6 }}>
          <h5>Actions</h5>
          <ul className={s.plainList}>{rec.actions.map((a) => (
            <li key={a.title}><Icon name="ListChecks" size={14} /><span><b>{a.title}</b><span className="cv-faint"> · {a.owner || 'No owner'} · due {dayLabel(a.due)}</span>{a.findingId && <> · <button className="cv-link" onClick={() => cv.go('finding', { id: a.findingId })}>Evidence</button></>}</span></li>
          ))}</ul>
        </div>
      )}
      {dec.length > 0 && (
        <div className="cv-col" style={{ gap: 6 }}>
          <h5>Decisions</h5>
          <ul className={s.plainList}>{dec.map((x) => <li key={x.item}><Icon name="Gavel" size={14} /><span>{x.title}: <b>{OUTCOMES[x.outcome] || x.outcome}</b>{x.reason ? <span className="cv-faint"> ({x.reason})</span> : null}</span></li>)}</ul>
        </div>
      )}
      {rec.deferred?.length > 0 && <div className="cv-col" style={{ gap: 6 }}><h5>Deferred</h5><ul className={s.plainList}>{rec.deferred.map((x) => <li key={x.title}><Icon name="Hourglass" size={14} /><span>{x.title}<span className="cv-faint"> · {x.reason}</span></span></li>)}</ul></div>}
      {rec.evidence?.length > 0 && <div className="cv-col" style={{ gap: 6 }}><h5>Waiting on evidence</h5><ul className={s.plainList}>{rec.evidence.map((x) => <li key={x.title}><Icon name="Search" size={14} />{x.title}</li>)}</ul></div>}
      {rec.notes?.length > 0 && <div className="cv-col" style={{ gap: 6 }}><h5>Notes</h5><ul className={s.plainList}>{rec.notes.map((n) => <li key={n.item}><Icon name="PencilLine" size={14} /><span><b>{n.title}.</b> {n.note}</span></li>)}</ul></div>}
      {!rec.decisions && rec.log?.length > 0 && <ul className={s.plainList}>{rec.log.map((l) => <li key={l}><Icon name="Check" size={14} />{l}</li>)}</ul>}
      {rec.nextCheck && <span className="cv-xs cv-faint">Next check {dayLabel(rec.nextCheck)}, when the first action is due.{rec.dataThrough ? ` Data through ${dayLabel(rec.dataThrough)}.` : ''}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ follow-through */
function ActionRow({ a, onPatch, busy }) {
  const cv = useCv();
  const eng = useEngine();
  const [edit, setEdit] = React.useState(null);
  const p = actionProgress(a, { windows: eng.windows, candidates: CV_D.candidates });
  const live = a.status === 'open';
  const label = { assigned: `Due ${dayLabel(a.due)}`, overdue: `Overdue since ${dayLabel(a.due)}`, deferred: `Back on ${dayLabel(a.due)}` }[p.state] || p.label;
  return (
    <li className={`${s.act} ${a.status === 'done' || a.status === 'cancelled' ? s.closed : ''}`}>
      <span className={`${s.prio} ${s[a.priority] || ''}`} title={`${a.priority} priority`} aria-hidden="true" />
      <div className="cv-col" style={{ gap: 3, minWidth: 0 }}>
        <span className={s.actTitle}>{a.title}</span>
        <span className={s.actMeta}>{[a.owner || (a.status === 'deferred' ? null : 'No owner'), a.status === 'deferred' && a.reason ? `Deferred: ${a.reason}` : null].filter(Boolean).join(' · ')}</span>
        {a.doneWhen && live && <span className={s.actMeta}>Done when: {a.doneWhen}</span>}
        {edit && (
          <form className={s.inlineForm} onSubmit={(e) => { e.preventDefault(); onPatch(a.id, { ...(edit.owner.trim() && edit.owner !== a.owner ? { owner: edit.owner.trim() } : {}), ...(edit.due && edit.due !== a.due ? { due: edit.due } : {}) }).then(() => setEdit(null)); }}>
            <input className="input" value={edit.owner} onChange={(e) => setEdit({ ...edit, owner: e.target.value })} maxLength={ML.owner} aria-label="Owner" list="cv-meeting-owners" />
            <input className="input" type="date" value={edit.due} onChange={(e) => setEdit({ ...edit, due: e.target.value })} aria-label="Due date" />
            <Button size="sm" type="submit" disabled={busy}>Save</Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </form>
        )}
      </div>
      <div className={s.actSide}>
        <Pill tone={PROGRESS_TONE[p.state]}>{label}</Pill>
        {live && !edit && (
          <div className="cv-row" style={{ gap: 2 }}>
            <Button size="sm" variant="ghost" icon="Check" disabled={busy} onClick={() => onPatch(a.id, { status: 'done' })} aria-label={`Mark done: ${a.title}`}>Done</Button>
            <Button size="sm" variant="ghost" icon="PencilLine" disabled={busy} onClick={() => setEdit({ owner: a.owner || '', due: a.due })} aria-label={`Change owner or date: ${a.title}`} />
            <Button size="sm" variant="ghost" icon="Trash2" disabled={busy} onClick={() => onPatch(a.id, { status: 'cancelled' })} aria-label={`Cancel: ${a.title}`} />
          </div>
        )}
        {(a.status === 'done' || a.status === 'cancelled') && <Button size="sm" variant="ghost" icon="Undo2" disabled={busy} onClick={() => onPatch(a.id, { status: 'open' })}>Reopen</Button>}
        {a.findingId && <button className="cv-link" onClick={() => cv.go('finding', { id: a.findingId })}>Evidence</button>}
      </div>
    </li>
  );
}

function FollowThrough({ actions, onPatch, busy }) {
  const now = new Date();
  const live = activeActions(actions, CV_D.id, now);
  const recent = (actions || []).filter((a) => a.roomId === CV_D.id && (a.status === 'done' || a.status === 'cancelled')).slice(-5).reverse();
  const open = live.filter((a) => a.status === 'open');
  const overdue = open.filter((a) => String(a.due) < isoDay(now)).length;
  return (
    <section className="cv-card" aria-labelledby="cv-meeting-ft">
      <div className="cv-card-head">
        <span className="cv-h4" id="cv-meeting-ft">Follow-through</span>
        <span className="cv-row" style={{ gap: 6 }}>{overdue > 0 && <Pill tone="warn" icon="Clock">{overdue} overdue</Pill>}<span className="cv-xs cv-faint">{open.length} open</span></span>
      </div>
      {live.length || recent.length ? (
        <ul className={s.acts}>
          {[...live, ...recent].map((a) => <ActionRow key={a.id} a={a} onPatch={onPatch} busy={busy} />)}
        </ul>
      ) : <span className="cv-small cv-muted">Nothing assigned yet. Each decision you accept in a meeting lands here with its owner and due date, and stays until it&apos;s done.</span>}
      <span className="cv-xs cv-faint">Agreeing in a meeting isn&apos;t proof a change happened. A test on the finding shows it; otherwise the owner confirms it against its definition of done.</span>
    </section>
  );
}

function History({ history }) {
  const [open, setOpen] = React.useState(null);
  const st = meetingStats(history || []);
  return (
    <section className="cv-card" aria-labelledby="cv-meeting-hist">
      <div className="cv-card-head"><span className="cv-h4" id="cv-meeting-hist">Past meetings</span>{history?.length > 0 && <span className="cv-xs cv-faint">{st.held} of the last 8 weeks{st.avgMins != null ? ` · ${st.avgMins} min on average` : ''}</span>}</div>
      {!history?.length ? <span className="cv-small cv-muted">None yet for {CV_ROOM.short || CV_ROOM.name}. Each finished meeting is kept here with its decisions and actions.</span> : (
        <div className={s.hist}>
          {history.slice(0, 8).map((m) => (
            <div key={m.id}>
              <button type="button" className={s.histBtn} aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
                <span className={s.histWhen}><b>{shortDate(m.at)}</b><span>{[m.mins != null && `${m.mins} min`, m.actions && `${m.actions.length} action${m.actions.length === 1 ? '' : 's'}`, m.by && `run by ${m.by}`].filter(Boolean).join(' · ') || 'Logged'}</span></span>
                <Icon name="ChevronDown" size={16} className={s.chev} />
              </button>
              {open === m.id && <div className={s.histBody}><MeetingDetail rec={m} /><SummaryActions rec={m} /></div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ before the meeting */
function SlotEditor({ schedule, onSave, onCancel }) {
  const [edit, setEdit] = React.useState({ ...DEFAULT_SCHEDULE, ...schedule });
  return (
    <form className={`cv-card ${s.panel}`} onSubmit={(e) => { e.preventDefault(); onSave(edit); }}>
      <span className="cv-h4">Reschedule the weekly slot</span>
      <div className={s.slotForm}>
        <select className="input" value={edit.day} onChange={(e) => setEdit({ ...edit, day: +e.target.value })} aria-label="Day">{DAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}</select>
        <input className="input" type="time" step="900" value={edit.time} onChange={(e) => setEdit({ ...edit, time: e.target.value })} aria-label="Time" required />
        <select className="input" value={edit.mins ?? 15} onChange={(e) => setEdit({ ...edit, mins: +e.target.value })} aria-label="Planned length">{[10, 15, 20, 30, 45].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select>
      </div>
      <span className="cv-xs cv-faint">Everyone who can see this room gets a reminder on the day.</span>
      <div className="cv-row" style={{ gap: 6 }}><Button size="sm" type="submit" disabled={!/^\d\d:\d\d$/.test(edit.time)}>Save</Button><Button size="sm" variant="ghost" type="button" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}

function AttendeesEditor({ attendees, onSave, onCancel }) {
  const [list, setList] = React.useState(attendees);
  const [name, setName] = React.useState('');
  const add = () => { const n = name.trim(); if (n && !list.includes(n) && list.length < ML.attendees) setList([...list, n.slice(0, ML.owner)]); setName(''); };
  return (
    <div className={`cv-card ${s.panel}`}>
      <span className="cv-h4">Who attends</span>
      {list.length ? <ul className={s.chips}>{list.map((n) => <li key={n}>{n}<button type="button" className={s.iconBtn} aria-label={`Remove ${n}`} onClick={() => setList(list.filter((x) => x !== n))}><Icon name="Trash2" size={12} /></button></li>)}</ul> : <span className="cv-small cv-muted">Nobody named yet. Owners in the meeting can be picked from this list.</span>}
      <form className={s.addRow} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={ML.owner} placeholder="Name" aria-label="Attendee name" list="cv-meeting-owners" />
        <Button size="sm" variant="secondary" icon="Plus" type="submit" disabled={!name.trim()}>Add</Button>
      </form>
      <div className="cv-row" style={{ gap: 6 }}><Button size="sm" onClick={() => onSave(list)}>Save</Button><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}

function AgendaPreview({ agenda }) {
  return (
    <ol className={s.preview}>
      {agenda.items.map((x) => (
        <li key={x.id}>
          <span className={s.segTag} aria-hidden="true">{x.seg}</span>
          <span className="cv-col" style={{ gap: 2, minWidth: 0 }}><b className="cv-small">{x.title}</b><span className="cv-xs cv-faint">{SEGMENTS[x.seg].label} · {minsLabel(x.mins)}</span></span>
        </li>
      ))}
    </ol>
  );
}

function Ready({ agenda, actions, history, schedule, setSchedule, attendees, owners, onStart, starting, finished, onCloseFinished, onPatch, busy, sample, onResetSample }) {
  const [panel, setPanel] = React.useState(null);
  const now = new Date();
  const r = readiness(agenda, actions, CV_D.id, now);
  const next = nextMeeting(schedule, now);
  const today = next.toDateString() === now.toDateString();
  const last = history?.[0];
  const lastActs = last?.id ? (actions || []).filter((a) => a.meetingId === last.id && a.status !== 'deferred') : [];
  const lastDone = lastActs.filter((a) => a.status === 'done').length;
  const toggle = (p) => setPanel(panel === p ? null : p);
  const tiles = [
    ['Decisions to discuss', r.decisions, r.decisions ? 'Urgent first, then value per manager-hour' : 'Nothing needs a decision this week'],
    ['Unfinished from earlier', r.unfinished, r.overdue ? `${r.overdue} overdue` : r.unfinished ? 'None overdue' : 'All caught up'],
    ['Operating risks', r.risks, r.risks ? 'Only what the data supports' : 'Nothing crossed a limit'],
    ['Expected length', minsLabel(r.mins), `Planned for ${schedule.mins ?? 15} min`],
  ];
  return (
    <>
      <PageHead over={`${CV_ROOM.name} · ${today ? 'Today' : shortDate(next.toISOString())} · ${slotLabel(schedule)}`} q="Ready for this week’s meeting"
        sub="Coversight has prepared the most important decisions from this week’s operating data."
        right={<Button icon="Play" onClick={onStart} disabled={starting || !agenda.items.length}>{starting ? 'Starting…' : 'Start meeting'}</Button>} />

      <div className={s.context}>
        <span><Icon name="Users" size={14} />{attendees.length ? attendees.join(', ') : `Owner + ${CV_ROOM.gm || 'GM'}`}</span>
        <span><Icon name="Clock" size={14} />{minsLabel(r.mins)} planned</span>
        <span><Icon name="Database" size={14} />{agenda.dataThrough ? `Data through ${dayLabel(agenda.dataThrough)}` : 'No sales data connected'}</span>
        <span><Icon name="ListChecks" size={14} />{last ? (lastActs.length ? `Last meeting: ${lastDone} of ${lastActs.length} actions done` : `Last meeting ${shortDate(last.at)}`) : 'First meeting here'}</span>
        {sample && <Pill icon="FlaskConical">Sample data</Pill>}
      </div>

      {finished && (
        <section className="cv-card" aria-live="polite">
          <div className="cv-card-head"><span className="cv-h4">Meeting saved · {shortDate(finished.at)}, {finished.mins} min</span><Button size="sm" variant="ghost" onClick={onCloseFinished}>Close</Button></div>
          {finished.mins > (finished.plannedMins || 15) && <span className="cv-xs cv-faint">Ran {finished.mins - Math.round(finished.plannedMins || 15)} min over the plan.</span>}
          <MeetingDetail rec={finished} />
          <SummaryActions rec={finished} />
        </section>
      )}

      <div className={s.tiles}>
        {tiles.map(([k, v, sub]) => <div key={k} className={s.tile}><span className={s.tileLabel}>{k}</span><span className={s.tileVal}>{v}</span><span className={s.tileSub}>{sub}</span></div>)}
      </div>

      <div className={s.secondary}>
        <Button size="sm" variant="secondary" icon="LayoutList" aria-expanded={panel === 'agenda'} onClick={() => toggle('agenda')}>Preview agenda</Button>
        <Button size="sm" variant="secondary" icon="Users" aria-expanded={panel === 'people'} onClick={() => toggle('people')}>Change attendees</Button>
        <Button size="sm" variant="secondary" icon="Clock" aria-expanded={panel === 'last'} onClick={() => toggle('last')} disabled={!last}>Review last meeting</Button>
        <Button size="sm" variant="secondary" icon="CalendarClock" aria-expanded={panel === 'slot'} onClick={() => toggle('slot')}>Reschedule</Button>
      </div>
      {panel === 'agenda' && (
        <section className="cv-card">
          <span className="cv-h4">This week&apos;s agenda</span>
          <AgendaPreview agenda={agenda} />
          {(agenda.more.issues > 0 || agenda.more.follow > 0) && <span className="cv-xs cv-faint">{[agenda.more.issues && `${agenda.more.issues} smaller issue${agenda.more.issues === 1 ? '' : 's'} left for Today`, agenda.more.follow && `${agenda.more.follow} more open action${agenda.more.follow === 1 ? '' : 's'} in Follow-through`].filter(Boolean).join('; ')}.</span>}
        </section>
      )}
      {panel === 'people' && <AttendeesEditor attendees={attendees} onCancel={() => setPanel(null)} onSave={(list) => { setSchedule({ ...schedule, attendees: list }, `Weekly meeting attendees: ${list.join(', ') || 'none'}`); setPanel(null); }} />}
      {panel === 'last' && last && <section className="cv-card"><span className="cv-h4">Last meeting · {shortDate(last.at)}</span><MeetingDetail rec={last} /><SummaryActions rec={last} /></section>}
      {panel === 'slot' && <SlotEditor schedule={schedule} onCancel={() => setPanel(null)} onSave={(v) => { setSchedule(v, `Weekly meeting moved to ${slotLabel(v)}`); setPanel(null); }} />}

      <div className={s.cols}>
        <FollowThrough actions={actions} onPatch={onPatch} busy={busy} />
        <History history={history} />
      </div>
      {sample && history?.length > 0 && onResetSample && <div><Button size="sm" variant="ghost" icon="Undo2" onClick={onResetSample}>Clear the sample meeting record</Button></div>}
    </>
  );
}

/* ------------------------------------------------------------------ during the meeting */
function ActionEditor({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset className={s.editor}>
      <legend className="cv-xs cv-faint">The action</legend>
      <label className={s.wide}><span>Action</span><input className="input" value={value.title} onChange={set('title')} maxLength={ML.title} /></label>
      <label><span>Owner</span><input className="input" value={value.owner} onChange={set('owner')} maxLength={ML.owner} list="cv-meeting-owners" required aria-invalid={!value.owner.trim()} /></label>
      <label><span>Due</span><input className="input" type="date" value={value.due} onChange={set('due')} required /></label>
      <label><span>Priority</span><select className="input" value={value.priority} onChange={set('priority')}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
      <label className={s.wide}><span>Done when</span><input className="input" value={value.doneWhen} onChange={set('doneWhen')} maxLength={ML.doneWhen} /></label>
      <span className={`${s.wide} cv-xs cv-faint`}><Icon name="Lock" size={12} /> Approval needed: {value.approval || 'None'}</span>
    </fieldset>
  );
}

function Consequence({ item, o }) {
  const text = {
    rejected: item.findingId ? `Takes it off the plan for ${DISMISS_DAYS} days, the same as “Not for us” on the finding.` : 'Recorded as rejected. Nothing is assigned.',
    deferred: `Comes back in ${HOLD_DAYS} days with the reason you give.`,
    evidence: 'Assigns someone to bring the evidence. The decision comes back next meeting.',
    accepted: item.action?.approval && item.action.approval !== 'None' ? `Assigns it. Needs: ${item.action.approval}.` : 'Assigns it with an owner and a due date.',
    changed: 'Assigns it with your changes.',
    done: 'Closes it as done. If it has a test, the test still decides whether anything is saved.',
    kept: 'Stays open with its current owner and date.',
    reassigned: 'Keeps it open with a new owner or date.',
    cancelled: 'Cancels it. It stays on the record.',
    continue: 'The test keeps running. Nothing books until it closes and verifies.',
    adjust: 'Assigns someone to make the adjustment.',
    stop: 'Assigns someone to stop it. A person stops it on the test itself.',
    investigate: 'Assigns someone to look into it.',
    discussed: 'Recorded as discussed.',
  }[o.status];
  return text ? <span className={s.hint}><Icon name="Info" size={13} />{text}</span> : null;
}

function ConfirmPlan({ preview, problems, items, onGo }) {
  const byId = Object.fromEntries(items.map((x, n) => [x.id, n]));
  const open = preview.upserts.filter((u) => u.status === 'open');
  const undecided = items.filter((x) => x.seg !== 'E' && x.seg !== 'A' && !preview.record.decisions.some((d) => d.item === x.id));
  return (
    <div className="cv-col" style={{ gap: 14 }}>
      <p className={s.para}>{preview.record.summary} Check each one has the right owner and date, then finish. Coversight follows them up: a reminder the day before each is due, and on this page until it&apos;s done.</p>
      {problems.length > 0 && <Callout tone="warn" icon="TriangleAlert">{problems.length === 1 ? 'One thing' : `${problems.length} things`} to fix first: {problems.map((p) => <React.Fragment key={p.id}><button className="cv-link" onClick={() => onGo(byId[p.id])}>{items[byId[p.id]]?.title}</button>: {p.problem} </React.Fragment>)}</Callout>}
      {open.length > 0 ? (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <caption className="sr-only">Actions from this meeting</caption>
            <thead><tr><th scope="col">Action</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">How it&apos;s checked</th></tr></thead>
            <tbody>{open.map((u) => (
              <tr key={u.sourceKey}>
                <td><b>{u.title}</b><span className="cv-xs cv-faint" style={{ display: 'block' }}>Done when: {u.doneWhen}{u.approval && u.approval !== 'None' ? ` · Needs: ${u.approval}` : ''}</span></td>
                <td>{u.owner || <span className={s.missing}>No owner</span>}</td>
                <td className="cv-num">{dayLabel(u.due)}</td>
                <td className="cv-xs">{u.findingId ? 'Its test on the finding, once a person starts it' : 'The owner, against “done when”'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <span className="cv-small cv-muted">No new actions. That&apos;s fine if nothing needed one.</span>}
      {preview.updates.length > 0 && <span className="cv-small">{preview.updates.length} earlier action{preview.updates.length === 1 ? '' : 's'} updated (done, cancelled or reassigned).</span>}
      {preview.record.deferred.length > 0 && <span className="cv-small">Deferred: {preview.record.deferred.map((d) => `${d.title} (${d.reason || 'no reason yet'})`).join('; ')}.</span>}
      {Object.keys(preview.dismiss).length > 0 && <span className="cv-small">Off the plan for {DISMISS_DAYS} days: {Object.keys(preview.dismiss).length} finding{Object.keys(preview.dismiss).length === 1 ? '' : 's'}.</span>}
      {undecided.length > 0 && <span className="cv-xs cv-faint">Not decided: {undecided.map((x) => x.title).join('; ')}. They&apos;ll be recorded as not discussed.</span>}
    </div>
  );
}

function Runner({ session, onFinalized, onDiscarded, owners, api }) {
  const cv = useCv();
  const items = session.agenda.items;
  const [st, setSt] = React.useState(session.state);
  const [save, setSave] = React.useState({ state: 'saved' });
  const [discard, setDiscard] = React.useState(false);
  const [finalizing, setFinalizing] = React.useState(false);
  const now = useNow(true);
  const vRef = React.useRef(session.version);
  const timer = React.useRef(null);
  const pending = React.useRef(null);

  const flush = React.useCallback(async () => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setSave({ state: 'saving' });
    try {
      const r = await api.save(session.id, vRef.current, next);
      vRef.current = r.version;
      setSave({ state: pending.current ? 'saving' : 'saved' });
    } catch (err) {
      setSave({ state: 'error', message: err.message, conflict: err.status === 409 });
    }
  }, [api, session.id]);
  const update = (fn) => setSt((cur) => {
    const next = fn(cur);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
    return next;
  });
  /* Keep the editor's lease while the meeting is open, even when nobody types for a while. */
  React.useEffect(() => {
    const t = setInterval(() => { if (!pending.current) api.save(session.id, vRef.current, undefined).then((r) => { vRef.current = r.version; }).catch(() => {}); }, 60_000);
    return () => clearInterval(t);
  }, [api, session.id]);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const i = Math.min(st.i, items.length - 1);
  const item = items[i];
  const o = st.outcomes[item.id];
  const total = (now - new Date(session.startedAt)) / 1000;
  const planned = items.reduce((t, x) => t + x.mins, 0) * 60;
  const left = item.mins * 60 - (now - new Date(st.itemAt)) / 1000;
  const go = (n) => update((cur) => ({ ...cur, i: n, itemAt: new Date().toISOString() }));
  const choose = (kind) => update((cur) => {
    if (cur.outcomes[item.id]?.status === kind) return setOutcome(cur, item, null);
    const keep = cur.outcomes[item.id];
    const action = NEEDS_ACTION.has(kind) ? (keep?.action || (item.follow ? { owner: '', due: '' } : draftAction(item, { status: kind }, { owner: owners[0] || 'Owner' }))) : undefined;
    return setOutcome(cur, item, { status: kind, ...(action ? { action } : {}), ...(keep?.reason && kind === 'deferred' ? { reason: keep.reason } : {}) });
  });
  const editOutcome = (patch) => update((cur) => ({ ...cur, outcomes: { ...cur.outcomes, [item.id]: { ...cur.outcomes[item.id], ...patch } } }));

  const preview = finalizeMeeting(session.agenda, st, { now, startedAt: session.startedAt });
  const problems = finalizeProblems(session.agenda, st);
  const finalize = async () => {
    clearTimeout(timer.current);
    pending.current = null;
    setFinalizing(true);
    try {
      const r = await api.finalize(session.id, vRef.current, st);
      onFinalized(r);
      cv.toast('Meeting saved. Its actions are on Follow-through.');
    } catch (err) {
      setSave({ state: 'error', message: err.message, conflict: err.status === 409 });
      setFinalizing(false);
    }
  };

  return (
    <>
      <PageHead over={`${CV_ROOM.name} · weekly meeting in progress`} q="The weekly meeting"
        right={(
          <div className="cv-row" style={{ gap: 14 }}>
            <div className={s.clock} aria-label={`Meeting time ${clock(total)} of ${clock(planned)} planned`}>
              <span className={`${s.total} ${total > planned ? s.over : ''}`}>{clock(total)}</span>
              <span className="cv-xs cv-faint">{total > planned ? `${clock(total - planned)} over the plan` : `of ${clock(planned)} planned`}</span>
            </div>
            {discard
              ? <span className="cv-row" style={{ gap: 6 }}><Button size="sm" variant="destructive" onClick={() => api.discard(session.id).then(onDiscarded).catch((e) => setSave({ state: 'error', message: e.message }))}>Discard meeting</Button><Button size="sm" variant="ghost" onClick={() => setDiscard(false)}>Keep it</Button></span>
              : <Button size="sm" variant="ghost" onClick={() => setDiscard(true)}>Discard</Button>}
          </div>
        )} />

      <div className={s.progress} role="list" aria-label="Agenda progress">
        {items.map((x, n) => (
          <span key={x.id} role="listitem" className={`${s.seg} ${n === i ? s.now : st.outcomes[x.id] ? s.done : ''}`} style={{ flex: Math.max(0.5, x.mins) }} aria-label={`${x.title}${st.outcomes[x.id] ? ', decided' : ''}${n === i ? ', current' : ''}`} />
        ))}
      </div>

      <div className={s.runGrid}>
        <section className={`cv-card ${s.current}`} aria-labelledby="cv-meeting-item">
          <div className="cv-card-head">
            <span className="cv-over">{SEGMENTS[item.seg].label} · {i + 1} of {items.length}</span>
            <span className={`${s.left} ${left < 0 ? s.over : ''}`}>{left < 0 ? `${clock(left)} over` : `${clock(left)} left`}</span>
          </div>
          <h3 className={s.itemTitle} id="cv-meeting-item">{item.title}</h3>

          {item.seg === 'E' ? (
            <ConfirmPlan preview={preview} problems={problems} items={items} onGo={go} />
          ) : (
            <>
              <p className={s.para}>{item.body}</p>
              {item.missing && <Callout tone="warn" icon="TriangleAlert">Not enough data to say more. Nothing is estimated to fill the gap.</Callout>}
              <Figures figures={item.figures} />
              {item.risks?.length > 0 && <ul className={s.risks}>{item.risks.map((r) => <li key={r}><Icon name="TriangleAlert" size={13} />{r}</li>)}</ul>}
              <div className={s.recommend}><Icon name="Lightbulb" size={14} /><span>Coversight recommends: <b>{OPTION_LABEL[item.recommend]}</b></span></div>
              <div className={s.choices} role="group" aria-label="Decision">
                {item.options.map((k) => (
                  <Button key={k} size="sm" aria-pressed={o?.status === k} variant={o?.status === k ? 'primary' : 'secondary'} onClick={() => choose(k)}>{OPTION_LABEL[k]}</Button>
                ))}
              </div>
              {o && <Consequence item={item} o={o} />}
              {o?.status === 'deferred' && (
                <label className={s.reason}><span className="cv-xs">Why defer it? It comes back in {HOLD_DAYS} days with this reason.</span>
                  <input className="input" value={o.reason || ''} maxLength={ML.reason} onChange={(e) => editOutcome({ reason: e.target.value })} placeholder="Reason" aria-invalid={!o.reason?.trim()} /></label>
              )}
              {o && NEEDS_ACTION.has(o.status) && o.action && (item.follow
                ? <div className={s.inlineForm}><input className="input" value={o.action.owner || ''} onChange={(e) => editOutcome({ action: { ...o.action, owner: e.target.value } })} placeholder="New owner" aria-label="New owner" list="cv-meeting-owners" /><input className="input" type="date" value={o.action.due || ''} onChange={(e) => editOutcome({ action: { ...o.action, due: e.target.value } })} aria-label="New due date" /></div>
                : <ActionEditor value={o.action} onChange={(action) => editOutcome({ action })} />)}
              <textarea className={`input ${s.note}`} rows={2} value={st.notes[item.id] || ''} maxLength={ML.note} placeholder="Notes for the record (optional)" aria-label={`Notes on ${item.title}`}
                onChange={(e) => { const v = e.target.value; update((cur) => ({ ...cur, notes: { ...cur.notes, [item.id]: v } })); }} />
            </>
          )}

          <div className={s.stepper}>
            <span className={`cv-xs ${save.state === 'error' ? '' : 'cv-faint'}`} role="status">{save.state === 'saving' ? 'Saving…' : save.state === 'error' ? `Not saved: ${save.message}` : 'Saved'}</span>
            <div className="cv-row" style={{ gap: 6 }}>
              {i > 0 && <Button size="sm" variant="ghost" icon="ArrowLeft" onClick={() => go(i - 1)}>Back</Button>}
              {item.seg === 'E'
                ? <Button icon="CircleCheck" onClick={finalize} disabled={finalizing || problems.length > 0}>{finalizing ? 'Saving…' : 'Finish and assign'}</Button>
                : <Button size="sm" iconRight="ArrowRight" onClick={() => go(i + 1)}>{o ? 'Next' : 'Skip for now'}</Button>}
            </div>
          </div>
          {save.conflict && <Callout tone="warn" icon="TriangleAlert">Someone else changed or took over this meeting. <button className="cv-link" onClick={() => window.location.reload()}>Reload to see the latest</button>.</Callout>}
        </section>

        <aside className={s.side}>
          <section className="cv-card">
            <span className="cv-h4">Agenda</span>
            <ol className={s.mini}>
              {items.map((x, n) => {
                const oc = st.outcomes[x.id];
                return (
                  <li key={x.id}>
                    <button type="button" className={n === i ? s.miniNow : ''} onClick={() => go(n)} aria-current={n === i ? 'step' : undefined}>
                      <Icon name={oc ? 'CircleCheck' : n === i ? 'CircleDot' : 'Circle'} size={14} />
                      <span className="cv-col" style={{ gap: 1, minWidth: 0 }}><span className={s.miniTitle}>{x.title}</span><span className="cv-xs cv-faint">{oc ? OUTCOMES[oc.status] : `${SEGMENTS[x.seg].label} · ${minsLabel(x.mins)}`}</span></span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
          <section className="cv-card">
            <span className="cv-h4">In the room</span>
            <span className="cv-small cv-muted">{st.attendees.length ? st.attendees.join(', ') : `Owner + ${CV_ROOM.gm || 'GM'}`}</span>
            {session.agenda.dataThrough && <span className="cv-xs cv-faint">Agenda built from data through {dayLabel(session.agenda.dataThrough)}.</span>}
          </section>
        </aside>
      </div>
    </>
  );
}

function Watching({ session, onTakeOver, onReload }) {
  return (
    <>
      <PageHead over={`${CV_ROOM.name} · weekly meeting in progress`} q={`${session.editor || 'Someone'} is running this week’s meeting`}
        sub="One person edits at a time, so nobody overwrites anyone. It saves as it goes; refresh to follow along."
        right={<div className="cv-row" style={{ gap: 6 }}><Button variant="secondary" icon="RefreshCcw" onClick={onReload}>Refresh</Button>{session.canTakeOver && <Button onClick={onTakeOver}>Take over</Button>}</div>} />
      <section className="cv-card"><span className="cv-h4">Agenda</span><AgendaPreview agenda={session.agenda} /></section>
    </>
  );
}

/* ------------------------------------------------------------------ the page */
function CvMeeting() {
  const cv = useCv();
  const eng = useEngine();
  const server = eng.mode === 'server';
  const sample = !(server && eng.org && !eng.org.sample);
  const [schedule, setSchedule] = useSaved('meeting.schedule', DEFAULT_SCHEDULE);
  const [dismissed, setFindings] = useSaved('findings', {});
  const [plan] = useSaved('plan', { hours: CV_D.room.managerHours });
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [starting, setStarting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [finished, setFinished] = React.useState(null);
  const room = eng.room;
  const roomName = CV_ROOM.name;
  const api = React.useMemo(
    () => (server ? serverApi : localApi({ roomName, onDismiss: (m) => setFindings((cur) => ({ ...cur, ...m }), 'Weekly meeting: not for us') })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [server, room, roomName],
  );
  const load = React.useCallback(() => {
    if (eng.mode === 'pending') return;
    setError(null);
    api.load(room).then(setData).catch((e) => setError(e.message));
  }, [api, room, eng.mode]);
  React.useEffect(() => { setData(null); setFinished(null); load(); if (server) void engine.refreshWindows(); }, [load, server]);

  const sched = { ...DEFAULT_SCHEDULE, ...schedule };
  const attendees = sched.attendees || [];
  const owners = [...new Set([...attendees, 'Owner', CV_ROOM.gm].filter(Boolean))];
  const agenda = buildAgenda(CV_D, { sample, windows: eng.windows, actions: data?.actions || [], dismissed, hours: plan.hours });

  const start = async () => {
    setStarting(true);
    try { setData(await api.start(room, agenda, attendees)); setFinished(null); } catch (e) { cv.toast(`Couldn’t start: ${e.message}`); }
    setStarting(false);
  };
  const patch = async (id, p) => {
    setBusy(true);
    try { const r = await api.action(id, p); setData((d) => ({ ...d, actions: r.actions })); } catch (e) { cv.toast(`Not saved: ${e.message}`); }
    setBusy(false);
  };

  if (error) {
    return (
      <div className="cv-page">
        <PageHead q="The weekly meeting" />
        <Callout tone="bad" icon="TriangleAlert">The meeting couldn&apos;t load: {error}. <button className="cv-link" onClick={load}>Try again</button></Callout>
      </div>
    );
  }
  if (!data) return <div className="cv-page"><PageHead q="The weekly meeting" sub="Loading this room’s meeting…" /></div>;

  const live = data.live;
  return (
    <div className="cv-page wide">
      <datalist id="cv-meeting-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
      {live && live.canEdit ? (
        <Runner key={live.id} session={live} api={api} owners={owners}
          onFinalized={(r) => { setData({ live: r.live, history: r.history, actions: r.actions }); setFinished(r.record); }}
          onDiscarded={(r) => setData(r)} />
      ) : live ? (
        <Watching session={live} onReload={load} onTakeOver={() => api.save(live.id, live.version, undefined, true).then(load).catch((e) => cv.toast(e.message))} />
      ) : (
        <Ready agenda={agenda} actions={data.actions} history={data.history} schedule={sched} setSchedule={setSchedule} attendees={attendees} owners={owners}
          onStart={start} starting={starting} finished={finished} onCloseFinished={() => setFinished(null)} onPatch={patch} busy={busy}
          sample={sample} onResetSample={api.reset ? () => api.reset(room).then(setData) : null} />
      )}
    </div>
  );
}

export { CvMeeting };
