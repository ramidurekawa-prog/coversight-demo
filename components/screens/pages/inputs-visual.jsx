'use client';

/* Data & Connections: plain data entry. A drop area, then one row per kind
 * of data with its status and one button. Connections, history and detail
 * open in side panels. */

import * as React from 'react';
import Link from 'next/link';

import { Button, Icon } from '../../kit';
import { CV_ROOM, Claim, Pill } from '../core';
import { AFFECTS, METHODS, NEEDS, READY, SCHEMAS, STEP_ORDER, actionLabel, kindStatus } from '../../../lib/data/page/inputs';
import s from './inputs.module.css';

const usd = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

/* Status of a kind's data, in the system's status colors (always with icon and label). */
export const STATE = {
  hand: { label: 'Yours', color: 'var(--success-600)', icon: 'CircleCheck' },
  linked: { label: 'Linked', color: 'var(--fg-1)', icon: 'Link2' },
  stale: { label: 'Stale', color: 'var(--warning-600)', icon: 'TriangleAlert' },
  sample: { label: 'Sample', color: 'var(--border-strong)', icon: 'CircleDashed' },
  none: { label: 'Missing', color: 'var(--fg-3)', icon: 'CircleX' },
};

/** A sample-data tag for any figure that isn't the restaurant's own. */
export const SampleTag = () => <Pill icon="FlaskConical">Sample</Pill>;

/** A system counts when it's set up, or when this restaurant's findings need it. An optional one that was never connected isn't a failure. */
export const applies = (x) => x.state !== 'off' || x.required;

/* ------------------------------------------------------------------ the one action a kind of data needs */
function FixAction({ it, primary, big, server, onOpen, onLink }) {
  const v = primary ? 'primary' : 'secondary';
  const size = big ? undefined : 'sm';
  const label = actionLabel(it.kind, it.method === 'link' && !server ? 'upload' : it.method);
  if (it.method === 'toast') return <Link className={`btn btn-${v} ${big ? '' : 'btn-sm'}`} href="/connect"><Icon name="PlugZap" size={15} />{label}</Link>;
  if (it.method === 'link' && server) return <Button size={size} variant={v} icon="Link2" onClick={() => onLink(it.kind)}>{label}</Button>;
  return <Button size={size} variant={v} icon={it.method === 'type' ? 'PencilLine' : 'Upload'} onClick={() => onOpen(it.kind, it.method === 'type' ? 'grid' : 'csv')}>{label}</Button>;
}

/* ------------------------------------------------------------------ connections: the systems data comes from */
const SYS = {
  healthy: { label: 'Up to date', tone: 'good', icon: 'CircleCheck' },
  partial: { label: 'Incomplete', tone: 'warn', icon: 'TriangleAlert' },
  stale: { label: 'Out of date', tone: 'warn', icon: 'TriangleAlert' },
  off: { label: 'Not connected', tone: 'neutral', icon: 'CircleDashed' },
};
/** An expired sign-in needs reconnecting; a refresh wouldn't help. */
const needsReconnect = (x) => x.state !== 'healthy' && /token|expired|authori[sz]|sign.?in|password|revoked/i.test(x.note || '');

