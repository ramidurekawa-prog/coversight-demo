'use client';

/* Data inputs: side panels for the small tasks (rule 2: keep the page in
 * view). One panel at a time, Esc or the scrim closes it, focus goes to the
 * panel and back to what opened it. Each one answers a specific click:
 * a kind's compact preview, readiness by kind, what a capability needs and
 * calculates, the sample-mode explainer, and a linked sheet's settings. */

import * as React from 'react';
import Link from 'next/link';

import { Button, Icon } from '../../kit';
import { CV_D, CV_DS, CV_ROOM, Claim, Pill } from '../core';
import { CALC, METHODS, NEEDS, SCHEMAS, STEP_ORDER } from '../../../lib/data/page/inputs';
import { templateRows } from '../../../lib/data/ingest';
import { STATE } from './inputs-visual';
import s from './inputs.module.css';

const usd = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
const when = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/* ------------------------------------------------------------------ the shell */
export function SidePanel({ over, title, onClose, children, foot, wide = false }) {
  const ref = React.useRef(null);
  const back = React.useRef(null);
  React.useEffect(() => {
    back.current = document.activeElement;
    ref.current?.focus();
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); try { back.current?.focus?.(); } catch { /* gone */ } };
  }, [onClose]);
  return (
    <div className={s.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className={`${s.panel} ${wide ? s.panelWide : ''}`} role="dialog" aria-modal="true" aria-labelledby="inputs-panel-title">
        <header className={s.panelHead}>
          <div className={s.panelHeadText}>
            {over && <span className={s.panelOver}>{over}</span>}
            <h2 className={s.panelTitle} id="inputs-panel-title" tabIndex={-1} ref={ref}>{title}</h2>
          </div>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </header>
        <div className={s.panelBody}>{children}</div>
        {foot && <footer className={s.panelFoot}>{foot}</footer>}
      </aside>
    </div>
  );
}

