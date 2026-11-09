'use client';

import * as React from 'react';

import { Icon, Button, Tabs } from '../kit';
import { useCv, cvMoney, CV_D, CV_DS, CV_LOCS, CV_PROOF, CV_ROOM, Claim, Pill, Callout, Interval, PageHead, cvScale } from './core';
import { windowState, METHOD_LABEL, MAGNITUDE_FLOOR_PCT, WORKER_JOBS, statusz, TOAST_ERRORS } from '../../lib/data/pilot.js';

/* Coversight — the live platform, as it runs in a pilot today: connecting a
   restaurant's own Toast, a test window run by the daily proof loop with the
   platform's own estimator, worker health, and an owner's data rights. Every
   figure comes from lib/data/pilot.js on the room's seed. */

const ROOM_IDS = ['oakland', 'berkeley', 'walnut'];
const GROUP_NAME = 'Rosewood Restaurant Group';
const pilotOf = (id) => CV_DS.rooms[id].pilot;
const locOf = (id) => CV_LOCS.find((l) => l.id === id);

/* ================================================================ Connect Toast */
const HOW_TO = [
  'In Toast Web, open Integrations → Toast API access → Manage credentials.',
  'Create Standard API credentials (read-only scopes: orders, menus, labor, restaurants, config).',
  'Copy the Client ID, Client secret (shown once) and API hostname into the form below.',
  'Your restaurant GUIDs are in the confirmation email Toast sends after the credentials activate.',
];
const SAMPLE_CLIENT = 'rosewood-standard-01';

function checkCredentials(form) {
  const host = form.host.trim().toLowerCase();
  if (!/(^|\.)toasttab\.com$/.test(host)) return { authenticated: false, error: TOAST_ERRORS.host };
  if (form.clientId.trim() !== SAMPLE_CLIENT) return { authenticated: false, error: TOAST_ERRORS.secret };
  const guids = form.guids.split(/[\s,]+/).map((g) => g.trim()).filter(Boolean);
  return {
    authenticated: true,
    restaurants: guids.map((g) => {
      const id = ROOM_IDS.find((r) => pilotOf(r).toast.guid === g);
      return id ? { guid: g, ok: true, id, name: locOf(id).name, tz: pilotOf(id).toast.tz } : { guid: g, ok: false, error: TOAST_ERRORS.guid };
    }),
  };
}

