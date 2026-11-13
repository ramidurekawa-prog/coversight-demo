'use client';

import * as React from 'react';
import { Icon, Button } from '../../kit';
import { useCv, CV_D, CV_ROOM, Pill, PageHead, Callout } from '../core';
import { engine, useEngine, useSaved } from '../../engine';
import {
  actionProgress, activeActions, buildAgenda, DAYS, DEFAULT_SCHEDULE, DISMISS_DAYS, draftAction, finalizeMeeting, finalizeProblems, HOLD_DAYS,
  isoDay, MEETING_LIMITS as ML, meetingStats, nextMeeting, OUTCOMES, readiness, SEGMENTS, setOutcome, slotLabel, summaryEmail, summaryText, usd,
} from '../../../lib/data/page/meeting';
import { BigNum, Drivers, MeetingWeeks, Ring, TimeBar, ValueBars, WeekBars } from './meeting.charts';
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

/** The candidate behind a decision item, for its value, range and chance. */
const candidateFor = (item) => (item?.findingId ? CV_D.candidates.find((c) => c.id === item.findingId) : null);
const rowsFor = () => CV_D.hist?.rows || [];

/** The item's own visual: a chart where the data supports one, otherwise its headline number. */
function ItemVisual({ item }) {
  if (item.missing) return null;
  if (item.id === 'fin') {
    const rows = rowsFor();
    const [first, second, third] = item.figures;
    return (
      <div className={s.visual}>
        <div className={s.bigRow}>
          {first && <BigNum label="Contribution after food and labour" value={first.value} claim={first.claim} />}
          {second && <BigNum label="vs 4-week average" value={second.value} claim={second.claim} tone={second.value.startsWith('−') ? 'down' : 'up'} />}
          {third && <BigNum label="Verified saving run-rate" value={third.value} claim={third.claim} sub=" not realized cash" />}
        </div>
        {rows.length > 1 && <WeekBars rows={rows} />}
        {rows.length > 4 && <Drivers rows={rows} />}
      </div>
    );
  }
  const c = candidateFor(item);
  if (c && item.seg === 'D') {
    return (
      <div className={s.visual}>
        <div className={s.bigRow}>
          <BigNum label={c.prevent ? 'Cost prevented if done' : 'Potential opportunity'} value={<>{usd(c.value)}<small>/wk</small></>} claim={c.claim} />
          {!c.prevent && <BigNum label="Chance it verifies" value={`${Math.round(c.p * 100)}%`} />}
          <BigNum label="Manager time" value={`${Math.round(c.hours * 60)} min`} />
        </div>
        {!c.prevent && c.lo != null && <ValueBars rows={[{ ...c, title: `Likely range ${usd(c.lo)}–${usd(c.hi)} a week (dashed); the bar is the estimate` }]} />}
      </div>
    );
  }
  if (!item.figures?.length) return null;
  const [first, ...rest] = item.figures;
  return (
    <div className={s.bigRow}>
      <BigNum label={first.label} value={first.value} claim={first.claim} />
      {rest.map((f) => <BigNum key={f.label} label={f.label} value={f.value} claim={f.claim} />)}
    </div>
  );
}

/** A short reveal: the long explanation stays one click away. */
function More({ label = 'Why?', children, open: init = false }) {
  const [open, setOpen] = React.useState(init);
  const id = React.useId();
  return (
    <div className={s.more}>
      <button type="button" className={s.moreBtn} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Icon name="ChevronDown" size={14} className={s.moreChev} />{label}
      </button>
      {open && <div id={id} className={s.moreBody}>{children}</div>}
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
      {draft && <span className="cv-xs cv-faint" role="status">{draft === 'saved' ? 'Saved to the outbox as a draft. Nothing has been sent.' : 'The draft wasn’t saved. Try again, or use Copy.'}</span>}
    </div>
  );
}