function Block({ title, children, note }) {
  return (
    <section className={s.block}>
      <h3 className={s.blockTitle}>{title}</h3>
      {children}
      {note && <p className={s.blockNote}>{note}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ one kind: compact preview, freshness, checks, sync */
export function KindPanel({ row, item, stake, last, link, server, onEdit, onLink, onReadNow, onHistory, onClose }) {
  const { kind, schema, entry, feed, src } = row;
  const st = STATE[src.key] || STATE.sample;
  const room = CV_DS.rooms[CV_D.id];
  const rows = entry?.rows?.length ? entry.rows : (kind === 'waste' ? [] : templateRows(kind, room));
  const cols = schema.columns.slice(0, 4);
  const method = item?.method || NEEDS[kind].method;
  const m = METHODS[method] || METHODS.upload;
  const fmt = (c, v) => (v == null || v === '' ? '—' : c.type === 'money' ? `$${(+v).toFixed(2)}` : typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
  return (
    <SidePanel over={`${CV_ROOM.short} · data`} title={schema.title} onClose={onClose} wide
      foot={<>
        <Button className={s.panelPrimary} icon={entry ? 'PencilLine' : 'Plus'} onClick={() => onEdit(kind)}>{entry ? 'Update this data' : 'Enter your own'}</Button>
        <div className={s.panelMore}>
          {method === 'toast' && <Link className="btn btn-secondary btn-sm" href="/connect"><Icon name="PlugZap" size={15} />Connect Toast</Link>}
          {method === 'link' && server && <Button size="sm" variant="secondary" icon="Link2" onClick={() => onLink(kind)}>Link a sheet</Button>}
          <Button size="sm" variant="ghost" icon="Upload" onClick={() => onEdit(kind, 'csv')}>Upload a file</Button>
        </div>
      </>}>
      <div className={s.panelStatus}>
        <span className={s.chipState}><i style={{ background: st.color }} /><Icon name={st.icon} size={14} />{src.label}</span>
        {item?.blocked?.length > 0 && <Pill tone="warn" icon="Ban">{item.blocked.length} finding{item.blocked.length === 1 ? '' : 's'} on hold</Pill>}
      </div>

      <Block title="Freshness">
        <dl className={s.facts}>
          <dt>Source</dt><dd>{entry ? (link ? 'Linked sheet' : 'Entered here') : feed ? `Sample feed (${feed.name})` : 'Sample data'}</dd>
          <dt>Last change</dt><dd>{entry ? `${entry.date}${last ? ` by ${last.by.kind === 'you' ? 'you' : last.by.name}` : ''}` : feed ? feed.last : 'Not entered yet'}</dd>
          {feed && <><dt>Feed</dt><dd>{feed.state === 'healthy' ? 'Up to date' : feed.state === 'off' ? 'Nothing has come in' : feed.state === 'stale' ? 'Out of date' : 'Incomplete'}{feed.note ? `. ${feed.note}` : ''}</dd></>}
          <dt>Rows</dt><dd>{entry ? entry.n.toLocaleString('en-US') : rows.length ? `${rows.length} (sample)` : 'None'}</dd>
        </dl>
      </Block>

      <Block title="Checks">
        {last?.validation || last?.counts ? (
          <dl className={s.facts}>
            {last.counts && <><dt>Last import</dt><dd>{last.counts.added ?? 0} new, {last.counts.updated ?? 0} updated{last.counts.duplicates ? `, ${last.counts.duplicates} already logged` : ''}</dd></>}
            {last.validation && <><dt>Warnings</dt><dd>{last.validation.warnings ?? 0}{last.validation.rejected ? `, ${last.validation.rejected} rows rejected` : ''}</dd></>}
            <dt>Stored</dt><dd>{last.verified === false ? 'Didn’t match what was sent' : 'Matches what was sent'}</dd>
          </dl>
        ) : <p className={s.blockText}>{entry ? 'Every row passed the same checks the server runs.' : 'Nothing imported yet, so nothing to check.'}</p>}
        {item && <p className={s.caution}><Icon name="TriangleAlert" size={16} />{item.missing}</p>}
      </Block>

      {(link || (server && entry)) && (
        <Block title="Sync">
          {link ? (
            <>
              <dl className={s.facts}>
                <dt>Sheet</dt><dd className={s.ellipsis}><a href={link.url} target="_blank" rel="noreferrer noopener">{link.url.replace(/^https:\/\//, '')}</a></dd>
                <dt>Last read</dt><dd>{link.pulledAt ? when(link.pulledAt) : 'Not read yet'}</dd>
                <dt>Schedule</dt><dd>Every morning, 1:30 am Pacific</dd>
                {link.lastError && <><dt>Problem</dt><dd>{link.lastError}</dd></>}
              </dl>
              <span><Button size="sm" variant="secondary" icon="RefreshCw" onClick={() => onReadNow(link)}>Read it now</Button></span>
            </>
          ) : <p className={s.blockText}>Entered by hand. It changes only when someone on your team updates it.</p>}
        </Block>
      )}

      <Block title={`Preview${rows.length > 6 ? ` · first 6 of ${rows.length}` : ''}`} note={entry ? null : 'Sample data until you enter your own.'}>
        {rows.length ? (
          <div className={s.previewWrap}>
            <table className={s.preview}>
              <thead><tr>{cols.map((c) => <th key={c.k} className={c.type === 'text' ? '' : s.r}>{c.label}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 6).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.k} className={c.type === 'text' ? '' : s.r}>{fmt(c, r[c.k])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : <p className={s.blockText}>No rows yet.</p>}
      </Block>

      {stake?.value > 0 && (
        <Block title="What it unlocks">
          <p className={s.blockText}>{NEEDS[kind].unlocks} <b>{usd(stake.value)}/wk</b> potential opportunity rests on it. <Claim k="est" /></p>
        </Block>
      )}
      {onHistory && <span><button type="button" className={s.textLink} onClick={() => onHistory(kind)}>See its history<Icon name="ChevronRight" size={15} /></button></span>}
      <span className="cv-xs cv-faint"><Icon name={m.icon} size={12} style={{ verticalAlign: -2 }} /> Best way in: {m.label}. {m.how}</span>
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ readiness by kind and reason */
export function ReadinessPanel({ rows, items, onPick, onClose }) {
  const own = rows.filter((r) => r.src.key === 'hand' || r.src.key === 'linked').length;
  return (
    <SidePanel over={CV_ROOM.short} title={`Data readiness: ${own} of ${rows.length} kinds are yours`} onClose={onClose}>
      <p className={s.blockText}>A kind is ready when it&apos;s your own data and current. Anything else runs on sample data scaled to your sales, and the figures that use it say so.</p>
      <ul className={s.readyList}>
        {STEP_ORDER.map((k) => {
          const r = rows.find((x) => x.kind === k);
          const it = items.find((x) => x.kind === k);
          const st = STATE[r.src.key] || STATE.sample;
          const reason = it ? it.missing : r.entry ? `${r.entry.n.toLocaleString('en-US')} rows, ${r.entry.date}.` : r.feed ? `Sample feed, last ${r.feed.last}.` : 'Sample data until you enter it.';
          return (
            <li key={k}>
              <button type="button" className={s.readyRow} onClick={() => onPick(k)}>
                <Icon name={r.schema.icon} size={18} />
                <span className={s.readyText}><b>{r.schema.title}</b><span>{reason}</span></span>
                <span className={s.chipState}><i style={{ background: st.color }} /><Icon name={st.icon} size={13} />{st.label}</span>
                <Icon name="ChevronRight" size={16} className={s.chev} />
              </button>
            </li>
          );
        })}
      </ul>
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ a financial capability: data needed and the calculation */
export function CapabilityPanel({ kind, stake, findings, onEdit, onClose }) {
  const schema = SCHEMAS[kind];
  const need = schema.columns.filter((c) => c.required);
  const opt = schema.columns.filter((c) => !c.required);
  return (
    <SidePanel over="What this data unlocks" title={NEEDS[kind].unlocks.replace(/\.$/, '')} onClose={onClose}
      foot={<Button className={s.panelPrimary} icon={CV_D.inputs[kind] ? 'PencilLine' : 'Plus'} onClick={() => onEdit(kind)}>{CV_D.inputs[kind] ? `Update ${schema.title.toLowerCase()}` : `Enter ${schema.title.toLowerCase()}`}</Button>}>
      <div className={s.panelMoney}>
        <span className={s.panelMoneyLabel}>Potential opportunity that rests on {schema.title.toLowerCase()}</span>
        <span><b className={s.panelFig}>{usd(stake.value)}</b><span className={s.panelUnit}>/wk</span> <Claim k="est" /></span>
        {stake.blocked > 0 && <span className={s.panelClaim}><Icon name="Ban" size={13} />{usd(stake.blocked)}/wk on hold until it&apos;s entered</span>}
      </div>
      <Block title="The calculation"><p className={s.blockText}>{CALC[kind]}</p></Block>
      <Block title="Data needed" note={opt.length ? `Optional: ${opt.map((c) => c.label.toLowerCase()).join(', ')}.` : null}>
        <p className={s.blockText}>{schema.title}: {need.map((c) => c.label.toLowerCase()).join(', ')}.</p>
        <p className={s.blockNote}>{NEEDS[kind].why}</p>
      </Block>
      {findings.length > 0 && (
        <Block title={`Findings it feeds · ${findings.length}`}>
          <ul className={s.couldList}>
            {findings.map((f) => (
              <li key={f.id}>
                <span className={s.hTitle}>{f.title}</span>
                <span className={s.couldFig}>{usd(f.value)}/wk <Claim k={f.claim || 'est'} /></span>
                {f.held && <span className={s.hSub}><Icon name="Ban" size={12} style={{ verticalAlign: -1 }} /> On hold: {f.held}</span>}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ sample mode */
export function SamplePanel({ server, onAdd, onClose }) {
  return (
    <SidePanel over="Sample mode" title="You're looking at a sample restaurant group" onClose={onClose}
      foot={<>
        <Link className={`btn btn-primary ${s.panelPrimary}`} href="/connect"><Icon name="PlugZap" size={17} />Connect your POS</Link>
        <div className={s.panelMore}>
          <Button size="sm" variant="secondary" icon="Plus" onClick={onAdd}>Add your own data here</Button>
          {server && <Link className="btn btn-ghost btn-sm" href="/team"><Icon name="Users" size={15} />Team &amp; groups</Link>}
        </div>
      </>}>
      <Block title="What this is">
        <p className={s.blockText}>Rosewood is a made-up three-room group. Every figure is computed from sample data the same way it would be from yours, and it&apos;s labeled Sample wherever it&apos;s used.</p>
      </Block>
      <Block title="What you can do">
        <p className={s.blockText}>Anything you enter here replaces the sample for that kind and is labeled as yours. {server ? 'This sample is your own private copy, so nothing you change is seen by anyone else.' : 'It\'s saved in this browser only.'}</p>
      </Block>
      <Block title="Switch to real data">
        <ol className={s.steps}>
          <li><b>Connect your POS.</b> Sales, checks, voids, comps and hours come in on their own.</li>
          <li><b>Add the rest.</b> Recipe costs, counts and invoices: link a sheet, upload a file, snap a photo or type it in.</li>
          <li><b>Start your own group</b> {server ? 'from Team & groups' : 'by signing in'}, so your restaurants and teammates are kept apart from the sample.</li>
        </ol>
      </Block>
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ a linked sheet's settings */
export function LinkPanel({ link, busy, onReadNow, onUnlink, onClose }) {
  const [sure, setSure] = React.useState(false);
  const failed = link.lastResult?.failed || [];
  return (
    <SidePanel over="Linked sheet settings" title={CV_DS.rooms[link.roomId]?.profile?.short ? `${CV_DS.rooms[link.roomId].profile.short} · ${link.url.includes('dropbox') ? 'Dropbox' : 'Google Sheets'}` : 'Linked sheet'} onClose={onClose}
      foot={<div className={s.panelMore}>
        <Button size="sm" variant="secondary" icon="RefreshCw" disabled={!!busy} onClick={() => onReadNow(link)}>{busy ? 'Reading…' : 'Read it now'}</Button>
        {sure
          ? <><Button size="sm" variant="ghost" onClick={() => setSure(false)}>Keep it</Button><Button size="sm" variant="secondary" icon="Unlink" disabled={!!busy} onClick={() => onUnlink(link)}>Yes, unlink</Button></>
          : <Button size="sm" variant="ghost" icon="Unlink" onClick={() => setSure(true)}>Unlink</Button>}
      </div>}>
      <dl className={s.facts}>
        <dt>Address</dt><dd className={s.ellipsis}><a href={link.url} target="_blank" rel="noreferrer noopener">{link.url.replace(/^https:\/\//, '')}</a></dd>
        <dt>Room</dt><dd>{CV_DS.rooms[link.roomId]?.profile?.name || link.roomId}</dd>
        <dt>Schedule</dt><dd>Read every morning at 1:30 am Pacific</dd>
        <dt>Last read</dt><dd>{link.pulledAt ? when(link.pulledAt) : 'Not read yet'}</dd>
        {link.createdAt && <><dt>Linked</dt><dd>{when(link.createdAt)}</dd></>}
      </dl>
      <Block title="Tabs and what they feed" note="To change which tab feeds what, paste the same link again in Add data. The new picks replace these.">
        <ul className={s.couldList}>
          {link.picks.map((p, i) => <li key={i}><span className={s.hTitle}>{p.source.split(' · ').pop()}</span><span className={s.couldFig}>{SCHEMAS[p.kind]?.title ?? p.kind}</span></li>)}
        </ul>
      </Block>
      <Block title="Last result">
        {link.lastResult
          ? <p className={s.blockText}>{link.lastResult.committed?.length ?? 0} loaded, {link.lastResult.unchanged?.length ?? 0} unchanged, {failed.length} flagged.</p>
          : <p className={s.blockText}>Not read yet.</p>}
        {failed.map((f, i) => <p key={i} className={s.caution}><Icon name="TriangleAlert" size={16} /><span><b>{f.source.split(' · ').pop()}:</b> {f.why}</span></p>)}
        <p className={s.blockNote}>A tab that passes every check is loaded. One that doesn&apos;t is flagged here and nothing changes.</p>
      </Block>
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ add data: the universal intake, in a panel */
export function AddPanel({ children, onClose }) {
  return (
    <SidePanel over={CV_ROOM.short} title="Add data" onClose={onClose} wide>
      {children}
    </SidePanel>
  );
}