function CvConnect() {
  const cv = useCv();
  const canManage = cv.role === 'owner';
  const [mode, setMode] = React.useState('status'); // status | form
  const [conn, setConn] = React.useState({ connected: true, state: 'syncing', rooms: ROOM_IDS, lastError: null, alerted: false });
  const [form, setForm] = React.useState({ host: 'ws-api.toasttab.com', clientId: '', secret: '', guids: '' });
  const [check, setCheck] = React.useState(null);
  const [mapping, setMapping] = React.useState({});
  const [busy, setBusy] = React.useState(null);
  const [confirmOff, setConfirmOff] = React.useState(false);
  const update = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setCheck(null); };
  const ready = form.host && form.clientId && form.secret && form.guids.trim();
  const allGood = check && check.authenticated && check.restaurants.length > 0 && check.restaurants.every((r) => r.ok);
  const fillSample = () => {
    setForm({ host: 'ws-api.toasttab.com', clientId: SAMPLE_CLIENT, secret: 'sample-secret-shown-once', guids: ROOM_IDS.map((id) => pilotOf(id).toast.guid).join('\n') });
    setCheck(null);
  };
  const runCheck = () => {
    setBusy('check');
    setTimeout(() => {
      const c = checkCredentials(form);
      setCheck(c);
      if (c.authenticated) setMapping(Object.fromEntries(c.restaurants.filter((r) => r.ok).map((r) => [r.guid, r.id])));
      setBusy(null);
    }, 700);
  };
  const connect = () => {
    setBusy('connect');
    setTimeout(() => {
      setConn({ connected: true, state: 'pending', rooms: check.restaurants.map((r) => r.id), lastError: null, alerted: false });
      setForm((f) => ({ ...f, secret: '' }));
      setMode('status');
      setBusy(null);
      cv.toast('Connected. The first sync (13 weeks of history) starts within 15 minutes.');
    }, 800);
  };
  const firstSync = () => {
    setBusy('sync');
    setTimeout(() => { setConn((c) => ({ ...c, state: 'syncing' })); setBusy(null); }, 1400);
  };
  const pulled = conn.rooms.reduce((s, id) => {
    const b = pilotOf(id).toast.backfill;
    return { checks: s.checks + b.checks, shifts: s.shifts + b.shifts, weeks: b.weeks };
  }, { checks: 0, shifts: 0, weeks: 0 });
  const failing = conn.state === 'failing';
  const headline = !conn.connected ? 'Not connected' : failing ? 'Sync failing' : conn.state === 'pending' ? 'Connected — first sync pending' : 'Syncing every 15 minutes';

  return (
    <div className="cv-page">
      <PageHead over={`Connect your POS · ${GROUP_NAME}`} q="How does a restaurant's own Toast data get in?"
        sub="This is the live platform's onboarding, step for step. The owner creates read-only Standard API credentials in Toast Web and pastes them here. Check reads each restaurant without saving anything; Connect saves, and the first sync pulls 13 weeks of history." />
      {!canManage && <Callout icon="Lock">Only the restaurant owner can connect or change the Toast connection. Switch to the Owner view in the top bar to try it.</Callout>}

      <section className="cv-card">
        <div className="cv-card-head">
          <div className="cv-row" style={{ gap: 10 }}>
            <Icon name={failing ? 'TriangleAlert' : conn.connected ? 'PlugZap' : 'Plug'} size={20} />
            <div className="cv-col" style={{ gap: 2 }}>
              <span className="cv-h4">Toast · {headline}</span>
              {conn.connected && <span className="cv-xs cv-faint">Standard API access · client {SAMPLE_CLIENT.slice(0, 4)}… · ws-api.toasttab.com</span>}
            </div>
          </div>
          <Pill tone={failing ? 'bad' : !conn.connected ? 'neutral' : conn.state === 'pending' ? 'warn' : 'good'} icon={failing ? 'CircleX' : conn.state === 'pending' ? 'Hourglass' : conn.connected ? 'CircleCheck' : 'CircleMinus'}>
            {failing ? 'Failing' : !conn.connected ? 'Off' : conn.state === 'pending' ? 'Pending' : 'Healthy'}
          </Pill>
        </div>
        {conn.lastError && <Callout tone="bad" icon="CircleX">{conn.lastError}</Callout>}
        {conn.connected && (
          <dl className="cv-kv">
            <dt>History pulled</dt><dd>{conn.state === 'pending' ? '—' : `${pilotOf(conn.rooms[0]).toast.backfilledAt} · ${pulled.weeks} weeks`}</dd>
            <dt>Checks and shifts pulled</dt><dd>{conn.state === 'pending' ? '—' : `${pulled.checks.toLocaleString()} checks · ${pulled.shifts.toLocaleString()} shifts`}</dd>
            <dt>Last successful sync</dt><dd>{conn.state === 'pending' ? '—' : failing ? '6:45 pm' : pilotOf(conn.rooms[0]).toast.lastSyncAt}</dd>
            <dt>Locations</dt><dd style={{ fontFamily: 'var(--font-sans)' }}>{conn.rooms.map((id) => locOf(id).short).join(', ')}</dd>
          </dl>
        )}
        {canManage && (
          <div className="cv-row" style={{ gap: 8 }}>
            {conn.state === 'pending' && <Button size="sm" icon="RefreshCw" disabled={busy === 'sync'} onClick={firstSync}>{busy === 'sync' ? 'Pulling 13 weeks…' : 'Run the first sync now'}</Button>}
            <Button size="sm" variant="secondary" icon="PenLine" onClick={() => { setMode(mode === 'form' ? 'status' : 'form'); setCheck(null); }}>{mode === 'form' ? 'Cancel' : conn.connected ? 'Update credentials' : 'Connect Toast'}</Button>
            {conn.connected && !failing && conn.state === 'syncing' && (
              <Button size="sm" variant="ghost" icon="TriangleAlert" onClick={() => setConn((c) => ({ ...c, state: 'failing', lastError: TOAST_ERRORS.secret, alerted: true }))}>Simulate revoked credentials</Button>
            )}
            {conn.connected && !confirmOff && <Button size="sm" variant="ghost" icon="CircleMinus" onClick={() => setConfirmOff(true)}>Disconnect</Button>}
          </div>
        )}
        {confirmOff && (
          <Callout tone="warn" icon="CircleMinus">
            <span>Stop syncing from Toast? Data already pulled stays. </span>
            <span className="cv-row" style={{ gap: 8, marginTop: 8 }}>
              <Button size="sm" variant="secondary" onClick={() => { setConn({ connected: false, state: 'off', rooms: [], lastError: null, alerted: false }); setConfirmOff(false); cv.toast('Disconnected. Nothing new will sync until you connect again.'); }}>Disconnect</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmOff(false)}>Keep syncing</Button>
            </span>
          </Callout>
        )}
        {conn.alerted && (
          <div className="cv-formula" style={{ fontSize: 'var(--text-xs)' }}>
            {`To: ALERT_EMAIL (the pilot runner)\nSubject: Toast sync failing — ${GROUP_NAME}\n\n${TOAST_ERRORS.secret}\nAt most one email per problem every 6 hours. Fix: the owner creates new credentials → Update credentials.`}
          </div>
        )}
      </section>

      {mode === 'form' && canManage && (
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Connect Toast</span><Button size="sm" variant="ghost" icon="FlaskConical" onClick={fillSample}>Fill in sample credentials</Button></div>
          <ol className="cv-small cv-muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>{HOW_TO.map((s) => <li key={s}>{s}</li>)}</ol>
          <div className="cv-grid g2">
            {[['host', 'API hostname', 'text'], ['clientId', 'Client ID', 'text'], ['secret', 'Client secret', 'password']].map(([k, label, type]) => (
              <label key={k} className="cv-col" style={{ gap: 4 }}>
                <span className="cv-small" style={{ fontWeight: 600 }}>{label}</span>
                <input className="input" type={type} value={form[k]} autoComplete="off" spellCheck={false} onChange={(e) => update(k, e.target.value)} />
              </label>
            ))}
          </div>
          <label className="cv-col" style={{ gap: 4 }}>
            <span className="cv-small" style={{ fontWeight: 600 }}>Restaurant GUIDs (one per line)</span>
            <textarea className="input" rows={3} value={form.guids} spellCheck={false} onChange={(e) => update('guids', e.target.value)} style={{ height: 'auto', padding: 10, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }} />
          </label>
          {check && !check.authenticated && <Callout tone="bad" icon="CircleX">{check.error}</Callout>}
          {check && check.authenticated && (
            <div className="cv-col" style={{ gap: 6 }} role="status">
              {check.restaurants.map((r) => (
                <div key={r.guid} className="cv-row" style={{ gap: 10, justifyContent: 'space-between' }}>
                  <span className="cv-row" style={{ gap: 6 }}>
                    <Icon name={r.ok ? 'CircleCheck' : 'CircleX'} size={16} className={r.ok ? 'ok' : 'no'} />
                    <b>{r.ok ? r.name : r.guid}</b>
                    <span className="cv-small cv-muted">{r.ok ? ` · ${r.tz}` : ` — ${r.error}`}</span>
                  </span>
                  {r.ok && (
                    <select className="input" aria-label={`Location for ${r.name}`} style={{ width: 'auto', height: 32 }} value={mapping[r.guid] ?? ''} onChange={(e) => setMapping({ ...mapping, [r.guid]: e.target.value })}>
                      <option value="">New location</option>
                      {ROOM_IDS.map((id) => <option key={id} value={id}>Use “{locOf(id).short}”</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="cv-row" style={{ gap: 8 }}>
            <Button variant="secondary" disabled={!ready || !!busy} onClick={runCheck}>{busy === 'check' ? 'Checking…' : 'Check'}</Button>
            <Button disabled={!ready || !!busy || !allGood} onClick={connect}>{busy === 'connect' ? 'Connecting…' : 'Connect'}</Button>
            <span className="cv-xs cv-faint">Read-only. The secret is encrypted when saved and never shown again.</span>
          </div>
        </section>
      )}

      <div className="cv-grid g2">
        <section className="cv-card">
          <span className="cv-h4">What the connection gives you in two weeks</span>
          <ul className="cv-ul">
            <li><Icon name="Users" size={15} />Labour and overtime findings, from clock-ins and wages</li>
            <li><Icon name="Receipt" size={15} />Voids and comps against the room's own normal rate</li>
            <li><Icon name="UtensilsCrossed" size={15} />Menu margin and mix, once recipe costs are uploaded</li>
            <li><Icon name="Armchair" size={15} />Table turns, as estimated leads that never count toward recovered dollars</li>
          </ul>
        </section>
        <section className="cv-card">
          <span className="cv-h4">What not to promise yet</span>
          <ul className="cv-ul">
            <li><Icon name="Clock" size={15} />To-the-minute numbers. Data arrives in 15-minute polls until Toast partner access is approved.</li>
            <li><Icon name="ChefHat" size={15} />Ticket times. Toast's Standard API carries no kitchen-display timings.</li>
            <li><Icon name="Lock" size={15} />The client secret is sealed with the platform key, never returned, never exported.</li>
          </ul>
        </section>
      </div>
      <Callout icon="FileSpreadsheet">
        <span>Margin findings also need what each plate costs; Toast only knows the price. <button className="cv-link" onClick={() => cv.go('inputs', { kind: 'recipes' })}>Upload recipe costs</button> as a two-column sheet. Names that don't match a dish come back by name, and every upload is dated so older weeks keep their older costs.</span>
      </Callout>
    </div>
  );
}

/* ================================================================ Test windows */
const STATUS = {
  running: { label: 'Running', tone: 'info', icon: 'Timer' },
  waiting: { label: 'Waiting on data', tone: 'warn', icon: 'CirclePause' },
  verified: { label: 'Verified', tone: 'good', icon: 'BadgeCheck' },
  rejected: { label: 'Rejected', tone: 'bad', icon: 'CircleX' },
  reversed: { label: 'Reversed', tone: 'bad', icon: 'Undo2' },
};
const fmtUnit = (p, v, signed = false) => {
  const s = signed && v > 0 ? '+' : '';
  if (p.unit === '$') return `${s}${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(Math.abs(p.baseline) < 100 ? 2 : 0)}`;
  return `${s}${v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)} ${p.unit}`;
};
const dollars = (c) => Math.round(c / 100);

function CheckpointChart({ p, w, controls }) {
  const W = 1000, H = 220, P = { l: 64, r: 16, t: 14, b: 28 };
  const pts = p.checkpoints.map((c) => ({ ...c, adj: c.observed - (controls ? c.controlDelta : 0) }));
  const vals = [p.baseline, ...pts.map((c) => c.observed), ...pts.map((c) => c.adj)];
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.2 || 1;
  const x = cvScale(0, 35, P.l, W - P.r), y = cvScale(lo - pad, hi + pad, H - P.b, P.t);
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.metric}: baseline and weekly checkpoints`}>
      <line className="grid" x1={P.l} x2={W - P.r} y1={y(p.baseline)} y2={y(p.baseline)} strokeDasharray="4 3" />
      <text x={P.l - 6} y={y(p.baseline) + 3} textAnchor="end">{fmtUnit(p, p.baseline)}</text>
      <text className="lbl" x={W - P.r} y={y(p.baseline) - 6} textAnchor="end">baseline, 4 weeks before Start</text>
      <rect x={x(0)} y={P.t} width={x(28) - x(0)} height={H - P.b - P.t} fill="var(--accent)" opacity="0.05" />
      <line className="axis" x1={x(w.day)} x2={x(w.day)} y1={P.t} y2={H - P.b} stroke="var(--accent)" />
      {[0, 7, 14, 21, 28, 35].map((d) => <text key={d} x={x(d)} y={H - 8} textAnchor="middle">{d === 0 ? 'Start' : `day ${d}`}</text>)}
      {pts.map((c) => {
        const done = c.day <= w.day;
        return (
          <g key={c.day} opacity={done ? 1 : 0.3}>
            {controls && <line x1={x(c.day)} x2={x(c.day)} y1={y(c.observed)} y2={y(c.adj)} stroke="var(--fg-3)" strokeDasharray="2 2" />}
            <circle cx={x(c.day)} cy={y(c.observed)} r={controls ? 3.5 : 5} fill={controls ? 'var(--surface)' : 'var(--accent)'} stroke="var(--accent)" strokeWidth="1.5" />
            {controls && <circle cx={x(c.day)} cy={y(c.adj)} r="5" fill="var(--accent)" />}
          </g>
        );
      })}
    </svg>
  );
}

function CvWindows() {
  const cv = useCv();
  const roomId = cv.loc === 'all' ? 'oakland' : cv.loc;
  const p = pilotOf(roomId);
  const TODAY = 21;
  const [day, setDay] = React.useState(TODAY);
  const [controls, setControls] = React.useState(false);
  const [breach, setBreach] = React.useState(false);
  const [feedFailing, setFeedFailing] = React.useState(false);
  React.useEffect(() => { setDay(TODAY); setBreach(false); setFeedFailing(false); }, [roomId]);
  const w = windowState(p, { day, controls, breach, feedFailing });
  const st = STATUS[w.status];
  const e = w.effect;
  const d = w.recorded.map((c) => p.sign * (c.observed - p.baseline) - (controls ? p.sign * c.controlDelta : 0));
  const showInterval = e.n >= 2;
  return (
    <div className="cv-page wide">
      <PageHead over={`Live platform · ${locOf(roomId).name}`} q="How does a test run on the platform today?"
        sub="The pilot's proof loop, computed in your browser with the platform's own estimator. A window opens when the owner presses Start, a checkpoint lands every 7 days, and at day 28 it closes Verified at the lower bound of its interval, or Rejected. Drag the day to run it forward."
        right={cv.loc === 'all' && <Pill icon="Building2">Showing Oakland; pick a room in the top bar</Pill>} />

      <section className="cv-card">
        <div className="cv-card-head">
          <div className="cv-col" style={{ gap: 2 }}>
            <span className="cv-over">{p.lever} · started {p.start.label} · closes Nov 3</span>
            <span className="cv-h4">{p.action}</span>
          </div>
          <Pill tone={st.tone} icon={st.icon}>{st.label}</Pill>
        </div>
        <dl className="cv-kv">
          <dt>Metric</dt><dd style={{ fontFamily: 'var(--font-sans)' }}>{p.metric} · {p.direction === 'down' ? 'down is better' : 'up is better'}</dd>
          <dt>Baseline (frozen at Start)</dt><dd>{fmtUnit(p, p.baseline)}</dd>
          <dt>Dollars per unit, fixed at Start</dt><dd style={{ fontFamily: 'var(--font-sans)' }}>{p.convert}</dd>
          <dt>Method</dt><dd style={{ fontFamily: 'var(--font-sans)' }}>{METHOD_LABEL[e.method]}</dd>
        </dl>
      </section>

      <section className="cv-card">
        <div className="cv-row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <label className="cv-col" style={{ gap: 4, flex: 1, minWidth: 220 }}>
            <span className="cv-small" style={{ fontWeight: 600 }}>Day {day} since Start{day === TODAY ? ' · today' : day > p.windowDays ? ' · after the window' : day > TODAY ? ' · ahead of today, from the sample' : ''}</span>
            <input type="range" min={0} max={35} step={1} value={day} onChange={(ev) => setDay(+ev.target.value)} aria-label="Day since Start" style={{ accentColor: "var(--accent)" }} />
          </label>
          <Tabs value={controls ? 'did' : 'ba'} onChange={(v) => setControls(v === 'did')} tabs={[{ value: 'ba', label: 'Platform today' }, { value: 'did', label: 'With matched controls' }]} />
        </div>
        <div className="cv-row cv-small" style={{ gap: 16 }}>
          <label className="cv-row nowrap" style={{ gap: 6 }}><input type="checkbox" checked={feedFailing} onChange={(ev) => setFeedFailing(ev.target.checked)} />Toast sync failing</label>
          <label className="cv-row nowrap" style={{ gap: 6 }}><input type="checkbox" checked={breach} onChange={(ev) => setBreach(ev.target.checked)} />Average check falls 7% after it closes</label>
        </div>
        <CheckpointChart p={p} w={w} controls={controls} />
        <span className="cv-xs cv-faint">{controls ? 'Hollow dots are the room as observed; solid dots subtract what matched control services did over the same stretch. ' : 'Each dot is one weekly checkpoint against the frozen baseline. '}The shaded band is the 28-day window.</span>
      </section>

      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-over">{w.status === 'verified' ? 'Booked, per week' : w.status === 'reversed' ? 'Removed' : 'Running estimate, per week'}</span><Claim k={w.status === 'verified' ? 'book' : e.n ? 'cau' : 'none'} /></div>
          <span className={`cv-fig xl ${w.status === 'verified' ? 'cv-up' : w.status === 'reversed' ? 'cv-down' : ''}`}>
            {w.status === 'verified' ? cvMoney(dollars(w.bookedCents)) : w.status === 'reversed' ? `−${cvMoney(dollars(e.bookableWeeklyCents))}` : e.n ? cvMoney(dollars(e.pointCents)) : '—'}
          </span>
          {showInterval && <Interval lo={dollars(e.lowCents)} pt={dollars(e.pointCents)} hi={dollars(e.highCents)} min={Math.min(0, dollars(e.lowCents)) - 10} max={dollars(e.highCents) + 10} billedLabel={w.status === 'verified' ? 'booked' : 'what would book'} />}
          {e.n === 1 && <Callout icon="Hourglass">One checkpoint has no spread to measure, so nothing would book yet.</Callout>}
          {e.n === 0 && <Callout icon="Timer">Window open. The first checkpoint lands on day 7 ({p.checkpoints[0].date}).</Callout>}
          {w.status === 'waiting' && <Callout tone="warn" icon="CirclePause">The Toast feed is failing, so the window waits rather than fails. The pilot runner already has an alert email; the window picks up from its cursor once credentials are updated.</Callout>}
          {w.status === 'rejected' && <Callout tone="bad" icon="CircleX">Closed Rejected: {w.gates.filter((g) => !g.ok).map((g) => g.label.toLowerCase()).join(', ')}. Nothing books.</Callout>}
          {w.status === 'reversed' && <Callout tone="bad" icon="Undo2">The weekly reverification found average check down {Math.abs(w.guard.rows[0].pct).toFixed(1)}%, past the 5% limit. The verified dollars are reversed.</Callout>}
        </section>
        <section className="cv-card">
          <span className="cv-h4">Four gates</span>
          <div className="cv-col" style={{ gap: 10 }}>
            {w.gates.map((g) => (
              <div key={g.key} className="cv-row nowrap" style={{ gap: 8, alignItems: 'flex-start' }}>
                <Icon name={g.ok ? 'CircleCheck' : g.pending ? 'CircleDot' : 'CircleX'} size={17} className={g.ok ? 'ok' : g.pending ? 'warn' : 'no'} />
                <div className="cv-col" style={{ gap: 2 }}><span className="cv-small" style={{ fontWeight: 600 }}>{g.label}</span><span className="cv-xs cv-faint">{g.detail}</span></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="cv-table">
            <thead><tr><th>Checkpoint</th><th className="r">Observed</th><th className="r">Move vs baseline</th><th className="r">Control Δ</th><th className="r">Services</th><th className="r">Effect counted</th><th>State</th></tr></thead>
            <tbody>
              {p.checkpoints.map((c, i) => {
                const done = c.day <= day;
                const dpct = (p.sign * (c.observed - p.baseline) / Math.abs(p.baseline)) * 100;
                return (
                  <tr key={c.day} style={{ opacity: done ? 1 : 0.45 }}>
                    <td>{c.date} · day {c.day}</td>
                    <td className="r">{fmtUnit(p, c.observed)}</td>
                    <td className="r">{dpct >= 0 ? '+' : '−'}{Math.abs(dpct).toFixed(1)}%</td>
                    <td className="r">{controls ? fmtUnit(p, c.controlDelta, true) : '—'}</td>
                    <td className="r">{c.services}</td>
                    <td className="r">{done ? fmtUnit(p, d[i] ?? 0, true) : '—'}</td>
                    <td className="cv-small cv-muted">{done ? 'Recorded by the proof loop' : 'Due'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="cv-grid g2">
        <section className="cv-card">
          <span className="cv-h4">The arithmetic</span>
          <div className="cv-formula" style={{ fontSize: 'var(--text-xs)' }}>
            {`d_i = ${p.sign > 0 ? '+' : '−'}(observed − baseline)${controls ? ` ${p.sign > 0 ? '−' : '+'} control Δ` : ''}\n`}
            {e.n ? `d = [${d.map((x) => x.toFixed(2)).join(', ')}]   n = ${e.n}\nmean = ${e.pointUnits.toFixed(2)}` : 'no checkpoints yet'}
            {e.n >= 2 ? `\n90% interval = mean ± t(${e.n - 1}) × sd/√n = [${e.lowUnits.toFixed(2)}, ${e.highUnits.toFixed(2)}]\n× ${p.centsPerUnitWeek}¢ per unit a week = [${cvMoney(dollars(e.lowCents))}, ${cvMoney(dollars(e.highCents))}]/wk\nbooks max($0, lower bound) = ${cvMoney(dollars(e.bookableWeeklyCents))}/wk` : ''}
          </div>
          <span className="cv-xs cv-faint">Gate 1 floor: each of the last two moves at least {MAGNITUDE_FLOOR_PCT}% of the baseline, with 5 or more services compared.</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Weekly guardrail check</span><span className="cv-xs cv-faint">Set at this room's first window</span></div>
          <div className="cv-tablewrap"><table className="cv-table">
            <thead><tr><th>Guardrail</th><th className="r">Baseline</th><th className="r">This week</th><th>Limit</th><th /></tr></thead>
            <tbody>
              {w.guard.rows.map((g) => (
                <tr key={g.key}>
                  <td>{g.label}</td>
                  <td className="r">{g.unit === '$' ? `$${g.base.toFixed(2)}` : `${g.base} min`}</td>
                  <td className="r">{g.unit === '$' ? `$${g.now.toFixed(2)}` : `${g.now} min`} <span className="cv-xs cv-faint">({g.pct >= 0 ? '+' : '−'}{Math.abs(g.pct).toFixed(1)}%)</span></td>
                  <td className="cv-small cv-muted">{g.limit}</td>
                  <td><Icon name={g.ok ? 'CircleCheck' : 'CircleX'} size={16} className={g.ok ? 'ok' : 'no'} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      </div>

      <Callout tone="warn" icon="TriangleAlert">
        What the live platform doesn't do yet, and the finished screens assume: it opens the window when the owner presses Start rather than on evidence the change happened; no reader supplies matched controls, so every real window today is a before/after; and it records 3 of the 10 verification outcomes, so "couldn't tell" and "didn't work" both close as Rejected. <button className="cv-link" onClick={() => cv.go('proof')}>See the finished Proof screen</button>
      </Callout>
    </div>
  );
}

/* ================================================================ Platform health (on System) */
function PlatformHealth() {
  const [workerOk, setWorkerOk] = React.useState(true);
  const body = statusz({ workerOk, rooms: ROOM_IDS.length, failing: 0 });
  return (
    <section className="cv-card">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 2 }}><span className="cv-h4">Platform health</span><span className="cv-xs cv-faint">What the live platform's worker runs, and what an uptime monitor sees on /statusz every 5 minutes</span></div>
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

/* ================================================================ Your data */
function exportBundle() {
  const rooms = ROOM_IDS.map((id) => {
    const r = CV_DS.rooms[id];
    return {
      location: { name: r.profile.name, address: r.profile.addr, tz: r.pilot.toast.tz },
      menuItems: r.menu.map(({ name, cat, price, cost, units }) => ({ name, category: cat, price, cost, unitsPerWeek: units })),
      invoices: r.invoices, staff: r.staff, weeklyHistory: r.history, counts: r.counts, waste: r.waste, channels: r.channels,
      testWindows: [{ action: r.pilot.action, metric: r.pilot.metric, baseline: r.pilot.baseline, checkpoints: r.pilot.checkpoints }],
    };
  });
  return {
    exportedAt: new Date().toISOString(),
    format: 'coversight-export/v1',
    org: { name: GROUP_NAME, sample: true },
    toastConnection: { mode: 'standard', apiBaseUrl: 'https://ws-api.toasttab.com', clientId: SAMPLE_CLIENT, status: 'healthy' },
    locations: rooms,
    verifications: CV_PROOF.map(({ id, loc, title, outcome, bookable, lo, hi, point, since }) => ({ id, loc, title, outcome, bookable, lo, hi, point, since })),
  };
}

function CvData() {
  const cv = useCv();
  const canManage = cv.role === 'owner';
  const [typed, setTyped] = React.useState('');
  const [deleted, setDeleted] = React.useState(false);
  const bundle = React.useMemo(exportBundle, []);
  const sizes = [
    ['Locations', bundle.locations.length],
    ['Menu items', bundle.locations.reduce((s, l) => s + l.menuItems.length, 0)],
    ['Invoice lines', bundle.locations.reduce((s, l) => s + l.invoices.length, 0)],
    ['Staff', bundle.locations.reduce((s, l) => s + l.staff.length, 0)],
    ['Weeks of history', bundle.locations.reduce((s, l) => s + l.weeklyHistory.length, 0)],
    ['Test windows', bundle.locations.length],
    ['Verifications', bundle.verifications.length],
  ];
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'coversight-export-rosewood-sample.json';
    a.click();
    URL.revokeObjectURL(url);
    cv.toast('Export downloaded: everything Coversight holds for this group, as plain JSON.');
  };
  return (
    <div className="cv-page">
      <PageHead over={`Your data · ${GROUP_NAME}`} q="Can I take my data with me, or have it deleted?"
        sub="Yes, both, any time, from the owner's settings. The live platform builds the export from every table that belongs to the group, and deletes children before parents in one transaction." />
      <div className="cv-grid g2">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Download all your data</span><Pill icon="FileOutput">coversight-export/v1</Pill></div>
          <dl className="cv-kv">{sizes.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v.toLocaleString()}</dd></React.Fragment>)}</dl>
          <Button icon="Download" disabled={!canManage} onClick={download}>Download all your data</Button>
          <span className="cv-xs cv-faint">Never included: the Toast client secret (it isn't yours to need back; it lives in Toast) and raw Toast payloads (bulky, and re-pullable from Toast).</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Delete the organization</span><Pill tone="bad" icon="Trash2">Irreversible</Pill></div>
          {deleted ? (
            <>
              <Callout tone="bad" icon="Trash2">Deleted: {GROUP_NAME}, its rooms, Toast connection, findings, actions, windows, verifications and history. User logins remain, without this group. (Nothing was really deleted; this is the sample.)</Callout>
              <Button size="sm" variant="secondary" icon="RotateCcw" onClick={() => { setDeleted(false); setTyped(''); }}>Put the sample back</Button>
            </>
          ) : (
            <>
              <p className="cv-small cv-muted" style={{ lineHeight: 1.55 }}>Removes everything the group owns in one transaction. A person's login stays, because it may belong to another group and it's theirs. Download your data first.</p>
              <label className="cv-col" style={{ gap: 4 }}>
                <span className="cv-small">Type <b>{GROUP_NAME}</b> to confirm</span>
                <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!canManage} />
              </label>
              <Button variant="secondary" icon="Trash2" disabled={!canManage || typed !== GROUP_NAME} onClick={() => { setDeleted(true); cv.toast('Organization deleted (sample only).'); }}>Delete organization</Button>
            </>
          )}
        </section>
      </div>
      {!canManage && <Callout icon="Lock">Only the owner can export or delete. Switch to the Owner view in the top bar.</Callout>}
    </div>
  );
}

/** One line on Sources linking to the connection. */
function ToastConnectionLine() {
  const cv = useCv();
  const p = CV_D.room.pilot;
  return (
    <Callout tone="good" icon="PlugZap">
      <span>Toast connected for {CV_ROOM.name} with Standard API credentials · 13 weeks of history pulled {p.toast.backfilledAt} · syncing every 15 minutes. <button className="cv-link" onClick={() => cv.go('connect')}>Manage the connection</button></span>
    </Callout>
  );
}

export { CvConnect, CvWindows, CvData, PlatformHealth, ToastConnectionLine };
