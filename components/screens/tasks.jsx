'use client';

import * as React from 'react';

import { Button, Icon } from '../kit';
import { CV_D, CV_ROOM, Callout, Pill, useCv } from './core';
import { engine, useEngine } from '../engine';

/* Approved changes waiting to be made in another system. Each one: the exact
 * steps, Done when it's made, and, for a price, a check against the next Toast
 * upload that guests really paid the new price. */

const STATUS = {
  open: { tone: 'warn', icon: 'CircleDashed', label: 'To do' },
  done: { tone: 'info', icon: 'Hourglass', label: 'Done · waiting for the data' },
  verified: { tone: 'good', icon: 'BadgeCheck', label: 'Confirmed by the data' },
  mismatch: { tone: 'warn', icon: 'MessageSquareWarning', label: 'Data doesn’t show it yet' },
  cancelled: { tone: 'neutral', icon: 'CircleMinus', label: 'Cancelled' },
};

function TaskRow({ t }) {
  const cv = useCv();
  const [open, setOpen] = React.useState(t.status === 'open' || t.status === 'mismatch');
  const [ticked, setTicked] = React.useState({});
  const s = STATUS[t.status] || STATUS.open;
  const manual = t.expect?.type !== 'price';
  const act = (action, msg) => engine.taskAction(t.id, action).then((r) => r && cv.toast(msg));
  return (
    <div className="cv-col" style={{ gap: 8, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
      <div className="cv-row nowrap" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span className={`cv-q-ico ${s.tone}`} style={{ width: 30, height: 30 }}><Icon name={s.icon} size={15} /></span>
        <div className="cv-col" style={{ gap: 2, flex: 1 }}>
          <span className="cv-small" style={{ fontWeight: 600 }}>{t.title}</span>
          <span className="cv-xs cv-faint">{t.system} · {s.label}{t.note ? ` · ${t.note}` : ''}</span>
        </div>
        <Button size="sm" variant="ghost" icon={open ? 'ChevronUp' : 'ChevronDown'} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Steps'}</Button>
      </div>
      {open && (
        <div className="cv-col" style={{ gap: 8, paddingLeft: 40 }}>
          <ol className="cv-col" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
            {t.steps.map((step, i) => (
              <li key={i} className="cv-small">
                <label className="cv-row nowrap" style={{ gap: 8, alignItems: 'flex-start' }}>
                  {(t.status === 'open' || t.status === 'mismatch') && <input type="checkbox" checked={!!ticked[i]} onChange={(e) => setTicked({ ...ticked, [i]: e.target.checked })} aria-label={`Step ${i + 1} done`} />}
                  <span>{step}</span>
                </label>
              </li>
            ))}
          </ol>
          <div className="cv-row" style={{ gap: 8 }}>
            {(t.status === 'open' || t.status === 'mismatch') && <Button size="sm" icon="Check" onClick={() => act('done', manual ? 'Marked done. Logged with your name and the time.' : 'Marked done. The next Toast upload confirms the new price.')}>Done, it’s made</Button>}
            {t.status === 'done' && <Button size="sm" variant="secondary" icon="Undo2" onClick={() => act('reopen', 'Reopened.')}>Not done after all</Button>}
            {(t.status === 'open' || t.status === 'mismatch') && <Button size="sm" variant="ghost" onClick={() => act('cancel', 'Cancelled. Nothing was changed.')}>Cancel</Button>}
          </div>
        </div>
      )}
    </div>
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
    <section className="cv-card" aria-labelledby="tasks-head">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4" id="tasks-head">Approved changes to make</span>
          <span className="cv-small cv-muted">Coversight can’t write to these systems yet, so each approval comes with the exact steps. Tick it off when it’s made{all ? '' : ` at ${CV_ROOM.short}`}.</span>
        </div>
        <Pill tone={todo ? 'warn' : 'good'} icon={todo ? 'ListChecks' : 'CircleCheck'}>{todo ? `${todo} to do` : 'All made'}</Pill>
      </div>
      <div className="cv-col" style={{ gap: 0 }}>
        {[...live, ...recent].map((t) => <TaskRow key={`${t.id}-${t.status}`} t={t} />)}
      </div>
      {eng.mode === 'local' && <Callout icon="Info">Saved in this browser only until the server is set up.</Callout>}
    </section>
  );
}
