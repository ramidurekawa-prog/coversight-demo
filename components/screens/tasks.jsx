'use client';

import * as React from 'react';

import { Button, Icon } from '../kit';
import { CV_D, CV_ROOM, useCv } from './core';
import s from './tasks.module.css';
import { engine, useEngine } from '../engine';
import { StaffingOutcome, useSticky } from './staffing';
import { Editor } from './pages/inputs-editor';

/* Approved changes waiting to be made in another system. Each one: the exact
 * steps, Done when it's made, and, for a price, a check against the next Toast
 * upload that guests really paid the new price. */

const STATUS = {
  open: { tone: 'todo', icon: 'CircleDashed', label: 'To do' },
  done: { tone: 'info', icon: 'Hourglass', label: 'Done · waiting for the data' },
  verified: { tone: 'good', icon: 'BadgeCheck', label: 'Confirmed by the data' },
  mismatch: { tone: 'warn', icon: 'MessageSquareWarning', label: 'Data doesn’t show it yet' },
  cancelled: { tone: 'neutral', icon: 'CircleMinus', label: 'Cancelled' },
};

function TaskRow({ t }) {
  const cv = useCv();
  const live = t.status === 'open' || t.status === 'mismatch';
  // A staffing change stays open until its clock-ins confirm it: that's where its evidence shows.
  const [open, setOpen] = React.useState(live || (String(t.approvalId || '').startsWith('shift:') && t.status === 'done'));
  const [ticked, setTicked] = React.useState({});
  const st = STATUS[t.status] || STATUS.open;
  const manual = t.expect?.type !== 'price';
  const shift = String(t.approvalId || '').startsWith('shift:');
  const [clocking, setClocking] = useSticky(`clock:${t.id}`, false);
  const act = (action, msg) => engine.taskAction(t.id, action).then((r) => r && cv.toast(msg));
  const id = `task-${t.id}`;
  const done = Object.values(ticked).filter(Boolean).length;
  return (
    <li className={`${s.task} ${open ? s.open : ''}`}>
      <button type="button" className={s.head} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Icon name={st.icon} size={15} className={s[st.tone]} />
        <span className={s.text}>
          <span className={s.title}>{t.title}</span>
          <span className={s.sub}>{t.system} · {st.label}{t.note ? ` · ${t.note}` : ''}</span>
        </span>
        {live && <span className={s.steps}>{done}/{t.steps.length} steps</span>}
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={15} className={s.chev} />
      </button>
      {open && (
        <div id={id} className={s.body}>
          <ol className={s.list}>
            {t.steps.map((step, i) => (
              <li key={i}>
                <label className={ticked[i] ? s.ticked : undefined}>
                  {live ? <input type="checkbox" checked={!!ticked[i]} onChange={(e) => setTicked({ ...ticked, [i]: e.target.checked })} aria-label={`Step ${i + 1} done`} /> : <span className={s.num}>{i + 1}</span>}
                  <span>{step}</span>
                </label>
              </li>
            ))}
          </ol>
          {shift && <StaffingOutcome task={t} />}
          {/* Clock-ins entered right here, on that shift's rows: no trip to another page. */}
          {clocking && t.expect?.date && (
            <div className={s.clockIn}>
              <Editor key={`clock-${t.id}`} kind="shifts" seed={null} startMode="grid"
                context={{ date: t.expect.date, meal: t.expect.meal, back: null, today: t.expect.date }} onBack={() => setClocking(false)} />
            </div>
          )}
          <div className={s.acts}>
            {live && <Button size="sm" icon="Check" onClick={() => act('done', shift ? 'Marked made, with your name and the time. Clock-ins entered after the shift confirm it.' : manual ? 'Marked done. Logged with your name and the time.' : 'Marked done. The next Toast upload confirms the new price.')}>Done, it’s made</Button>}
            {shift && t.status !== 'verified' && !clocking && <Button size="sm" variant="secondary" icon="Clock" onClick={() => setClocking(true)}>Add clock-ins</Button>}
            {t.status === 'done' && <Button size="sm" variant="secondary" icon="Undo2" onClick={() => act('reopen', 'Reopened.')}>Not done after all</Button>}
            {live && <Button size="sm" variant="ghost" onClick={() => act('cancel', 'Cancelled. Nothing was changed.')}>Cancel</Button>}
          </div>
        </div>
      )}
    </li>
  );
}

export function TasksPanel({ all = false }) {
  const eng = useEngine();
  const mine = (eng.tasks || []).filter((t) => all || t.roomId === CV_D.id);
  const live = mine.filter((t) => t.status === 'open' || t.status === 'mismatch' || t.status === 'done');
  const recent = mine.filter((t) => t.status === 'verified').slice(0, 3);
  if (!live.length && !recent.length) return null;
  const todo = mine.filter((t) => t.status === 'open' || t.status === 'mismatch').length;
  return (
    <section className={s.panel} aria-labelledby="tasks-head">
      <div className={s.top}>
        <h3 className={s.h} id="tasks-head">Changes to make</h3>
        <span className={s.count}>{todo ? `${todo} to do` : 'All made'}</span>
        <span className={s.note}>Approved here, made by hand in the other system{all ? '' : ` for ${CV_ROOM.short}`}.</span>
      </div>
      <ul className={s.tasks}>
        {[...live, ...recent].map((t) => <TaskRow key={`${t.id}-${t.status}`} t={t} />)}
      </ul>
      {eng.mode === 'local' && <p className={s.local}><Icon name="Info" size={13} />Saved in this browser only until the server is set up.</p>}
    </section>
  );
}