function MeetingDetail({ rec }) {
  const cv = useCv();
  const dec = (rec.decisions || []).filter((x) => x.outcome !== 'discussed' && x.outcome !== 'kept');
  return (
    <div className={s.detail}>
      {rec.decisions && (
        <div className={s.bigRow}>
          <BigNum label="Minutes" value={rec.mins ?? '–'} />
          <BigNum label="Decisions" value={dec.length} />
          <BigNum label="Actions" value={rec.actions?.length || 0} />
          <BigNum label="Deferred" value={rec.deferred?.length || 0} />
        </div>
      )}
      {rec.actions?.length > 0 && (
        <ul className={s.cards}>{rec.actions.map((a) => (
          <li key={a.title} className={s.card}>
            <b>{a.title}</b>
            <span className={s.chipsRow}><span className={s.chip}><Icon name="Users" size={12} />{a.owner || 'No owner'}</span><span className={s.chip}><Icon name="CalendarClock" size={12} />{dayLabel(a.due)}</span>
              {a.findingId && <button className="cv-link cv-xs" onClick={() => cv.go('finding', { id: a.findingId })}>Evidence</button>}</span>
          </li>
        ))}</ul>
      )}
      {(dec.length > 0 || rec.notes?.length > 0 || rec.observations?.length > 0) && (
        <More label="Decisions and notes">
          {rec.observations?.map((o) => <span key={o} className="cv-small cv-muted">{o}</span>)}
          {dec.length > 0 && <ul className={s.plainList}>{dec.map((x) => <li key={x.item}><Icon name="Gavel" size={14} /><span>{x.title}: <b>{OUTCOMES[x.outcome] || x.outcome}</b>{x.reason ? <span className="cv-faint"> ({x.reason})</span> : null}</span></li>)}</ul>}
          {rec.notes?.length > 0 && <ul className={s.plainList}>{rec.notes.map((n) => <li key={n.item}><Icon name="PencilLine" size={14} /><span><b>{n.title}.</b> {n.note}</span></li>)}</ul>}
        </More>
      )}
      {!rec.decisions && rec.log?.length > 0 && <ul className={s.plainList}>{rec.log.map((l) => <li key={l}><Icon name="Check" size={14} />{l}</li>)}</ul>}
    </div>
  );
}

/* ------------------------------------------------------------------ follow-through */
const STATE_COLOR = { done: 'var(--signal-good)', verified: 'var(--signal-good)', monitoring: 'var(--accent)', assigned: 'var(--accent)', overdue: 'var(--signal-warn)', deferred: 'var(--border-strong)' };
const STATE_GROUP = { done: 'Done', verified: 'Done', monitoring: 'On track', assigned: 'On track', overdue: 'Overdue', deferred: 'Deferred' };

function ActionRow({ a, onPatch, busy }) {
  const cv = useCv();
  const eng = useEngine();
  const [edit, setEdit] = React.useState(null);
  const p = actionProgress(a, { windows: eng.windows, candidates: CV_D.candidates });
  const live = a.status === 'open';
  const label = { assigned: `Due ${dayLabel(a.due)}`, overdue: `Overdue · ${dayLabel(a.due)}`, deferred: `Back ${dayLabel(a.due)}` }[p.state] || p.label;
  return (
    <li className={`${s.act} ${a.status === 'done' || a.status === 'cancelled' ? s.closed : ''}`}>
      <span className={s.dot} style={{ background: STATE_COLOR[p.state] || 'var(--border)' }} aria-hidden="true" />
      <div className="cv-col" style={{ gap: 3, minWidth: 0 }}>
        <span className={s.actTitle} title={a.doneWhen ? `Done when: ${a.doneWhen}` : undefined}>{a.title}</span>
        <span className={s.chipsRow}>
          {a.owner && <span className={s.chip}><Icon name="Users" size={12} />{a.owner}</span>}
          <Pill tone={PROGRESS_TONE[p.state]}>{label}</Pill>
          {a.findingId && <button className="cv-link cv-xs" onClick={() => cv.go('finding', { id: a.findingId })}>Evidence</button>}
        </span>
        {a.status === 'deferred' && a.reason && <span className={s.actMeta}>{a.reason}</span>}
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
        {live && !edit && (
          <>
            <Button size="sm" variant="secondary" icon="Check" disabled={busy} onClick={() => onPatch(a.id, { status: 'done' })} aria-label={`Mark done: ${a.title}`}>Done</Button>
            <Button size="sm" variant="ghost" icon="PencilLine" disabled={busy} onClick={() => setEdit({ owner: a.owner || '', due: a.due })} aria-label={`Change owner or date: ${a.title}`} />
            <Button size="sm" variant="ghost" icon="Trash2" disabled={busy} onClick={() => onPatch(a.id, { status: 'cancelled' })} aria-label={`Cancel: ${a.title}`} />
          </>
        )}
        {(a.status === 'done' || a.status === 'cancelled') && <Button size="sm" variant="ghost" icon="Undo2" disabled={busy} onClick={() => onPatch(a.id, { status: 'open' })}>Reopen</Button>}
      </div>
    </li>
  );
}

