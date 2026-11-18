'use client';

/* Data & Connections, outcome first. Four questions, in order:
 * is my data working (summary), is anything missing or wrong and what should
 * I do (fix next, which also says what fixing it unlocks), and then the two
 * things people confuse kept apart: connections (the systems data comes
 * from) and coverage (the kinds of data Coversight needs). Everything
 * clickable says so with a chevron or an action label. */

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

/* ------------------------------------------------------------------ is my data working: three numbers */
/** A system counts when it's set up, or when this restaurant's findings need it. An optional one that was never connected isn't a failure. */
export const applies = (x) => x.state !== 'off' || x.required;

export function Summary({ systems, rows, items, onConnections, onReadiness, onIssues }) {
  const used = systems.filter(applies);
  const live = used.filter((x) => x.ok).length;
  const ready = rows.filter((r) => kindStatus(r, items.find((x) => x.kind === r.kind)) === 'ready').length;
  const card = (label, big, small, sub, tone, icon, onClick, aria) => (
    <button type="button" className={`${s.stat} ${s.statBtn}`} onClick={onClick} aria-label={aria}>
      <span className={s.statLabel}>{label}<Icon name="ChevronRight" size={16} className={s.chev} /></span>
      <b className={s.big}>{big}<small>{small}</small></b>
      <span className={`${s.statSub} ${s[tone]}`}><Icon name={icon} size={15} />{sub}</span>
    </button>
  );
  const connOk = live === used.length;
  return (
    <div className={`${s.hero} ${s.hero3}`} role="group" aria-label="Is my data working">
      {card('Connections', live, `/${used.length}`, connOk ? 'Healthy' : `${used.length - live} need${used.length - live === 1 ? 's' : ''} a look`, connOk ? 'subGood' : 'subWarn', connOk ? 'CircleCheck' : 'TriangleAlert', onConnections,
        `Connections: ${live} of ${used.length} systems you use are sending current data. Show connections.`)}
      {card('Data readiness', ready, `/${rows.length}`, 'Ready to use', ready === rows.length ? 'subGood' : 'subPlain', ready === rows.length ? 'CircleCheck' : 'Database', onReadiness,
        `Data readiness: ${ready} of ${rows.length} kinds of data are current, complete and checked. Show readiness by kind.`)}
      {card('Needs attention', items.length, '', items.length ? 'Action needed' : 'Nothing to fix', items.length ? 'subWarn' : 'subGood', items.length ? 'TriangleAlert' : 'CircleCheck', onIssues,
        `${items.length} thing${items.length === 1 ? '' : 's'} need attention. Go to what to fix next.`)}
    </div>
  );
}

/* ------------------------------------------------------------------ fix next: the main action area */
const stateOf = (it) => (it.feed?.state === 'off' ? 'Not started' : it.feed?.state === 'partial' ? 'Incomplete' : it.feed?.state === 'stale' ? 'Out of date' : 'Needs data');
const effort = (it) => `About ${it.minutes} min${it.method === 'type' ? '' : it.method === 'toast' ? ' to connect' : ' if you already keep this in a file'}`;

function FixAction({ it, primary, big, server, onOpen, onLink }) {
  const v = primary ? 'primary' : 'secondary';
  const size = big ? undefined : 'sm';
  const label = actionLabel(it.kind, it.method === 'link' && !server ? 'upload' : it.method);
  if (it.method === 'toast') return <Link className={`btn btn-${v} ${big ? '' : 'btn-sm'}`} href="/connect"><Icon name="PlugZap" size={15} />{label}</Link>;
  if (it.method === 'link' && server) return <Button size={size} variant={v} icon="Link2" onClick={() => onLink(it.kind)}>{label}</Button>;
  return <Button size={size} variant={v} icon={it.method === 'type' ? 'PencilLine' : 'Upload'} onClick={() => onOpen(it.kind, it.method === 'type' ? 'grid' : 'csv')}>{label}</Button>;
}