export function Connections({ systems, onToastExports, onSettings, onReadNow, busy }) {
  const [open, setOpen] = React.useState(null);
  return (
    <div className={s.conns}>
      {systems.map((x) => {
        const st = SYS[x.state] || SYS.off;
        const on = open === x.id;
        const bad = x.state === 'stale' || x.state === 'partial';
        const reconnect = needsReconnect(x);
        return (
          <div key={x.id} className={s.entryWrap}>
            <button type="button" className={s.connRow} aria-expanded={on} aria-controls={`conn-${x.id}`} onClick={() => setOpen(on ? null : x.id)}>
              <span className={s.connMain}>
                <span className={s.connName}><Icon name={x.icon} size={16} />{x.name}</span>
                <span className={s.entryMeta}>{x.state === 'off' ? x.supplies : `${x.supplies} · last update ${x.last}`}</span>
              </span>
              <Pill tone={st.tone} icon={st.icon}>{st.label}</Pill>
              <Icon name={on ? 'ChevronUp' : 'ChevronDown'} size={16} className={s.chev} />
            </button>
            {on && (
              <div className={s.connDetail} id={`conn-${x.id}`}>
                {bad && x.note && <p className={s.caution}><Icon name="TriangleAlert" size={16} />{x.note}</p>}
                <dl className={s.histDetail}>
                  <dt>{x.state === 'off' ? 'Status' : 'Last update'}</dt><dd>{x.state === 'off' ? 'Nothing has come in yet' : x.last}</dd>
                  <dt>Affects</dt><dd>{x.supplies}</dd>
                  <dt>Updates</dt><dd>{x.refresh}</dd>
                  {!bad && x.note && <><dt>Note</dt><dd>{x.note}</dd></>}
                  {x.failed?.length > 0 && <><dt>Flagged</dt><dd>{x.failed.map((f) => `${f.source.split(' · ').pop()}: ${f.why}`).join(' ')}</dd></>}
                </dl>
                <div className="cv-row" style={{ gap: 8 }}>
                  {x.link && <Button size="sm" variant="secondary" icon="RefreshCw" disabled={!!busy} onClick={() => onReadNow(x.link)}>{busy === `pull:${x.link.id}` ? 'Reading…' : 'Refresh now'}</Button>}
                  {x.link && <Button size="sm" variant="ghost" icon="Settings" onClick={() => onSettings(x.link)}>Settings</Button>}
                  {x.href && <Link className="btn btn-secondary btn-sm" href={x.href}><Icon name={reconnect ? 'RefreshCw' : 'PlugZap'} size={15} />{x.state === 'off' ? `Connect ${x.name}` : reconnect ? `Reconnect ${x.name}` : bad ? 'Check connection details' : 'Manage connection'}</Link>}
                  {x.id === 'Toast' && <Button size="sm" variant="ghost" icon="FileArchive" onClick={onToastExports}>Upload Toast exports instead</Button>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ the page: one row per kind of data, one button each */
export function DataRows({ rows, items, sample, server, quiet, onOpen, onLink, onDetails }) {
  const order = [...items.map((it) => it.kind), ...STEP_ORDER.filter((k) => !items.some((it) => it.kind === k))];
  return (
    <div className={s.dataRows} role="list">
      {order.map((k, i) => {
        const r = rows.find((x) => x.kind === k);
        const it = items.find((x) => x.kind === k);
        const st = READY[kindStatus(r, it)];
        const own = r.src.key === 'hand' || r.src.key === 'linked';
        const sub = it ? `Needed for ${AFFECTS[k].toLowerCase()}`
          : own ? `${r.src.key === 'linked' ? 'Linked sheet' : 'Entered by your team'} · ${r.entry.date}`
            : `${sample ? 'Sample data' : 'Starter data'}${r.feed ? ` · updated ${r.feed.last}` : ''}`;
        return (
          <div key={k} className={s.dataRow} role="listitem">
            <button type="button" className={s.dataMain} onClick={() => onDetails(k)} aria-label={`${r.schema.title}: ${st.label}. ${sub}. View details.`}>
              <span className={s.dataIco}><Icon name={r.schema.icon} size={20} /></span>
              <span className={s.dataText}><b>{r.schema.title}</b><span>{sub}</span></span>
              <Pill tone={st.tone} icon={st.icon}>{st.label}</Pill>
            </button>
            <Button size="sm" variant="ghost" icon="Settings" onClick={() => onDetails(k)}>Manage</Button>
            {it
              ? <FixAction it={it} primary={i === 0 && !quiet} server={server} onOpen={onOpen} onLink={onLink} />
              : <Button size="sm" variant="secondary" icon="PencilLine" onClick={() => onOpen(k, 'grid')}>Update</Button>}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ the one way in: drop anything */
const ADD_WAYS = [
  { id: 'file', icon: 'Upload', title: 'Upload a file', sub: 'Excel, CSV or a Toast export' },
  { id: 'photo', icon: 'Camera', title: 'Take a photo', sub: 'Invoice, count sheet or statement' },
  { id: 'paste', icon: 'ClipboardPaste', title: 'Paste from a spreadsheet', sub: 'Copy the cells, paste them in' },
  { id: 'link', icon: 'Link2', title: 'Link a Google Sheet', sub: 'Stays up to date every morning' },
  { id: 'type', icon: 'PencilLine', title: 'Type it in', sub: 'A short form, a few rows' },
  { id: 'connect', icon: 'PlugZap', title: 'Connect your POS', sub: 'Sales and hours come in on their own' },
];

/** Every easy way to add data, side by side. A file dropped anywhere on the page works too. */
export function AddWays({ over, onFiles, onPhoto, onWay }) {
  const ref = React.useRef(null);
  const cam = React.useRef(null);
  const go = (id) => (id === 'file' ? ref.current?.click() : id === 'photo' ? cam.current?.click() : onWay(id));
  return (
    <section className={`${s.addWays} ${over ? s.dropOver : ''}`} aria-labelledby="add-ways-h">
      <div className={s.addHead}>
        <span className="cv-h4" id="add-ways-h">{over ? 'Drop it anywhere' : 'Add data'}</span>
        <span className={`${s.addHint} ${s.notPhone}`}>Or drop a file anywhere on this page</span>
      </div>
      <div className={s.wayGrid}>
        {ADD_WAYS.map((w) => (
          <button key={w.id} type="button" className={s.wayTile} onClick={() => go(w.id)}>
            <span className={s.dataIco}><Icon name={w.icon} size={20} /></span>
            <span className={s.dataText}><b>{w.title}</b><span>{w.sub}</span></span>
          </button>
        ))}
      </div>
      <input ref={cam} type="file" accept="image/*,application/pdf" capture="environment" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onPhoto(f); }} />
      <input ref={ref} type="file" multiple style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onFiles(f); }} />
    </section>
  );
}
