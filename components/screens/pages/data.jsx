'use client';

import * as React from 'react';
import { Icon, Button } from '../../kit';
import { useCv, CV_DS, CV_PROOF, Pill, Callout, PageHead } from '../core';
import { useEngine } from '../../engine';
import { ROOM_IDS, GROUP_NAME, SAMPLE_CLIENT } from '../live';

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

export { CvData };