export function FixNext({ items, onOpen, onLink, onUnlocks, server, sample, quiet = false }) {
  const [why, setWhy] = React.useState(null);
  const [more, setMore] = React.useState(false);
  if (!items.length) {
    return (
      <div className={s.allGood}><Icon name="CircleCheck" size={22} color="var(--success-600)" /><div><b>Nothing to fix</b><span>Every finding at {CV_ROOM.short} has the data it needs.</span></div></div>
    );
  }
  const [top, ...rest] = items;
  const shown = more ? rest : rest.slice(0, 2);
  const Why = ({ it }) => (
    <div className={s.whyBox} id={`why-${it.kind}`}>
      <p>{it.missing} {it.why}</p>
      <p><b>Fastest way:</b> {METHODS[it.method].label}. {METHODS[it.method].how}</p>
      <div className="cv-row" style={{ gap: 8 }}>
        <Button size="sm" variant="ghost" icon="Calculator" onClick={() => onUnlocks(it.kind)}>See the data needed and the calculation</Button>
        {it.method !== 'type' && <Button size="sm" variant="ghost" icon="PencilLine" onClick={() => onOpen(it.kind, 'grid')}>Type it in instead</Button>}
      </div>
    </div>
  );
  const whyBtn = (it) => <button type="button" className={s.whyBtn} aria-expanded={why === it.kind} aria-controls={`why-${it.kind}`} onClick={() => setWhy(why === it.kind ? null : it.kind)}>Why this matters<Icon name={why === it.kind ? 'ChevronUp' : 'ChevronDown'} size={15} /></button>;
  return (
    <>
      <article className={s.fixTop} aria-labelledby={`fix-${top.kind}`}>
        <div className={s.fixTopMain}>
          <span className={s.fixKicker}><Icon name={SCHEMAS[top.kind].icon} size={16} />{stateOf(top)}{top.blocked.length > 0 && ` · ${top.blocked.length} finding${top.blocked.length === 1 ? '' : 's'} on hold`}</span>
          <b id={`fix-${top.kind}`} className={s.fixTopTitle}>{top.title}</b>
          <p className={s.fixBenefit}>Unlocks {NEEDS[top.kind].unlocks.replace(/\.$/, '').toLowerCase()}.</p>
          {top.exposure > 0 && <span className={s.fixMeta}>{usd(top.exposure)}/wk potential on hold <Claim k="est" />{sample && <SampleTag />}</span>}
        </div>
        <div className={s.fixTopAct}>
          <FixAction it={top} primary={!quiet} big server={server} onOpen={onOpen} onLink={onLink} />
          <span className={s.fixEffort}>{effort(top)}</span>
          {whyBtn(top)}
        </div>
        {why === top.kind && <Why it={top} />}
      </article>
      {shown.length > 0 && (
        <div className={s.fixRest}>
          {shown.map((it) => (
            <article key={it.kind} className={s.fixRow} aria-labelledby={`fix-${it.kind}`}>
              <div className={s.fixRowLine}>
                <Icon name={SCHEMAS[it.kind].icon} size={18} className={s.fixRowIco} />
                <div className={s.fixRowText}>
                  <b id={`fix-${it.kind}`}>{it.title}</b>
                  <span>{stateOf(it)} · unlocks {NEEDS[it.kind].unlocks.replace(/\.$/, '').toLowerCase()}</span>
                </div>
                {whyBtn(it)}
                <FixAction it={it} server={server} onOpen={onOpen} onLink={onLink} />
              </div>
              {why === it.kind && <Why it={it} />}
            </article>
          ))}
        </div>
      )}
      {rest.length > 2 && <span><Button size="sm" variant="ghost" icon={more ? 'ChevronUp' : 'ChevronDown'} aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Show fewer' : `Show ${rest.length - 2} more`}</Button></span>}
    </>
  );
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

/* ------------------------------------------------------------------ ready: the kinds with nothing to fix */
export function ReadyList({ rows, items, kind, sample, onPick }) {
  const ready = STEP_ORDER.map((k) => rows.find((x) => x.kind === k)).filter((r) => kindStatus(r, items.find((x) => x.kind === r.kind)) === 'ready');
  if (!ready.length) return null;
  return (
    <div className={s.matrix} role="list" aria-label={`Data that is ready at ${CV_ROOM.short}`}>
      {ready.map((r) => {
        const own = r.src.key === 'hand' || r.src.key === 'linked';
        const from = own ? `${r.src.key === 'linked' ? 'Linked sheet' : 'Entered by your team'} · ${r.entry.date}` : `${sample ? 'Sample data' : 'Starter data'}${r.feed ? ` · updated ${r.feed.last}` : ''}`;
        return (
          <button key={r.kind} type="button" role="listitem" className={`${s.mRow} ${r.kind === kind ? s.on : ''}`} onClick={() => onPick(r.kind)}
            aria-label={`${r.schema.title}: ready. ${from}. Used for ${AFFECTS[r.kind].toLowerCase()}. View or update.`}>
            <span className={s.mName}><Icon name={r.schema.icon} size={16} />{r.schema.title}</span>
            <span className={s.mFrom}>{from}</span>
            <span className={s.mFrom}>{AFFECTS[r.kind]}</span>
            <span className={s.mGo}>View or update<Icon name="ChevronRight" size={15} className={s.chev} /></span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ the one way in: drop anything */
export function DropStrip({ over, onFiles, onPhoto, onConnect, onType }) {
  const ref = React.useRef(null);
  const cam = React.useRef(null);
  return (
    <div className={`${s.dropStrip} ${over ? s.dropOver : ''}`}>
      <span className={s.dropStripIco}><Icon name="FileSpreadsheet" size={20} /></span>
      <span className={s.dropStripText}><b className={s.notPhone}>{over ? 'Drop it anywhere' : 'Drop any file, photo or PDF anywhere on this page'}</b><b className={s.onlyPhone}>Add a file or a photo</b><span>Coversight works out what it is and shows you before anything changes.</span></span>
      <span className={s.sampleActs}>
        <Button size="sm" variant="secondary" icon="Upload" onClick={() => ref.current?.click()}>Choose a file</Button>
        <span className={s.onlyPhone}><Button size="sm" variant="secondary" icon="Camera" onClick={() => cam.current?.click()}>Take a photo</Button></span>
        <Button size="sm" variant="ghost" icon="PlugZap" onClick={onConnect}>Connect software or a sheet</Button>
        <Button size="sm" variant="ghost" icon="PencilLine" onClick={onType}>Type it in</Button>
      </span>
      <input ref={cam} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onPhoto(f); }} />
      <input ref={ref} type="file" multiple style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onFiles(f); }} />
    </div>
  );
}
