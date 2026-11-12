'use client';

/* Shared by more than one page (see components/screens/pages/). Page threads
   don't edit this file: ask for a shared change so it lands once. */

import * as React from 'react';
import { Button } from '../kit';
import { useCv, CV_D, CV_DS, CV_LOCS, CV_ROOM, Pill, Callout } from './core';
import { WORKER_JOBS, statusz } from '../../lib/data/pilot.js';
import { engine, useEngine } from '../engine';

/* Coversight — the live platform, as it runs in a pilot today: connecting a
   restaurant's own Toast, a test window run by the daily proof loop with the
   platform's own estimator, worker health, and an owner's data rights. Every
   figure comes from lib/data/pilot.js on the room's seed. */

const ROOM_IDS = ['oakland', 'berkeley', 'walnut'];
const GROUP_NAME = 'Rosewood Restaurant Group';
const pilotOf = (id) => CV_DS.rooms[id].pilot;
const locOf = (id) => CV_LOCS.find((l) => l.id === id);
const SAMPLE_CLIENT = 'rosewood-standard-01';

/* ================================================================ Platform health (on System) */
/* The real scheduled jobs (server mode): last run of each, Run now, recent runs, and the email outbox. */
const ago = (d) => {
  if (!d) return 'never';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 6e4);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const runSummary = (r) => {
  if (!r) return '';
  if (r.ok === false) return `failed: ${r.detail?.error ?? 'error'}`;
  const d = r.detail || {};
  if (r.job === 'detection') return `${d.rooms ?? 0} rooms re-graded${d.tasks?.verified?.length ? ` · ${d.tasks.verified.length} price change confirmed` : ''}`;
  if (r.job === 'proof') return `${d.windows ?? 0} open tests · ${d.recorded ?? 0} checkpoints recorded${d.closed?.length ? ` · ${d.closed.length} closed` : ''}`;
  if (r.job === 'reverify') return `${d.checked ?? 0} verified checked${d.reversed?.length ? ` · ${d.reversed.length} reversed` : ''}`;
  if (r.job === 'billing') return d.skipped ? `skipped (${d.skipped})` : `${d.period} drafted`;
  if (r.job === 'cleanup') return `${d.guests ?? 0} old guests removed`;
  return '';
};
const OUT_TONE = { sent: 'good', queued: 'info', held: 'info', draft: 'neutral', skipped: 'warn', failed: 'bad' };

