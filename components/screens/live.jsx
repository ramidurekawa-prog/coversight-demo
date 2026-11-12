'use client';

import * as React from 'react';

import { Icon, Button, Tabs } from '../kit';
import { useCv, cvMoney, CV_D, CV_DS, CV_LOCS, CV_PROOF, CV_ROOM, Claim, Pill, Callout, Interval, PageHead, cvScale } from './core';
import { leverReport } from '../../lib/data/levers.js';
import { windowState, METHOD_LABEL, MAGNITUDE_FLOOR_PCT, WORKER_JOBS, statusz, TOAST_ERRORS } from '../../lib/data/pilot.js';
import { LEVER_METRIC } from '../../lib/data/readers.js';
import { engine, useEngine } from '../engine';
import { ToastImport } from './toast-import';

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

/* Server mode: data exports today, plus real Toast credentials checked against Toast and stored sealed. */
async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

const SYNC_LABEL = { off: ['Waiting for the first run', 'neutral', 'Hourglass'], backfilling: ['Backfilling 13 weeks', 'warn', 'Loader'], live: ['Live · nightly', 'good', 'CircleCheck'], failing: ['Sync failing', 'bad', 'CircleX'] };
const syncAgo = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - Date.parse(t)) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** Lane 1 status: what the hourly sync holds per room, and "Sync now". */
function SyncPanel({ st, rooms, canRun, busy, onRun }) {
  const sync = st.sync ?? { state: 'off', rooms: {} };
  const [label, tone, icon] = SYNC_LABEL[sync.state] ?? SYNC_LABEL.off;
  return (
    <div className="cv-col" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 12 }} data-lane="pos">
      <div className="cv-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div className="cv-col" style={{ gap: 2 }}>
          <span className="cv-h4">Live sync</span>
          <span className="cv-xs cv-faint">Orders, checks, voids, discounts, refunds, time entries and wages, one business day at a time. Last run {syncAgo(sync.at)}.</span>
        </div>
        <Pill tone={tone} icon={icon}>{label}</Pill>
      </div>
      <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Sync by room">
        <table className="cv-table">
          <thead><tr><th>Restaurant</th><th>History held</th><th className="r">Newest day</th><th className="r">Orders last run</th><th className="r">Shifts last run</th></tr></thead>
          <tbody>{st.restaurants.map((r) => {
            const d = sync.rooms?.[r.roomId];
            const pct = d ? Math.round((d.days / (d.days + d.missing || 1)) * 100) : 0;
            return (
              <tr key={r.guid}>
                <td>{r.name} <span className="cv-xs cv-faint">→ {rooms.find((x) => x.id === r.roomId)?.short ?? r.roomId}</span></td>
                <td style={{ minWidth: 160 }}>{d ? <span className="cv-col" style={{ gap: 3 }}><span className="cv-xs">{d.days} of {d.days + d.missing} days</span><span style={{ height: 6, background: 'var(--surface-sunken)', borderRadius: 3, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--accent)' }} /></span></span> : <span className="cv-xs cv-faint">Not pulled yet</span>}</td>
                <td className="r cv-num">{d?.newest ?? '—'}</td><td className="r cv-num">{d ? d.orders.toLocaleString('en-US') : '—'}</td><td className="r cv-num">{d ? d.shifts.toLocaleString('en-US') : '—'}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <span className="cv-xs cv-faint">The first runs pull 13 weeks, newest first, about five weeks per run. After that each nightly run (or Sync now) re-reads today and the two days before, so late voids, tips and clock-outs are caught. Kitchen ticket times aren&apos;t in Toast&apos;s standard API: add KitchenTimings.csv from the exports above.</span>
      {canRun && <span><Button size="sm" icon="RefreshCw" disabled={!!busy} onClick={onRun}>{busy === 'sync' ? 'Syncing with Toast…' : 'Sync now'}</Button></span>}
    </div>
  );
}

function CvConnectReal() {
  const cv = useCv();
  const eng = useEngine();
  const isOwner = eng.viewer?.role === 'owner';
  const rooms = CV_LOCS.filter((l) => l.id !== 'all');
  const [st, setSt] = React.useState(undefined);
  const [canStore, setCanStore] = React.useState(true);
  const [form, setForm] = React.useState({ host: 'ws-api.toasttab.com', clientId: '', secret: '', restaurants: [{ guid: '', roomId: rooms[0]?.id ?? '' }] });
  const [check, setCheck] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const [err, setErr] = React.useState(null);
  React.useEffect(() => { fetch('/api/toast', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => { setSt(j.connection); setCanStore(j.canStore); }).catch(() => setSt(null)); }, []);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setCheck(null); };
  const setR = (i, k, v) => set('restaurants', form.restaurants.map((x, j) => (j === i ? { ...x, [k]: v.trim ? v.trim() : v } : x)));
  const act = async (name, fn) => { setBusy(name); setErr(null); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(null); } };
  return (
    <div className="cv-page">
      <PageHead over={`Connect your POS · ${eng.org?.name ?? ''}`} q="How does our Toast data get in?"
        sub="Two ways in, both read by the same code: the live Toast API sync (every night once credentials are stored, or Sync now), and Toast's data exports, uploaded whenever you like." />
      <ToastImport compact />
      <section className="cv-card" aria-labelledby="toast-api">
        <div className="cv-card-head">
          <div className="cv-col" style={{ gap: 2 }}><span className="cv-h4" id="toast-api">Toast API credentials</span><span className="cv-xs cv-faint">Checked against Toast for real and stored sealed. The secret never leaves the server and is never exported.</span></div>
          {st ? <Pill tone={st.status === 'connected' ? 'good' : 'bad'} icon={st.status === 'connected' ? 'CircleCheck' : 'CircleX'}>{st.status === 'connected' ? 'Credentials work' : 'Failing'}</Pill> : <Pill icon="CircleMinus">Not connected</Pill>}
        </div>
        {!canStore && <Callout tone="warn" icon="Lock">The server has no CREDENTIALS_KEY yet, so it won&apos;t store credentials. Add a random 32+ character CREDENTIALS_KEY in Vercel first.</Callout>}
        {err && <Callout tone="bad" icon="CircleX">{err}</Callout>}
        {st ? (
          <>
            <dl className="cv-kv">
              <dt>API host</dt><dd>{st.host}</dd>
              <dt>Client ID</dt><dd>{st.clientId}</dd>
              <dt>Restaurants</dt><dd style={{ fontFamily: 'var(--font-sans)' }}>{st.restaurants.map((r) => `${r.name} → ${rooms.find((x) => x.id === r.roomId)?.short ?? r.roomId}`).join(' · ')}</dd>
              <dt>Last checked</dt><dd>{new Date(st.checkedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd>
            </dl>
            {st.lastError && <Callout tone="bad" icon="CircleX">{st.lastError}</Callout>}
            <SyncPanel st={st} rooms={rooms} canRun={eng.viewer?.role !== 'gm'} busy={busy} onRun={() => act('sync', async () => {
              const j = await jpost('/api/jobs', { job: 'sync' });
              const t = await fetch('/api/toast', { credentials: 'same-origin' }).then((r) => r.json());
              setSt(t.connection);
              await engine.hydrate();
              cv.toast(j.result?.ok ? 'Synced. Every figure now reads the newest Toast data.' : `Sync failed: ${j.result?.detail?.error ?? 'see the error above'}`);
            })} />
            <div className="cv-row" style={{ gap: 8 }}>
              <Button size="sm" variant="secondary" icon="RefreshCw" disabled={!!busy || eng.viewer?.role === 'gm'} onClick={() => act('recheck', async () => { const j = await jpost('/api/toast/recheck'); setSt(j.connection); cv.toast(j.connection.status === 'connected' ? 'Toast accepted the credentials.' : 'Toast refused them. See the error.'); })}>{busy === 'recheck' ? 'Checking…' : 'Check again'}</Button>
              {isOwner && <Button size="sm" variant="ghost" icon="CircleMinus" disabled={!!busy} onClick={() => act('off', async () => { await jpost('/api/toast/disconnect'); setSt(null); cv.toast('Disconnected. The stored credentials were deleted.'); })}>Disconnect</Button>}
            </div>
          </>
        ) : st === null && (
          <>
            <ol className="cv-col" style={{ gap: 4, margin: 0, paddingLeft: 18 }}>{HOW_TO.map((h) => <li key={h} className="cv-small">{h}</li>)}</ol>
            <div className="cv-col" style={{ gap: 8 }}>
              <label className="cv-col" style={{ gap: 4 }}><span className="cv-small">API hostname</span><input className="input" value={form.host} onChange={(e) => set('host', e.target.value)} disabled={!isOwner} /></label>
              <label className="cv-col" style={{ gap: 4 }}><span className="cv-small">Client ID</span><input className="input" value={form.clientId} onChange={(e) => set('clientId', e.target.value)} disabled={!isOwner} autoComplete="off" /></label>
              <label className="cv-col" style={{ gap: 4 }}><span className="cv-small">Client secret</span><input className="input" type="password" value={form.secret} onChange={(e) => set('secret', e.target.value)} disabled={!isOwner} autoComplete="new-password" /></label>
              <span className="cv-small">Restaurants (GUID → room)</span>
              {form.restaurants.map((r, i) => (
                <span key={i} className="cv-row nowrap" style={{ gap: 6 }}>
                  <input className="input" style={{ flex: 1 }} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={r.guid} onChange={(e) => setR(i, 'guid', e.target.value)} disabled={!isOwner} aria-label={`Restaurant ${i + 1} GUID`} />
                  <select className="input" style={{ width: 'auto' }} value={r.roomId} onChange={(e) => setR(i, 'roomId', e.target.value)} disabled={!isOwner} aria-label={`Restaurant ${i + 1} room`}>{rooms.map((x) => <option key={x.id} value={x.id}>{x.short}</option>)}</select>
                  {check?.restaurants?.[i] && <Icon name={check.restaurants[i].ok ? 'CircleCheck' : 'CircleX'} size={16} />}
                </span>
              ))}
              {isOwner && form.restaurants.length < rooms.length && <span><Button size="sm" variant="ghost" icon="Plus" onClick={() => set('restaurants', [...form.restaurants, { guid: '', roomId: rooms[form.restaurants.length]?.id ?? rooms[0].id }])}>Add a restaurant</Button></span>}
              {check && !check.ok && <Callout tone="bad" icon="CircleX">{check.error || check.restaurants?.find((x) => !x.ok)?.error}</Callout>}
              {check?.ok && <Callout tone="good" icon="CircleCheck">Toast accepted these and can read {check.restaurants.map((x) => x.name).join(', ')}.</Callout>}
              {isOwner ? (
                <div className="cv-row" style={{ gap: 8 }}>
                  <Button variant="secondary" disabled={!!busy || !form.clientId || !form.secret} onClick={() => act('check', async () => setCheck(await jpost('/api/toast/check', form)))}>{busy === 'check' ? 'Checking with Toast…' : 'Check'}</Button>
                  <Button disabled={!!busy || !check?.ok || !canStore} onClick={() => act('connect', async () => { const j = await jpost('/api/toast/connect', form); if (j.connected) { setSt(j.status); setForm((f) => ({ ...f, secret: '' })); cv.toast('Stored, sealed. Toast accepted the credentials.'); } else setCheck(j.check); })}>{busy === 'connect' ? 'Storing…' : 'Store the credentials'}</Button>
                </div>
              ) : <Callout icon="Lock">Only an owner can connect Toast.</Callout>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function CvConnect() {
  const eng = useEngine();
  if (eng.mode === 'server') return <CvConnectReal />;
  return <CvConnectDemo />;
}

function CvConnectDemo() {
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
      cv.toast('Simulated: on the live platform the first sync (13 weeks of history) would start within 15 minutes.');
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
  const headline = !conn.connected ? 'Not connected' : failing ? 'Sync failing' : conn.state === 'pending' ? 'Connected — first sync pending' : 'Healthy (simulated: this is the sample walkthrough, no Toast calls are made)';

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
  stopped: { label: 'Stopped', tone: 'neutral', icon: 'CircleMinus' },
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

/* ---------------------------------------------------------------- the group's own tests */
const fmtM = (unit, v) => (v == null ? '—' : unit === '$/wk' ? `$${Math.round(v).toLocaleString('en-US')}` : `${(Math.round(v * 10) / 10).toLocaleString('en-US')} ${unit.replace('/wk', '').replace('/turn', '')}`);

function SeriesChart({ w }) {
  const W = 1000, H = 160, P = { l: 64, r: 16, t: 12, b: 24 };
  const pts = w.series || [];
  if (pts.length < 2) return null;
  const vals = [w.baseline, ...pts.map((p) => p.value)];
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.2 || 1;
  const x = cvScale(0, pts.length - 1, P.l, W - P.r), y = cvScale(lo - pad, hi + pad, H - P.b, P.t);
  const startIdx = pts.findIndex((p) => p.weekEnd > w.startedAt);
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${w.title}: weekly values against the baseline`}>
      <line className="grid" x1={P.l} x2={W - P.r} y1={y(w.baseline)} y2={y(w.baseline)} strokeDasharray="4 3" />
      <text x={P.l - 6} y={y(w.baseline) + 3} textAnchor="end">{fmtM(w.unit, w.baseline)}</text>
      {startIdx > 0 && <rect x={x(startIdx - 0.5)} y={P.t} width={x(pts.length - 1) - x(startIdx - 0.5) + 8} height={H - P.b - P.t} fill="var(--accent)" opacity="0.06" />}
      <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={pts.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
      {pts.map((p, i) => <circle key={p.weekEnd} cx={x(i)} cy={y(p.value)} r={p.weekEnd > w.startedAt ? 5 : 3} fill={p.weekEnd > w.startedAt ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" />)}
      {pts.map((p, i) => (i % 2 === pts.length % 2 ? null : <text key={`t${p.weekEnd}`} x={x(i)} y={H - 6} textAnchor="middle">{p.weekEnd.slice(5)}</text>))}
    </svg>
  );
}

function YourTests() {
  const cv = useCv();
  const eng = useEngine();
  const [lever, setLever] = React.useState('labour');
  const [dish, setDish] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const room = CV_D.room;
  const mine = (eng.windows || []).filter((w) => w.roomId === CV_D.id);
  const report = leverReport(room, CV_D);
  const dishes = room.menu.filter((m) => room.levers?.priceHistory?.[m.key]);
  const start = async () => {
    setBusy(true);
    const r = await engine.startWindow(lever, { dish: lever === 'menu_margin' ? dish : undefined });
    setBusy(false);
    cv.toast(r.ok ? 'Test started. Baseline frozen at the last 4 weeks; each new week of Toast data is a checkpoint.' : r.error);
  };
  if (eng.mode !== 'server') return <Callout icon="Info">Real tests need the server. This preview runs in your browser only; the walk-through below shows how one runs.</Callout>;
  return (
    <section className="cv-card" aria-labelledby="your-tests">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 2 }}>
          <span className="cv-h4" id="your-tests">Tests at {CV_ROOM.short}</span>
          <span className="cv-xs cv-faint">Measured in weeks of {room.fromToast ? `your Toast data (through ${room.fromToast.end})` : 'this room’s data (sample until you load your Toast exports)'}. The daily proof loop records checkpoints and closes each one at day 28.</span>
        </div>
        <Pill icon="Timer">{mine.filter((w) => w.status === 'running' || w.status === 'waiting').length} running</Pill>
      </div>
      {mine.length === 0 && <span className="cv-small cv-muted">No tests here yet. Start one on the lever worth the most below, or from Today.</span>}
      {mine.map((w) => {
        const st = STATUS[w.status] || STATUS.running;
        return (
          <div key={w.id} className="cv-col" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div className="cv-row nowrap" style={{ gap: 10 }}>
              <span className="cv-col" style={{ gap: 2, flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{w.title}</span>
                <span className="cv-xs cv-faint">{LEVER_METRIC[w.lever]?.label} · {w.direction === 'down' ? 'down is better' : 'up is better'} · started on data to {w.startedAt} · day {w.day} of 28{w.staleDays > 9 && (w.status === 'running' || w.status === 'waiting') ? ` · no new data for ${w.staleDays} days` : ''}</span>
              </span>
              <Pill tone={st.tone} icon={st.icon}>{st.label}</Pill>
              {(w.status === 'running' || w.status === 'waiting') && <Button size="sm" variant="ghost" onClick={async () => { const r = await engine.stopWindow(w.id); cv.toast(r.ok ? 'Stopped. Nothing is booked from it.' : r.error); }}>Stop</Button>}
            </div>
            <SeriesChart w={w} />
            <dl className="cv-kv">
              <dt>Baseline (frozen)</dt><dd>{fmtM(w.unit, w.baseline)}</dd>
              <dt>Checkpoints</dt><dd>{w.checkpoints.length ? w.checkpoints.map((c) => `day ${c.day}: ${fmtM(w.unit, c.observed)}`).join(' · ') : 'none yet'}</dd>
              {w.method && <><dt>Method</dt><dd style={{ fontFamily: 'var(--font-sans)' }}>{METHOD_LABEL[w.method]}</dd></>}
              {w.pointCents != null && w.checkpoints.length >= 2 && <><dt>Measured, a week</dt><dd>${(w.pointCents / 100).toFixed(2)} point · ${(Math.max(0, w.lowCents) / 100).toFixed(2)} lower bound</dd></>}
              <dt>Booked</dt><dd><Claim k={w.status === 'verified' ? 'book' : 'none'} /> {w.status === 'verified' ? `$${(w.bookedCents / 100).toFixed(2)} a week` : '$0 until it verifies'}</dd>
            </dl>
          </div>
        );
      })}
      <div className="cv-row" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12, alignItems: 'center' }}>
        <span className="cv-small" style={{ fontWeight: 600 }}>Start a test</span>
        <select className="input" style={{ width: 'auto' }} value={lever} onChange={(e) => setLever(e.target.value)} aria-label="Lever to test">
          {report.map((l) => <option key={l.key} value={l.key}>{l.name} · {l.scope}{l.weekly > 0 ? ` · ~$${Math.round(l.weekly)}/wk` : ''}</option>)}
        </select>
        {lever === 'menu_margin' && (
          <select className="input" style={{ width: 'auto' }} value={dish} onChange={(e) => setDish(e.target.value)} aria-label="Dish">
            <option value="">Pick a dish…</option>
            {dishes.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
          </select>
        )}
        <Button size="sm" icon="Play" disabled={busy || (lever === 'menu_margin' && !dish)} onClick={start}>{busy ? 'Starting…' : 'Start'}</Button>
      </div>
    </section>
  );
}

function CvWindows() {
  const cv = useCv();
  const roomId = cv.loc === 'all' ? CV_D.id : cv.loc;
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
      <PageHead over={`Test windows · ${locOf(roomId)?.name ?? CV_ROOM.name}`} q="Is the change working, and what can we book?"
        sub="A window opens when you press Start, a checkpoint lands with every new week of data, and at day 28 it closes Verified at the lower bound of its interval, or Rejected. Nothing is booked before then."
        right={cv.loc === 'all' && <Pill icon="Building2">{`Showing ${CV_ROOM.short}; pick a room in the top bar`}</Pill>} />

      <YourTests />

      <div className="cv-col" style={{ gap: 4 }}>
        <span className="cv-h4">How a window runs: the sample walk-through</span>
        <span className="cv-small cv-muted">The sample room&apos;s window, computed with the same estimator. Drag the day to run it forward.</span>
      </div>

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
        Still to come: a window opens when you press Start (or when Toast confirms a price change), not on other evidence the change happened; no matched control rooms are subtracted yet, so every real window is a before/after; and "couldn't tell" and "didn't work" both close as Rejected. <button className="cv-link" onClick={() => cv.go('proof')}>See the Proof screen</button>
      </Callout>
    </div>
  );
}

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
  const eng = useEngine();
  if (eng.mode === 'server') return <CvDataReal />;
  return <CvDataDemo />;
}

/* The real thing: download everything this group owns, or delete the group. */
function CvDataReal() {
  const cv = useCv();
  const eng = useEngine();
  const isOwner = eng.viewer?.role === 'owner';
  const name = eng.org?.name || '';
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const download = () => {
    setBusy('export');
    const a = document.createElement('a');
    a.href = '/api/export';
    a.click();
    setTimeout(() => setBusy(null), 1500);
    cv.toast('Export started: everything this group holds, as plain JSON.');
  };
  const del = async () => {
    setBusy('delete'); setErr(null);
    const r = await fetch('/api/org/delete', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: typed }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(b.error || 'Couldn’t delete.'); setBusy(null); return; }
    window.location.assign('/');
  };
  return (
    <div className="cv-page">
      <PageHead over={`Your data · ${name}`} q="Can I take my data with me, or have it deleted?"
        sub="Yes, both, any time, by an owner. The export is every table that belongs to this group; delete removes all of it in one step." />
      <div className="cv-grid g2">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Download all your data</span><Pill icon="FileOutput">coversight-export/v2</Pill></div>
          <ul className="cv-ul">
            {['Rooms and their data (menus, team, history, your Toast summaries)', 'Everything entered by hand, including undone entries', 'Decisions, approvals, tasks and test windows with every checkpoint', 'Notifications, emails sent or drafted, and the full audit log', 'People in the group and their roles'].map((t) => <li key={t}><Icon name="Check" size={14} />{t}</li>)}
          </ul>
          <Button icon="Download" disabled={!isOwner || busy === 'export'} onClick={download}>Download all your data</Button>
          <span className="cv-xs cv-faint">Never included: passwords, sessions, invite links, or anyone else&apos;s groups.</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Delete the group</span><Pill tone="bad" icon="Trash2">Irreversible</Pill></div>
          <p className="cv-small cv-muted" style={{ lineHeight: 1.55 }}>Removes everything this group owns, now. People&apos;s logins stay, because they may belong to other groups. Download your data first.</p>
          <label className="cv-col" style={{ gap: 4 }}>
            <span className="cv-small">Type <b>{name}</b> to confirm</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!isOwner} aria-label="Group name to confirm" />
          </label>
          <Button variant="secondary" icon="Trash2" disabled={!isOwner || typed !== name || busy === 'delete'} onClick={del}>{busy === 'delete' ? 'Deleting…' : 'Delete the group'}</Button>
          {err && <Callout tone="warn" icon="CircleX">{err}</Callout>}
        </section>
      </div>
      {!isOwner && <Callout icon="Lock">Only an owner can export or delete. You&apos;re signed in as {eng.viewer?.role === 'gm' ? 'a GM' : 'an admin'}.</Callout>}
    </div>
  );
}

function CvDataDemo() {
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
  const t = CV_D.room.fromToast;
  if (t) return <Callout tone="good" icon="PlugZap"><span>{CV_ROOM.name} runs on its own Toast data exports through {t.end} ({t.weeks} weeks). Upload the latest each week on <button className="cv-link" onClick={() => cv.go('inputs')}>Data inputs</button>; the live API sync arrives with Toast credentials.</span></Callout>;
  if (!CV_D.ownData) return <Callout icon="FlaskConical"><span>{CV_ROOM.name} is on sample data. Load your Toast data exports on <button className="cv-link" onClick={() => cv.go('inputs')}>Data inputs</button> to put every figure on your own numbers.</span></Callout>;
  return <Callout icon="PencilLine"><span>{CV_ROOM.name} has data entered by hand; the rest is still sample. Load your Toast data exports on <button className="cv-link" onClick={() => cv.go('inputs')}>Data inputs</button> for sales, team and timings.</span></Callout>;
}

export { CvConnect, CvWindows, CvData, PlatformHealth, ToastConnectionLine };

/* ================================================================ Levers */

const BAR_LABELS = [
  ['data', 'Data', 'Reads the room’s own observations'],
  ['measured', 'Measured', 'No made-up number in its dollars'],
  ['measurable', 'Provable', 'A 28-day test could prove the expected effect'],
  ['controls', 'Controls', 'An untouched comparison to subtract'],
  ['books', 'Books $', 'A verified test converts to dollars a week'],
];
const gradeTone = (g) => (g === 'A' ? 'good' : g === 'A−' || g === 'Clear' ? 'info' : g === 'B' ? 'warn' : 'bad');
const gradeIcon = (g) => ({ A: 'BadgeCheck', 'A−': 'CircleCheck', Clear: 'CircleMinus', B: 'CircleDot' })[g] ?? 'CircleX';

function CvLevers() {
  const cv = useCv();
  const eng = useEngine();
  const roomId = cv.loc === 'all' ? CV_D.id : cv.loc;
  const room = CV_DS.rooms[roomId];
  const levers = React.useMemo(() => leverReport(room, roomId === CV_D.id ? CV_D : undefined), [room, roomId]);
  const [open, setOpen] = React.useState(null);
  const own = !!room.fromToast;
  const testOf = (key) => (eng.windows || []).find((w) => w.roomId === roomId && w.lever === key && (w.status === 'running' || w.status === 'waiting' || w.status === 'verified'));
  const start = async (key) => { const r = await engine.startWindow(key, { roomId }); cv.toast(r.ok ? 'Test started. Baseline frozen; each new week of data is a checkpoint.' : r.error); };
  return (
    <div className="cv-page wide">
      <PageHead over={`Levers · ${locOf(roomId)?.name ?? CV_ROOM.name}`} q="Is every lever running on measurement?"
        sub={`Each of the six Toast-fed levers, graded on five bars: it reads the room's own data, no number in its dollars is made up, a 28-day test could prove it, there's an untouched comparison to subtract, and a verified test books dollars. ${own ? `Every figure reads this room's own Toast data through ${room.fromToast.end}.` : 'Every figure here is computed from this room’s sample observations until its Toast data is loaded.'}`}
        right={cv.loc === 'all' && <Pill icon="Building2">Showing Oakland; pick a room in the top bar</Pill>} />
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="cv-table">
            <thead><tr><th>Lever</th><th>Where</th><th className="r">$ a week</th><th className="r">Confidence</th>{BAR_LABELS.map(([k, l, t]) => <th key={k} className="c" title={t}>{l}</th>)}<th>Grade</th></tr></thead>
            <tbody>
              {levers.map((l) => (
                <React.Fragment key={l.key}>
                  <tr onClick={() => setOpen(open === l.key ? null : l.key)} style={{ cursor: 'pointer' }} aria-expanded={open === l.key}>
                    <td style={{ fontWeight: 600 }}>{l.name}</td>
                    <td className="cv-small">{l.scope}</td>
                    <td className="r">{l.weekly > 0 ? cvMoney(Math.round(l.weekly)) : '—'}</td>
                    <td className="r">{l.conf ? l.conf.confidence : '—'}</td>
                    {BAR_LABELS.map(([k]) => (
                      <td key={k} className="c">
                        {l.bars[k] === null ? <span className="cv-faint">—</span> : <Icon name={l.bars[k] ? 'CircleCheck' : 'CircleX'} size={16} className={l.bars[k] ? 'ok' : 'no'} aria-label={l.bars[k] ? 'yes' : 'no'} />}
                      </td>
                    ))}
                    <td><Pill tone={gradeTone(l.grade)} icon={gradeIcon(l.grade)}>{l.grade}</Pill></td>
                  </tr>
                  {open === l.key && (
                    <tr>
                      <td colSpan={10} className="cv-small cv-muted" style={{ lineHeight: 1.6, whiteSpace: 'normal' }}>
                        <b>How:</b> {l.method}.{' '}
                        <b>Test power:</b> {l.mde === null ? 'not enough spread to say' : `a 28-day test proves effects of ${l.mde.toFixed(2)} ${l.unit} or more; this one expects ${Math.abs(l.expectedUnits ?? 0).toFixed(2)}`}.{' '}
                        <b>Controls:</b> {l.controlNote}.
                        {l.conf && <> <b>Confidence:</b> {Math.round(l.conf.stability * 100)}% of weeks held × sample {Math.round(l.conf.sample * 100)}%{l.conf.estimatedShare ? `, ${Math.round(l.conf.estimatedShare * 100)}% inferred` : ''}.</>}
                        {eng.mode === 'server' && (() => {
                          const w = testOf(l.key);
                          if (w) return <span className="cv-row" style={{ gap: 6, marginTop: 6 }}><Pill tone={w.status === 'verified' ? 'good' : 'info'} icon="Timer">{w.status === 'verified' ? 'Verified' : `Testing · day ${w.day} of 28`}</Pill><button className="cv-link" onClick={() => cv.go('windows')}>See the test</button></span>;
                          if (l.key === 'menu_margin') return <span className="cv-row" style={{ marginTop: 6 }}><button className="cv-link" onClick={() => cv.go('windows')}>Pick a dish to test on Test windows</button></span>;
                          return l.weekly > 0 ? <span className="cv-row" style={{ marginTop: 6 }}><Button size="sm" icon="Play" onClick={(e) => { e.stopPropagation(); start(l.key); }}>Start a 28-day test</Button></span> : null;
                        })()}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="cv-grid g2">
        <section className="cv-card">
          <span className="cv-h4">What changed from the typed numbers</span>
          <ul className="cv-ul">
            <li><Icon name="Users" size={15} />Labour: each room's own pace in its busiest hours replaces “14 covers a server”.</li>
            <li><Icon name="Receipt" size={15} />Voids & comps: the norm is the room's 8 weeks before, on a control chart; a whole-room rise is its own finding.</li>
            <li><Icon name="UtensilsCrossed" size={15} />Menu: each dish's price sensitivity is fitted from its own price changes, so a rise is valued after the plates it loses.</li>
            <li><Icon name="Armchair" size={15} />Turns: “guests were waiting” is measured from how fast tables are reseated, not assumed at 50% × 0.52, and valued after food cost.</li>
            <li><Icon name="BadgeCheck" size={15} />Every finding's confidence comes from one rule: weeks it held, data behind it, how much was inferred.</li>
          </ul>
        </section>
        <section className="cv-card">
          <span className="cv-h4">Still not 100%</span>
          <ul className="cv-ul">
            <li><Icon name="ChefHat" size={15} />Ticket times: {own && room.fromToast.files?.includes('kitchen') ? 'measured from your Toast kitchen timings, but not a lever until a waitlist shows who was turned away.' : 'need the KitchenTimings export (Toast’s Standard API has no kitchen timings).'}</li>
            <li><Icon name="Shuffle" size={15} />Mix: the whole menu moves together, so there's no untouched comparison; a test is a before/after.</li>
            <li><Icon name="GitCompareArrows" size={15} />Matched controls aren&apos;t subtracted in real tests yet, so every real test is a before/after against its frozen baseline.</li>
            {!own && <li><Icon name="FlaskConical" size={15} />This room runs on sample observations. Load its Toast data exports to put every lever on its own numbers.</li>}
          </ul>
        </section>
      </div>
      <Callout icon="Timer"><span>See one lever run through a 28-day test, with and without matched controls: <button className="cv-link" onClick={() => cv.go('windows')}>Test windows</button></span></Callout>
    </div>
  );
}

export { CvLevers };
