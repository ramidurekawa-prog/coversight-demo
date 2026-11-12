'use client';

import { Icon, Button } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { buildOwnQueue } from '../../../lib/data/queue';
import { dataEnd as roomDataEnd } from '../../../lib/data/readers';
import { TasksPanel } from '../tasks';
import { useCv, cvFill, CV_D, CV_ROOM, CV_NOW, Claim, PageHead } from '../core';
import { DenseToday } from '../dense-sections';

/* ================================================================ Today (work queue) */
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

function CvToday() {
  const cv = useCv();
  const eng = useEngine();
  const today = todayIso();
  const own = !!CV_D.room.fromToast;
  const [dismissed] = useSaved('findings', {});
  /* A room on its own Toast data gets a queue built from that data every day; the sample keeps its written one. */
  const queue = own
    ? buildOwnQueue(CV_D, { today, dataEnd: roomDataEnd(CV_D.room), dismissed, testing: (eng.windows || []).filter((w) => w.roomId === CV_D.id && (w.status === 'running' || w.status === 'waiting')).map((w) => w.lever) })
    : CV_D.queue.map((q) => ({ ...q, title: cvFill(q.title), value: cvFill(q.value), body: cvFill(q.body) }));
  const [stored, setSaved] = useSaved('queue', { done: {}, refused: {} });
  /* Cleared cards count for the day they were cleared; "not for us" lasts 90 days. */
  const done = Object.fromEntries(Object.entries(stored.done || {}).filter(([, at]) => !own || new Date(at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) === today));
  const refused = Object.fromEntries(Object.entries(stored.refused || {}).filter(([, at]) => Date.now() - new Date(at).getTime() < 90 * 864e5));
  const mark = (q, which, summary) => setSaved((s) => ({ ...s, [which]: { ...s[which], [q.id]: new Date().toISOString() } }), summary);
  const left = queue.filter((q) => !done[q.id] && !refused[q.id]);
  const minsLeft = left.reduce((s, q) => s + q.mins, 0);
  const finish = (q, label) => { mark(q, 'done', label || `${q.title} — done`); cv.toast(label || `${q.title} — done`); };
  return (
    <div className="cv-page" style={{ maxWidth: 860 }}>
      <PageHead over={`${CV_ROOM.name} · ${own ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' }) : CV_NOW.label}`} q={minsLeft ? `Clear this in about ${minsLeft} minutes` : 'Nothing needs you today'}
        sub={own ? `Built this morning from your Toast data through ${roomDataEnd(CV_D.room)}. Each card is one decision, with what it's worth and how long it takes.` : "A work queue, not a dashboard. Each card is one decision, with what it's worth and how long it takes."} />
      <TasksPanel />
      <div className="cv-col" style={{ gap: 8 }}>
        <div className="cv-row" style={{ justifyContent: 'space-between' }}>
          <span className="cv-small cv-muted">{queue.length - left.length} of {queue.length} cleared</span>
          <span className="cv-small cv-num cv-muted">{minsLeft ? `about ${minsLeft} min left` : 'all clear'}</span>
        </div>
        <div className="progress"><span style={{ width: `${queue.length ? ((queue.length - left.length) / queue.length) * 100 : 100}%` }} /></div>
      </div>
      {left.length === 0 ? (
        <div className="cv-empty">
          <span className="ico"><Icon name="Check" size={22} /></span>
          <span className="cv-h3">Queue clear</span>
          <span className="cv-small cv-muted" style={{ maxWidth: 380 }}>{own ? 'Nothing else needs you today. Tomorrow’s queue is built overnight from your latest data.' : 'Nothing else needs you today. The next check is Thursday at 9 am, when overtime for the weekend is still preventable.'}</span>
          <Button variant="secondary" size="sm" onClick={() => setSaved({ done: {}, refused: {} }, 'Queue reset')}>{own ? 'Show today’s cards again' : 'Reset the demo'}</Button>
        </div>
      ) : (
        <div className="cv-col" style={{ gap: 10 }}>
          {queue.map((q) => {
            if (done[q.id] || refused[q.id]) return null;
            return (
              <article key={q.id} className="cv-q-card">
                <span className={`cv-q-ico ${q.tone}`}><Icon name={q.icon} size={18} /></span>
                <div className="cv-col" style={{ gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>{q.title}</span>
                  <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{q.body}</span>
                  <div className="cv-row" style={{ gap: 8 }}>
                    <Claim k={q.claim} /><span className="cv-xs cv-num cv-muted">{q.value}</span>
                    <span className="cv-xs cv-faint">· {q.mins} min</span>
                  </div>
                </div>
                <div className="cv-q-acts">
                  {q.refuse && <Button variant="ghost" size="sm" onClick={() => { mark(q, 'refused', `${q.title}: not for us`); cv.toast('Noted. We won’t suggest this again for 90 days.'); }}>Not for us</Button>}
                  {!q.refuse && <Button variant="ghost" size="sm" onClick={() => finish(q, 'Snoozed until tomorrow')}>Snooze</Button>}
                  <Button size="sm" onClick={() => {
                    if (q.approval) cv.approve(q.approval, () => mark(q, 'done', `${q.title}: approved`));
                    else if (q.start) engine.startWindow(q.start).then((r) => { if (r.ok) { mark(q, 'done', `${q.title}: started`); cv.toast('Test started. The baseline is frozen; each new week of Toast data is a checkpoint.'); } else cv.toast(r.error); });
                    else if (q.go === 'finding') cv.go('finding', { id: q.goId });
                    else if (q.go) cv.go(q.go, q.input ? { kind: q.input } : undefined);
                    else finish(q);
                  }}>{q.primary}</Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <DenseToday />
    </div>
  );
}

export { CvToday };
