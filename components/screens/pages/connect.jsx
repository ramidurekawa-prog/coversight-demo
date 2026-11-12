'use client';

import * as React from 'react';
import { Icon, Button } from '../../kit';
import { useCv, CV_LOCS, Pill, Callout, PageHead } from '../core';
import { TOAST_ERRORS } from '../../../lib/data/pilot.js';
import { engine, useEngine } from '../../engine';
import { ToastImport } from '../toast-import';
import { ROOM_IDS, GROUP_NAME, pilotOf, locOf, SAMPLE_CLIENT } from '../live';

/* ================================================================ Connect Toast */
const HOW_TO = [
  'In Toast Web, open Integrations → Toast API access → Manage credentials.',
  'Create Standard API credentials (read-only scopes: orders, menus, labor, restaurants, config).',
  'Copy the Client ID, Client secret (shown once) and API hostname into the form below.',
  'Your restaurant GUIDs are in the confirmation email Toast sends after the credentials activate.',
];

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

export { CvConnect };