function JobsPanel() {
  const cv = useCv();
  const [st, setSt] = React.useState(null);
  const [out, setOut] = React.useState(null);
  const [health, setHealth] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const get = (u) => fetch(u, { credentials: 'same-origin' }).then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || r.status); return b; });
  React.useEffect(() => {
    get('/api/jobs').then(setSt).catch((e) => setErr(e.message));
    get('/api/outbox').then(setOut).catch(() => setOut(null));
    fetch('/api/health').then((r) => r.json().then((b) => setHealth({ ok: r.ok, ...b }))).catch(() => setHealth({ ok: false }));
  }, []);
  const run = async (job) => {
    setBusy(job); setErr(null);
    try {
      const r = await fetch('/api/jobs', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setSt(b.status);
      cv.toast(b.result.ok ? `Ran ${job}: ${runSummary({ job, ok: true, detail: b.result.detail })}.` : `${job} failed: ${b.result.detail?.error}`);
      engine.refreshWindows(); engine.refreshNotes();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  return (
    <section className="cv-card" aria-labelledby="jobs-head">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 2 }}><span className="cv-h4" id="jobs-head">Scheduled jobs</span><span className="cv-xs cv-faint">Run by Vercel on a schedule for every group; an owner or admin can run one now for this group.</span></div>
        {health && <Pill tone={health.ok ? 'good' : 'bad'} icon={health.ok ? 'CircleCheck' : 'CircleX'}>{health.ok ? 'Database reachable' : 'Database unreachable'}</Pill>}
      </div>
      {err && <Callout tone="warn" icon="CircleX">{err}</Callout>}
      {st && (
        <div className="cv-tablewrap"><table className="cv-table">
          <thead><tr><th>Job</th><th>Runs</th><th>Last run</th><th /></tr></thead>
          <tbody>
            {st.jobs.map((j) => (
              <tr key={j.job}>
                <td><div className="cv-col" style={{ gap: 2 }}><span style={{ fontWeight: 600 }}>{j.job}</span><span className="cv-xs cv-faint">{j.what}</span></div></td>
                <td className="cv-small">{j.schedule}</td>
                <td className="cv-small">{j.last ? <span className={j.last.ok === false ? 'cv-down' : ''}>{ago(j.last.startedAt)}{j.last.trigger === 'manual' ? ' (run now)' : ''}<br /><span className="cv-xs cv-faint">{runSummary(j.last)}</span></span> : <span className="cv-faint">not yet</span>}</td>
                <td>{j.job !== 'cleanup' && <Button size="sm" variant="secondary" icon="Play" disabled={!!busy} onClick={() => run(j.job)}>{busy === j.job ? 'Running…' : 'Run now'}</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {out && (
        <div className="cv-col" style={{ gap: 6 }}>
          <div className="cv-row" style={{ justifyContent: 'space-between' }}>
            <span className="cv-over">Email outbox</span>
            <Pill tone={out.provider ? 'good' : 'warn'} icon="Mail">{out.provider ? 'Sending through Resend' : 'No email provider yet: kept, not sent'}</Pill>
          </div>
          {out.outbox.length === 0 ? <span className="cv-small cv-muted">No emails yet. Alerts email only rooms whose Fences &amp; alerts have email on.</span> : (
            <div className="cv-tablewrap"><table className="cv-table">
              <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
              <tbody>{out.outbox.slice(0, 15).map((m) => (
                <tr key={m.id}><td className="cv-small">{ago(m.createdAt)}</td><td className="cv-small">{m.toAddress || 'draft (no address)'}</td><td className="cv-small">{m.subject}</td><td><Pill tone={OUT_TONE[m.status] || 'neutral'}>{m.status}</Pill></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </section>
  );
}

function PlatformHealth() {
  const eng = useEngine();
  if (eng.mode === 'server') return <JobsPanel />;
  return <PlatformHealthDemo />;
}

function PlatformHealthDemo() {
  const [workerOk, setWorkerOk] = React.useState(true);
  const body = statusz({ workerOk, rooms: ROOM_IDS.length, failing: 0 });
  return (
    <section className="cv-card">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 2 }}><span className="cv-h4">Platform health</span><span className="cv-xs cv-faint">Demo: what the jobs look like when the server is set up (this preview runs in your browser only)</span></div>
        <div className="cv-row" style={{ gap: 8 }}>
          <Pill tone={workerOk ? 'good' : 'bad'} icon={workerOk ? 'CircleCheck' : 'CircleX'}>{workerOk ? '200 OK' : '503'}</Pill>
          <Button size="sm" variant="ghost" icon={workerOk ? 'CirclePause' : 'Play'} onClick={() => setWorkerOk(!workerOk)}>{workerOk ? 'Stop the worker' : 'Restart it'}</Button>
        </div>
      </div>
      <div className="cv-grid g2">
        <div className="cv-tablewrap"><table className="cv-table">
          <thead><tr><th>Queue</th><th>Runs</th><th>Last run</th></tr></thead>
          <tbody>
            {WORKER_JOBS.map((j) => (
              <tr key={j.queue} title={j.what}>
                <td><div className="cv-col" style={{ gap: 2 }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>{j.queue}</span><span className="cv-xs cv-faint">{j.what}</span></div></td>
                <td className="cv-small">{j.schedule}</td>
                <td className="cv-small">{!workerOk && j.queue !== 'toast-backfill' ? <span className="cv-down">overdue</span> : j.last}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="cv-col" style={{ gap: 8 }}>
          <div className="cv-formula" style={{ fontSize: 'var(--text-xs)' }}>{`GET /statusz → ${workerOk ? 200 : 503}\n${JSON.stringify(body, null, 2)}`}</div>
          <span className="cv-xs cv-faint">Secret-free and platform-wide: no restaurant's data leaves it. A dead worker means no syncs and no checkpoints, so the monitor pages the pilot runner; syncs catch up from their cursors on restart.</span>
        </div>
      </div>
    </section>
  );
}

/** One line on Sources linking to the connection. */
function ToastConnectionLine() {
  const cv = useCv();
  const t = CV_D.room.fromToast;
  if (t) return <Callout tone="good" icon="PlugZap"><span>{CV_ROOM.name} runs on its own Toast data exports through {t.end} ({t.weeks} weeks). Upload the latest each week on <button className="cv-link" onClick={() => cv.go('inputs')}>Data inputs</button>; the live API sync arrives with Toast credentials.</span></Callout>;
  if (!CV_D.ownData) return <Callout icon="FlaskConical"><span>{CV_ROOM.name} is on sample data. Load your Toast data exports on <button className="cv-link" onClick={() => cv.go('inputs')}>Data inputs</button> to put every figure on your own numbers.</span></Callout>;
  return <Callout icon="PencilLine"><span>{CV_ROOM.name} has data entered by hand; the rest is still sample. Load your Toast data exports on <button className="cv-link" onClick={() => cv.go('inputs')}>Data inputs</button> for sales, team and timings.</span></Callout>;
}

export { ROOM_IDS, GROUP_NAME, pilotOf, locOf, SAMPLE_CLIENT, ago, runSummary, OUT_TONE, JobsPanel, PlatformHealth, PlatformHealthDemo, ToastConnectionLine };