function FollowThrough({ actions, onPatch, busy }) {
  const eng = useEngine();
  const [filter, setFilter] = React.useState(null);
  const now = new Date();
  const live = activeActions(actions, CV_D.id, now);
  const recent = (actions || []).filter((a) => a.roomId === CV_D.id && a.status === 'done').slice(-6).reverse();
  const all = [...live, ...recent].map((a) => ({ a, g: STATE_GROUP[actionProgress(a, { windows: eng.windows, candidates: CV_D.candidates, now }).state] }));
  const groups = ['Overdue', 'On track', 'Deferred', 'Done'].map((g) => ({ label: g, n: all.filter((x) => x.g === g).length, color: { Overdue: 'var(--signal-warn)', 'On track': 'var(--accent)', Deferred: 'var(--border-strong)', Done: 'var(--signal-good)' }[g] }));
  const shown = all.filter((x) => !filter || x.g === filter);
  return (
    <section className="cv-card" aria-labelledby="cv-meeting-ft">
      <div className="cv-card-head"><span className="cv-h4" id="cv-meeting-ft">Follow-through</span></div>
      {all.length ? (
        <>
          <div className={s.ringRow}>
            <Ring parts={groups} label="Actions" />
            <div className={s.legend} role="group" aria-label="Filter actions">
              {groups.map((g) => (
                <button key={g.label} type="button" className={`${s.legendBtn} ${filter === g.label ? s.legendOn : ''}`} aria-pressed={filter === g.label} disabled={!g.n} onClick={() => setFilter(filter === g.label ? null : g.label)}>
                  <span className={s.swatch} style={{ background: g.color }} aria-hidden="true" /><b>{g.n}</b> {g.label}
                </button>
              ))}
            </div>
          </div>
          <ul className={s.acts}>{shown.map(({ a }) => <ActionRow key={a.id} a={a} onPatch={onPatch} busy={busy} />)}</ul>
        </>
      ) : <div className={s.empty}><Icon name="ListChecks" size={22} /><span>Accepted decisions land here with an owner and a due date.</span></div>}
    </section>
  );
}

