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
import { METHODS, NEEDS, SCHEMAS, STEP_ORDER } from '../../../lib/data/page/inputs';
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
export function Summary({ systems, rows, items, onConnections, onReadiness, onIssues }) {
  const live = systems.filter((x) => x.ok).length;
  const own = rows.filter((r) => r.src.key === 'hand' || r.src.key === 'linked').length;
  const card = (label, big, small, sub, tone, onClick, aria) => (
    <button type="button" className={`${s.stat} ${s.statBtn} ${tone ? s[tone] : ''}`} onClick={onClick} aria-label={aria}>
      <span className={s.statLabel}>{label}<Icon name="ChevronRight" size={16} className={s.chev} /></span>
      <b className={s.big}>{big}<small>{small}</small></b>
      <span className={s.statSub}>{sub}</span>
    </button>
  );
  return (
    <div className={`${s.hero} ${s.hero3}`} role="group" aria-label="Is my data working">
      {card('Connection health', live, `/${systems.length}`, live === systems.length ? 'every source is current' : 'sources current', live < systems.length ? 'statWarn' : '', onConnections, `Connection health: ${live} of ${systems.length} sources are current. Show connections.`)}
      {card('Data readiness', own, `/${rows.length}`, 'kinds are your own data', '', onReadiness, `Data readiness: ${own} of ${rows.length} kinds are your own data. Show readiness by kind.`)}
      {card('Unresolved issues', items.length, '', items.length ? 'need fixing' : 'nothing to fix', items.length ? 'statWarn' : '', onIssues, `${items.length} unresolved issue${items.length === 1 ? '' : 's'}. Go to what to fix next.`)}
    </div>
  );
}