function History({ history, pick, setPick }) {
  const st = meetingStats(history || []);
  const sel = (history || []).find((m) => m.id === pick);
  return (
    <section className="cv-card" aria-labelledby="cv-meeting-hist" id="cv-meeting-history">
      <div className="cv-card-head"><span className="cv-h4" id="cv-meeting-hist">Past meetings</span></div>
      <div className={s.bigRow}>
        <BigNum label="Weeks met" value={<>{st.held}<small>/8</small></>} />
        <BigNum label="Average length" value={st.avgMins != null ? <>{st.avgMins}<small> min</small></> : '–'} />
      </div>
      <MeetingWeeks history={history} active={pick} onPick={setPick} />
      {sel ? (
        <div className={s.histBody}>
          <span className="cv-h4">{shortDate(sel.at)}{sel.by ? <span className="cv-xs cv-faint"> · run by {sel.by}</span> : null}</span>
          <MeetingDetail rec={sel} /><SummaryActions rec={sel} />
        </div>
      ) : history?.length ? <span className="cv-xs cv-faint">Tap a week to open that meeting.</span> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ before the meeting */
function SlotEditor({ schedule, onSave, onCancel }) {
  const [edit, setEdit] = React.useState({ ...DEFAULT_SCHEDULE, ...schedule });
  return (
    <form className={`cv-card ${s.panel}`} onSubmit={(e) => { e.preventDefault(); onSave(edit); }}>
      <span className="cv-h4">Reschedule</span>
      <div className={s.slotForm}>
        <select className="input" value={edit.day} onChange={(e) => setEdit({ ...edit, day: +e.target.value })} aria-label="Day">{DAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}</select>
        <input className="input" type="time" step="900" value={edit.time} onChange={(e) => setEdit({ ...edit, time: e.target.value })} aria-label="Time" required />
        <select className="input" value={edit.mins ?? 15} onChange={(e) => setEdit({ ...edit, mins: +e.target.value })} aria-label="Planned length">{[10, 15, 20, 30, 45].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select>
      </div>
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
      {list.length > 0 && <ul className={s.chips}>{list.map((n) => <li key={n}>{n}<button type="button" className={s.iconBtn} aria-label={`Remove ${n}`} onClick={() => setList(list.filter((x) => x !== n))}><Icon name="Trash2" size={12} /></button></li>)}</ul>}
      <form className={s.addRow} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={ML.owner} placeholder="Name" aria-label="Attendee name" list="cv-meeting-owners" />
        <Button size="sm" variant="secondary" icon="Plus" type="submit" disabled={!name.trim()}>Add</Button>
      </form>
      <div className="cv-row" style={{ gap: 6 }}><Button size="sm" onClick={() => onSave(list)}>Save</Button><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}

function AgendaList({ items, compact }) {
  return (
    <ol className={s.preview}>
      {items.map((x) => (
        <li key={x.id}>
          <span className={`${s.segTag} ${s[`tag${x.seg}`]}`} aria-hidden="true">{x.seg}</span>
          <span className="cv-col" style={{ gap: 1, minWidth: 0 }}><b className="cv-small">{x.title}</b>{!compact && <span className="cv-xs cv-faint">{SEGMENTS[x.seg].label} · {minsLabel(x.mins)}</span>}</span>
          {compact && <span className="cv-xs cv-faint cv-num">{minsLabel(x.mins)}</span>}
        </li>
      ))}
    </ol>
  );
}

/** Last week, as a chart. */
function LastWeek({ fin }) {
  const cv = useCv();
  if (!fin || fin.missing) {
    return (
      <section className="cv-card">
        <span className="cv-over">Last week</span>
        <div className={s.empty}><Icon name="Unplug" size={22} /><span>No sales data yet, so nothing is estimated.</span><Button size="sm" icon="Plug" onClick={() => cv.go(fin?.go || 'connect')}>Connect Toast</Button></div>
      </section>
    );
  }
  return (
    <section className="cv-card" aria-label="Last week">
      <span className="cv-over">Last week</span>
      <ItemVisual item={fin} />
      {fin.risks?.length > 0 && <ul className={s.risks}>{fin.risks.map((r) => <li key={r}><Icon name="TriangleAlert" size={13} />{r}</li>)}</ul>}
    </section>
  );
}

function Ready({ agenda, actions, history, schedule, setSchedule, attendees, onStart, starting, finished, onCloseFinished, onPatch, busy, sample, onResetSample }) {
  const cv = useCv();
  const [panel, setPanel] = React.useState(null);
  const [seg, setSeg] = React.useState(null);
  const [dec, setDec] = React.useState(null);
  const [pick, setPick] = React.useState(null);
  const now = new Date();
  const r = readiness(agenda, actions, CV_D.id, now);
  const next = nextMeeting(schedule, now);
  const today = next.toDateString() === now.toDateString();
  const last = history?.[0];
  const toggle = (p) => setPanel(panel === p ? null : p);
  const fin = agenda.items.find((x) => x.id === 'fin');
  const decisions = agenda.items.filter((x) => x.seg === 'D').map((x) => ({ x, c: candidateFor(x) })).filter((d) => d.c);
  const tiles = [
    { k: 'D', label: 'Decisions', v: r.decisions, icon: 'Gavel' },
    { k: 'C', label: 'Unfinished', v: r.unfinished, icon: 'ListChecks', tone: r.overdue ? 'down' : null, sub: r.overdue ? `${r.overdue} overdue` : null },
    { k: 'B', label: 'Risks', v: r.risks, icon: 'TriangleAlert', tone: r.risks ? 'down' : null },
    { k: null, label: 'Minutes', v: Math.round(r.mins), icon: 'Clock', sub: `plan ${schedule.mins ?? 15}` },
  ];
  const listed = agenda.items.filter((x) => !seg || x.seg === seg);
  return (
    <>
      <PageHead over={`${CV_ROOM.name} · ${today ? 'Today' : shortDate(next.toISOString())} · ${slotLabel(schedule)}`} q="Ready for this week’s meeting"
        right={<Button icon="Play" onClick={onStart} disabled={starting || !agenda.items.length}>{starting ? 'Starting…' : 'Start meeting'}</Button>} />

      <div className={s.context}>
        <span><Icon name="Users" size={14} />{attendees.length ? attendees.join(', ') : `Owner + ${CV_ROOM.gm || 'GM'}`}</span>
        <span><Icon name="Database" size={14} />{agenda.dataThrough ? `Data to ${dayLabel(agenda.dataThrough)}` : 'No sales data'}</span>
        {sample && <Pill icon="FlaskConical">Sample data</Pill>}
        <span className={s.ctxBtns}>
          <Button size="sm" variant="ghost" icon="Users" aria-expanded={panel === 'people'} onClick={() => toggle('people')}>Attendees</Button>
          <Button size="sm" variant="ghost" icon="CalendarClock" aria-expanded={panel === 'slot'} onClick={() => toggle('slot')}>Reschedule</Button>
          <Button size="sm" variant="ghost" icon="Clock" disabled={!last} onClick={() => { setPick(last?.id || null); document.getElementById('cv-meeting-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Last meeting</Button>
        </span>
      </div>
      {panel === 'people' && <AttendeesEditor attendees={attendees} onCancel={() => setPanel(null)} onSave={(list) => { setSchedule({ ...schedule, attendees: list }, `Weekly meeting attendees: ${list.join(', ') || 'none'}`); setPanel(null); }} />}
      {panel === 'slot' && <SlotEditor schedule={schedule} onCancel={() => setPanel(null)} onSave={(v) => { setSchedule(v, `Weekly meeting moved to ${slotLabel(v)}`); setPanel(null); }} />}

      {finished && (
        <section className={`cv-card ${s.finished}`} aria-live="polite">
          <div className="cv-card-head"><span className="cv-h4"><Icon name="CircleCheck" size={16} /> Meeting saved · {shortDate(finished.at)}</span><Button size="sm" variant="ghost" onClick={onCloseFinished}>Close</Button></div>
          <MeetingDetail rec={finished} />
          <SummaryActions rec={finished} />
        </section>
      )}

      <div className={s.tiles} role="group" aria-label="This meeting at a glance. Pick one to filter the agenda.">
        {tiles.map((t) => (
          <button key={t.label} type="button" className={`${s.tile} ${seg && seg === t.k ? s.tileOn : ''}`} disabled={!t.k} aria-pressed={t.k ? seg === t.k : undefined} onClick={() => setSeg(seg === t.k ? null : t.k)}>
            <span className={s.tileLabel}><Icon name={t.icon} size={14} />{t.label}</span>
            <span className={`${s.tileVal} ${t.tone ? s[t.tone] : ''}`}>{t.v}</span>
            {t.sub && <span className={s.tileSub}>{t.sub}</span>}
          </button>
        ))}
      </div>

      <div className={s.hero}>
        <LastWeek fin={fin} />
        <section className="cv-card" aria-label="Agenda">
          <div className="cv-card-head"><span className="cv-over">Agenda · {minsLabel(r.mins)}</span>{seg && <button className="cv-link cv-xs" onClick={() => setSeg(null)}>Show all</button>}</div>
          <TimeBar items={agenda.items} segments={SEGMENTS} active={seg} onPick={setSeg} />
          <AgendaList items={listed} compact />
        </section>
      </div>

      {decisions.length > 0 && (
        <section className="cv-card" aria-labelledby="cv-meeting-dec">
          <div className="cv-card-head"><span className="cv-h4" id="cv-meeting-dec">Decisions on the table</span><span className="cv-xs cv-faint">Potential, not saved</span></div>
          <ValueBars rows={decisions.map(({ x, c }) => ({ ...c, id: x.id, title: x.title }))} active={dec} onPick={setDec} />
          {dec && (() => {
            const d = decisions.find((y) => y.x.id === dec);
            return d ? (
              <div className={s.decMore}>
                <div className={s.recommend}><Icon name="Lightbulb" size={14} /><span>Do: <b>{OPTION_LABEL[d.x.recommend]}</b>{d.x.action?.approval && d.x.action.approval !== 'None' ? ` · needs ${d.x.action.approval.toLowerCase()}` : ''}</span></div>
                {d.x.body && <p className={s.para}>{d.x.body}</p>}
                <button className="cv-link cv-xs" onClick={() => cv.go('finding', { id: d.x.findingId })}>Open the evidence</button>
              </div>
            ) : null;
          })()}
        </section>
      )}

      <div className={s.cols}>
        <FollowThrough actions={actions} onPatch={onPatch} busy={busy} />
        <History history={history} pick={pick} setPick={setPick} />
      </div>
      {sample && history?.length > 0 && onResetSample && <div><Button size="sm" variant="ghost" icon="Undo2" onClick={onResetSample}>Clear the sample meeting record</Button></div>}
    </>
  );
}

/* ------------------------------------------------------------------ during the meeting */
function ActionEditor({ value, onChange }) {
  const [open, setOpen] = React.useState(!value.owner?.trim());
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  if (!open) {
    return (
      <div className={s.actSummary}>
        <span className={s.chipsRow}>
          <span className={s.chip}><Icon name="Users" size={12} />{value.owner}</span>
          <span className={s.chip}><Icon name="CalendarClock" size={12} />{dayLabel(value.due)}</span>
          <span className={s.chip}><Icon name="Flag" size={12} />{{ high: 'High', normal: 'Normal', low: 'Low' }[value.priority] || value.priority} priority</span>
          {value.approval && value.approval !== 'None' && <span className={s.chip}><Icon name="Lock" size={12} />{value.approval}</span>}
        </span>
        <Button size="sm" variant="ghost" icon="PencilLine" onClick={() => setOpen(true)}>Edit</Button>
      </div>
    );
  }
  return (
    <fieldset className={s.editor}>
      <legend className="cv-xs cv-faint">The action</legend>
      <label className={s.wide}><span>Action</span><input className="input" value={value.title} onChange={set('title')} maxLength={ML.title} /></label>
      <label><span>Owner</span><input className="input" value={value.owner} onChange={set('owner')} maxLength={ML.owner} list="cv-meeting-owners" required aria-invalid={!value.owner.trim()} /></label>
      <label><span>Due</span><input className="input" type="date" value={value.due} onChange={set('due')} required /></label>
      <label><span>Priority</span><select className="input" value={value.priority} onChange={set('priority')}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
      <label className={s.wide}><span>Done when</span><input className="input" value={value.doneWhen} onChange={set('doneWhen')} maxLength={ML.doneWhen} /></label>
      <span className={`${s.wide} cv-xs cv-faint`}><Icon name="Lock" size={12} /> Approval needed: {value.approval || 'None'}</span>
      {value.owner?.trim() && <div className={s.wide}><Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Done</Button></div>}
    </fieldset>
  );
}

function Consequence({ item, o }) {
  const text = {
    rejected: item.findingId ? `Off the plan for ${DISMISS_DAYS} days.` : 'Recorded as rejected.',
    deferred: `Back in ${HOLD_DAYS} days with your reason.`,
    evidence: 'Someone brings the evidence; it comes back next meeting.',
    accepted: 'Becomes an action with an owner and a due date.',
    changed: 'Becomes an action with your changes.',
    done: 'Closed. A test, if any, still decides what is saved.',
    kept: 'Stays open as it is.',
    reassigned: 'Stays open with a new owner or date.',
    cancelled: 'Cancelled, kept on the record.',
    continue: 'The test keeps running. Nothing books until it verifies.',
    adjust: 'Someone makes the adjustment.',
    stop: 'Someone stops it on the test itself.',
    investigate: 'Someone looks into it.',
    discussed: 'Recorded as discussed.',
  }[o.status];
  return text ? <span className={s.hint}><Icon name="Info" size={13} />{text}</span> : null;
}

function ConfirmPlan({ preview, problems, items, onGo }) {
  const byId = Object.fromEntries(items.map((x, n) => [x.id, n]));
  const open = preview.upserts.filter((u) => u.status === 'open').sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const undecided = items.filter((x) => x.seg !== 'E' && x.seg !== 'A' && !preview.record.decisions.some((d) => d.item === x.id));
  return (
    <div className="cv-col" style={{ gap: 14 }}>
      <div className={s.bigRow}>
        <BigNum label="New actions" value={open.length} />
        <BigNum label="Updated" value={preview.updates.length} />
        <BigNum label="Deferred" value={preview.record.deferred.length} />
        <BigNum label="Off the plan" value={Object.keys(preview.dismiss).length} />
      </div>
      {problems.length > 0 && <Callout tone="warn" icon="TriangleAlert">Fix first: {problems.map((p) => <React.Fragment key={p.id}><button className="cv-link" onClick={() => onGo(byId[p.id])}>{items[byId[p.id]]?.title}</button> ({p.problem}) </React.Fragment>)}</Callout>}
      {open.length > 0 && (
        <ul className={s.cards} aria-label="Actions from this meeting, soonest first">
          {open.map((u) => (
            <li key={u.sourceKey} className={s.card}>
              <b>{u.title}</b>
              <span className={s.chipsRow}>
                <span className={`${s.chip} ${u.owner ? '' : s.missing}`}><Icon name="Users" size={12} />{u.owner || 'No owner'}</span>
                <span className={s.chip}><Icon name="CalendarClock" size={12} />{dayLabel(u.due)}</span>
                <span className={s.chip}><Icon name={u.findingId ? 'FlaskConical' : 'CircleCheck'} size={12} />{u.findingId ? 'Checked by its test' : 'Owner confirms'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {undecided.length > 0 && <span className="cv-xs cv-faint">{undecided.length} item{undecided.length === 1 ? '' : 's'} not decided; recorded as not discussed.</span>}
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
  const others = item.options.filter((k) => k !== item.recommend);
  const itemPct = Math.max(0, Math.min(1, 1 - left / (item.mins * 60)));

  return (
    <>
      <PageHead over={`${CV_ROOM.name} · meeting in progress`} q="Weekly meeting"
        right={(
          <div className="cv-row" style={{ gap: 14 }}>
            <div className={s.clock} aria-label={`Meeting time ${clock(total)} of ${clock(planned)} planned`}>
              <span className={`${s.total} ${total > planned ? s.over : ''}`}>{clock(total)}</span>
              <span className="cv-xs cv-faint">{total > planned ? `${clock(total - planned)} over` : `of ${clock(planned)}`}</span>
            </div>
            {discard
              ? <span className="cv-row" style={{ gap: 6 }}><Button size="sm" variant="destructive" onClick={() => api.discard(session.id).then(onDiscarded).catch((e) => setSave({ state: 'error', message: e.message }))}>Discard meeting</Button><Button size="sm" variant="ghost" onClick={() => setDiscard(false)}>Keep it</Button></span>
              : <Button size="sm" variant="ghost" onClick={() => setDiscard(true)}>Discard</Button>}
          </div>
        )} />

      <div className={s.progress} role="list" aria-label="Agenda progress">
        {items.map((x, n) => (
          <button key={x.id} type="button" role="listitem" className={`${s.seg} ${n === i ? s.now : st.outcomes[x.id] ? s.done : ''}`} style={{ flex: Math.max(0.5, x.mins) }} onClick={() => go(n)}
            aria-label={`${n + 1}. ${x.title}${st.outcomes[x.id] ? ', decided' : ''}${n === i ? ', current' : ''}`} aria-current={n === i ? 'step' : undefined} />
        ))}
      </div>

      <div className={s.runGrid}>
        <section className={`cv-card ${s.current}`} aria-labelledby="cv-meeting-item">
          <div className="cv-card-head">
            <span className={s.segLabel}><span className={`${s.segTag} ${s[`tag${item.seg}`]}`} aria-hidden="true">{item.seg}</span>{SEGMENTS[item.seg].label}</span>
            <span className={`${s.left} ${left < 0 ? s.over : ''}`}>
              <span className={s.leftBar} aria-hidden="true"><span style={{ width: `${itemPct * 100}%` }} /></span>
              {left < 0 ? `${clock(left)} over` : `${clock(left)} left`}
            </span>
          </div>
          <h3 className={s.itemTitle} id="cv-meeting-item">{item.title}</h3>

          {item.seg === 'E' ? (
            <ConfirmPlan preview={preview} problems={problems} items={items} onGo={go} />
          ) : (
            <>
              {item.missing && <Callout tone="warn" icon="TriangleAlert">No data to show. Nothing is estimated to fill the gap.</Callout>}
              <ItemVisual item={item} />
              {item.risks?.length > 0 && <ul className={s.risks}>{item.risks.map((r) => <li key={r}><Icon name="TriangleAlert" size={13} />{r}</li>)}</ul>}

              <div className={s.todo} role="group" aria-label="What to do">
                <span className={s.todoLabel}><Icon name="Lightbulb" size={14} />What to do</span>
                <div className={s.choices}>
                  <Button aria-pressed={o?.status === item.recommend} variant={!o || o.status === item.recommend ? 'primary' : 'secondary'} icon={o?.status === item.recommend ? 'Check' : undefined} onClick={() => choose(item.recommend)}>{OPTION_LABEL[item.recommend]}</Button>
                  {others.map((k) => (
                    <Button key={k} size="sm" aria-pressed={o?.status === k} variant={o?.status === k ? 'primary' : 'ghost'} onClick={() => choose(k)}>{OPTION_LABEL[k]}</Button>
                  ))}
                </div>
                {o && <Consequence item={item} o={o} />}
              </div>
              {o?.status === 'deferred' && (
                <label className={s.reason}><span className="cv-xs">Why defer it?</span>
                  <input className="input" value={o.reason || ''} maxLength={ML.reason} onChange={(e) => editOutcome({ reason: e.target.value })} placeholder="Reason (required)" aria-invalid={!o.reason?.trim()} /></label>
              )}
              {o && NEEDS_ACTION.has(o.status) && o.action && (item.follow
                ? <div className={s.inlineForm}><input className="input" value={o.action.owner || ''} onChange={(e) => editOutcome({ action: { ...o.action, owner: e.target.value } })} placeholder="New owner" aria-label="New owner" list="cv-meeting-owners" /><input className="input" type="date" value={o.action.due || ''} onChange={(e) => editOutcome({ action: { ...o.action, due: e.target.value } })} aria-label="New due date" /></div>
                : <ActionEditor key={`${item.id}:${o.status}`} value={o.action} onChange={(action) => editOutcome({ action })} />)}
              <div className={s.moreRow}>
                {item.body && <More label="Why?"><p className={s.para}>{item.body}</p>{item.findingId && <button className="cv-link cv-xs" onClick={() => cv.go('finding', { id: item.findingId })}>Open the evidence</button>}</More>}
                <More label={st.notes[item.id] ? 'Note' : 'Add a note'} open={!!st.notes[item.id]}>
                  <textarea className={`input ${s.note}`} rows={2} value={st.notes[item.id] || ''} maxLength={ML.note} placeholder="For the record" aria-label={`Notes on ${item.title}`}
                    onChange={(e) => { const v = e.target.value; update((cur) => ({ ...cur, notes: { ...cur.notes, [item.id]: v } })); }} />
                </More>
              </div>
            </>
          )}

          <div className={s.stepper}>
            <span className={`cv-xs ${save.state === 'error' ? '' : 'cv-faint'}`} role="status"><Icon name={save.state === 'error' ? 'TriangleAlert' : 'Check'} size={12} /> {save.state === 'saving' ? 'Saving…' : save.state === 'error' ? `Not saved: ${save.message}` : 'Saved'}</span>
            <div className="cv-row" style={{ gap: 6 }}>
              {i > 0 && <Button size="sm" variant="ghost" icon="ArrowLeft" onClick={() => go(i - 1)}>Back</Button>}
              {item.seg === 'E'
                ? <Button icon="CircleCheck" onClick={finalize} disabled={finalizing || problems.length > 0}>{finalizing ? 'Saving…' : 'Finish and assign'}</Button>
                : <Button size="sm" variant={o ? 'primary' : 'secondary'} iconRight="ArrowRight" onClick={() => go(i + 1)}>{o ? 'Next' : 'Skip'}</Button>}
            </div>
          </div>
          {save.conflict && <Callout tone="warn" icon="TriangleAlert">Someone else changed or took over this meeting. <button className="cv-link" onClick={() => window.location.reload()}>Reload</button>.</Callout>}
        </section>

        <aside className={s.side}>
          <section className="cv-card">
            <span className="cv-over">Agenda</span>
            <ol className={s.mini}>
              {items.map((x, n) => {
                const oc = st.outcomes[x.id];
                return (
                  <li key={x.id}>
                    <button type="button" className={n === i ? s.miniNow : ''} onClick={() => go(n)} aria-current={n === i ? 'step' : undefined}>
                      <Icon name={oc ? 'CircleCheck' : n === i ? 'CircleDot' : 'Circle'} size={14} />
                      <span className="cv-col" style={{ gap: 1, minWidth: 0 }}><span className={s.miniTitle}>{x.title}</span>{oc && <span className="cv-xs cv-faint">{OUTCOMES[oc.status]}</span>}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <span className="cv-xs cv-faint"><Icon name="Users" size={12} /> {st.attendees.length ? st.attendees.join(', ') : `Owner + ${CV_ROOM.gm || 'GM'}`}</span>
          </section>
        </aside>
      </div>
    </>
  );
}

function Watching({ session, onTakeOver, onReload }) {
  return (
    <>
      <PageHead over={`${CV_ROOM.name} · meeting in progress`} q={`${session.editor || 'Someone'} is running the meeting`}
        sub="One person edits at a time. Refresh to follow along."
        right={<div className="cv-row" style={{ gap: 6 }}><Button variant="secondary" icon="RefreshCcw" onClick={onReload}>Refresh</Button>{session.canTakeOver && <Button onClick={onTakeOver}>Take over</Button>}</div>} />
      <section className="cv-card"><TimeBar items={session.agenda.items} segments={SEGMENTS} active={null} onPick={() => {}} /><AgendaList items={session.agenda.items} /></section>
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