/* ------------------------------------------------------------------ fix next: the main action area */
export function FixNext({ items, onOpen, onLink, onUnlocks, server, sample, quiet = false }) {
  const [why, setWhy] = React.useState(null);
  const [more, setMore] = React.useState(false);
  if (!items.length) {
    return (
      <div className={s.allGood}><Icon name="CircleCheck" size={22} color="var(--success-600)" /><div><b>Your data is working</b><span>Every finding at {CV_ROOM.short} has the data it needs.</span></div></div>
    );
  }
  const shown = more ? items : items.slice(0, 3);
  return (
    <>
      <div className={s.fixes}>
        {shown.map((it, i) => {
          const m = METHODS[it.method];
          const v = i === 0 && !quiet ? 'primary' : 'secondary';
          const action = it.method === 'toast'
            ? <Link className={`btn btn-${v} btn-sm`} href="/connect"><Icon name="PlugZap" size={15} />Connect Toast</Link>
            : it.method === 'link' && server
              ? <Button size="sm" variant={v} icon="Link2" onClick={() => onLink(it.kind)}>Link a sheet</Button>
              : <Button size="sm" variant={v} icon={it.method === 'type' ? 'PencilLine' : 'Upload'} onClick={() => onOpen(it.kind, it.method === 'type' ? 'grid' : 'csv')}>{it.method === 'type' ? 'Enter it' : 'Upload it'}</Button>;
          const open = why === it.kind;
          const status = it.blocked.length ? `${it.blocked.length} finding${it.blocked.length === 1 ? '' : 's'} on hold` : it.feed?.state === 'off' ? 'Missing' : it.feed?.state === 'partial' ? 'Incomplete' : 'Out of date';
          return (
            <article key={it.kind} className={`${s.fix} ${i === 0 ? s.fixTop : ''}`} aria-labelledby={`fix-${it.kind}`}>
              <div className={s.fixHead}>
                <span className={`cv-q-ico ${it.blocked.length ? 'bad' : 'warn'}`}><Icon name={SCHEMAS[it.kind].icon} size={18} /></span>
                <Pill icon="Clock">~{it.minutes} min</Pill>
              </div>
              <b id={`fix-${it.kind}`} className={s.fixTitle}>{it.title}</b>
              <span className={s.fixBig}>{status}</span>
              <button type="button" className={s.fixUnlock} onClick={() => onUnlocks(it.kind)}>
                <span><b>Fixing it unlocks:</b> {NEEDS[it.kind].unlocks.replace(/\.$/, '').toLowerCase()}</span>
                <Icon name="ChevronRight" size={15} className={s.chev} />
              </button>
              {it.exposure > 0 && (
                <span className={s.fixMeta}>{usd(it.exposure)}/wk on hold <Claim k="est" />{sample && <SampleTag />}</span>
              )}
              <div className={s.fixAct}>
                {action}
                <button type="button" className={s.whyBtn} aria-expanded={open} onClick={() => setWhy(open ? null : it.kind)}>Why?</button>
              </div>
              {open && (
                <div className={s.whyBox}>
                  <p>{it.missing}</p>
                  <p><b>Why it matters:</b> {it.why}</p>
                  <p><b>Fastest way:</b> {m.label}. {m.how}</p>
                  {it.method !== 'type' && <Button size="sm" variant="ghost" onClick={() => onOpen(it.kind, 'grid')}>Type it in instead</Button>}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {items.length > 3 && <span><Button size="sm" variant="ghost" icon={more ? 'ChevronUp' : 'ChevronDown'} aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Show fewer' : `Show ${items.length - 3} more`}</Button></span>}
    </>
  );
}

/* ------------------------------------------------------------------ connections: the systems data comes from */
const SYS = {
  healthy: { label: 'Current', tone: 'good', icon: 'CircleCheck' },
  partial: { label: 'Incomplete', tone: 'warn', icon: 'TriangleAlert' },
  stale: { label: 'Out of date', tone: 'warn', icon: 'TriangleAlert' },
  off: { label: 'Not connected', tone: 'neutral', icon: 'CircleDashed' },
};

export function Connections({ systems, sample, onToastExports, onSettings, onReadNow, busy }) {
  const [open, setOpen] = React.useState(null);
  return (
    <div className={s.conns}>
      {systems.map((x) => {
        const st = SYS[x.state] || SYS.off;
        const on = open === x.id;
        return (
          <div key={x.id} className={s.entryWrap}>
            <div className={s.connRow}>
              <button type="button" className={s.entryBtn} aria-expanded={on} aria-controls={`conn-${x.id}`} onClick={() => setOpen(on ? null : x.id)}>
                <span className={s.connName}><Icon name={x.icon} size={16} />{x.name}{x.sample && sample && <SampleTag />}</span>
                <span className={s.entryMeta}>{x.supplies}</span>
              </button>
              <Pill tone={st.tone} icon={st.icon}>{st.label}</Pill>
              <Icon name={on ? 'ChevronUp' : 'ChevronDown'} size={16} className={s.chev} />
            </div>
            {on && (
              <dl className={s.histDetail} id={`conn-${x.id}`}>
                <dt>Last data</dt><dd>{x.last}</dd>
                <dt>Recent</dt><dd>{x.state === 'healthy' || x.state === 'partial' ? 'Yes' : x.state === 'stale' ? 'No, it’s out of date' : 'Nothing has come in'}</dd>
                <dt>Complete</dt><dd>{x.state === 'healthy' ? 'Yes' : x.state === 'partial' ? 'No, part of it is missing' : x.state === 'off' ? 'Nothing has come in' : 'As of the last read'}</dd>
                <dt>Refresh</dt><dd>{x.refresh}</dd>
                {x.note && <><dt>Note</dt><dd>{x.note}</dd></>}
                {x.failed?.length > 0 && <><dt>Flagged</dt><dd>{x.failed.map((f) => `${f.source.split(' · ').pop()}: ${f.why}`).join(' ')}</dd></>}
                <dt>Controls</dt>
                <dd className="cv-row" style={{ gap: 8 }}>
                  {x.link && <Button size="sm" variant="secondary" icon="RefreshCw" disabled={!!busy} onClick={() => onReadNow(x.link)}>{busy === `pull:${x.link.id}` ? 'Reading…' : 'Read it now'}</Button>}
                  {x.link && <Button size="sm" variant="ghost" icon="Settings" onClick={() => onSettings(x.link)}>Settings</Button>}
                  {x.href && <Link className="btn btn-secondary btn-sm" href={x.href}><Icon name="PlugZap" size={15} />{x.state === 'off' ? 'Connect' : 'Manage'}</Link>}
                  {x.id === 'Toast' && <Button size="sm" variant="ghost" icon="FileArchive" onClick={onToastExports}>Upload Toast exports instead</Button>}
                </dd>
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ coverage: the kinds of data, as a compact matrix */
const Mark = ({ v }) => (v === true
  ? <span className={s.mark}><Icon name="Check" size={14} color="var(--success-600)" /><span className="sr-only">Yes</span></span>
  : v === false
    ? <span className={s.mark}><Icon name="TriangleAlert" size={14} color="var(--warning-600)" /><span className="sr-only">No</span></span>
    : <span className={`${s.mark} ${s.markNone}`}>–<span className="sr-only">Not yet</span></span>);

export function CoverageMatrix({ rows, kind, onPick }) {
  return (
    <div className={s.matrix} role="table" aria-label={`Data coverage for ${CV_ROOM.short}`}>
      <div className={`${s.mRow} ${s.mHead}`} role="row">
        <span role="columnheader">Data</span><span role="columnheader">Comes from</span>
        <span role="columnheader" className={s.mC}>Recent</span><span role="columnheader" className={s.mC}>Complete</span><span role="columnheader" className={s.mC}>Checked</span><span />
      </div>
      {STEP_ORDER.map((k) => {
        const r = rows.find((x) => x.kind === k);
        const st = STATE[r.src.key] || STATE.sample;
        const fs = r.feed?.state;
        // Sample data never earns a check mark: only your own data can be recent, complete and checked.
        const recent = r.entry ? true : fs === 'stale' ? false : null;
        const complete = r.entry ? true : fs === 'partial' ? false : null;
        const checked = r.entry ? r.last?.verified !== false : null;
        const from = r.src.key === 'linked' ? 'Linked sheet' : r.entry ? 'Entered here' : fs === 'off' ? 'Nothing yet' : 'Sample';
        return (
          <button key={k} type="button" role="row" className={`${s.mRow} ${k === kind ? s.on : ''}`} onClick={() => onPick(k)}
            aria-label={`${r.schema.title}: ${from}. Recent ${recent === true ? 'yes' : recent === false ? 'no' : 'not yet'}, complete ${complete === true ? 'yes' : complete === false ? 'no' : 'not yet'}, checked ${checked ? 'yes' : 'not yet'}. Show a preview.`}>
            <span className={s.mName} role="cell"><Icon name={r.schema.icon} size={16} />{r.schema.title}</span>
            <span className={s.mFrom} role="cell"><i style={{ background: st.color }} />{from}</span>
            <span className={s.mC} role="cell"><Mark v={recent} /></span>
            <span className={s.mC} role="cell"><Mark v={complete} /></span>
            <span className={s.mC} role="cell"><Mark v={checked} /></span>
            <Icon name="ChevronRight" size={15} className={s.chev} />
          </button>
        );
      })}
    </div>
  );
}
