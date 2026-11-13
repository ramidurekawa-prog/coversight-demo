'use client';

/* Data inputs: "What needs attention". The kinds of data that are missing or
 * stale for this room, ranked by the findings they hold back, each with what
 * is missing, why it matters, what it unlocks, the best way in, and one
 * primary action. Everything else waits behind "All seven kinds". */

import * as React from 'react';
import Link from 'next/link';

import { Button, Icon } from '../../kit';
import { CV_ROOM, Callout, Claim, Pill } from '../core';
import { METHODS, SCHEMAS } from '../../../lib/data/page/inputs';
import s from './inputs.module.css';

const usd = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

export function Attention({ items, onOpen, onLink, server }) {
  const [more, setMore] = React.useState(false);
  const shown = more ? items : items.slice(0, 3);
  if (!items.length) {
    return (
      <section className="cv-card" aria-labelledby="inputs-attention">
        <span className="cv-h4" id="inputs-attention">What needs attention</span>
        <Callout tone="good" icon="CircleCheck">Nothing is missing or stale for {CV_ROOM.short}. Every finding has the data it needs. Keep feeds current from &ldquo;All seven kinds&rdquo; below.</Callout>
      </section>
    );
  }
  return (
    <section className="cv-card" aria-labelledby="inputs-attention">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4" id="inputs-attention">What needs attention</span>
          <span className="cv-small cv-muted">{items.length} kind{items.length === 1 ? '' : 's'} of data {items.length === 1 ? 'is' : 'are'} missing or stale at {CV_ROOM.short}, most important first.</span>
        </div>
      </div>
      <ol className={s.attn}>
        {shown.map((it, i) => {
          const m = METHODS[it.method];
          const primary = it.method === 'toast'
            ? <Link className="btn btn-primary btn-sm" href="/connect"><Icon name="PlugZap" size={15} />Connect Toast</Link>
            : it.method === 'link' && server
              ? <Button size="sm" icon="Link2" onClick={() => onLink(it.kind)}>Link a sheet</Button>
              : <Button size="sm" icon={it.method === 'type' ? 'PencilLine' : 'Upload'} onClick={() => onOpen(it.kind, it.method === 'type' ? 'grid' : 'csv')}>{it.method === 'type' ? 'Enter it' : it.method === 'photo' ? 'Add it' : 'Upload it'}</Button>;
          return (
            <li key={it.kind} className={`${s.attnItem} ${i === 0 ? s.attnTop : ''}`}>
              <span className={`cv-q-ico ${it.blocked.length ? 'bad' : 'warn'}`}><Icon name={SCHEMAS[it.kind].icon} size={18} /></span>
              <div className="cv-col" style={{ gap: 6, minWidth: 0 }}>
                <div className="cv-row" style={{ gap: 8 }}>
                  <b>{it.title}</b>
                  {it.blocked.length > 0 ? <Pill tone="bad" icon="Ban">{it.blocked.length} finding{it.blocked.length === 1 ? '' : 's'} blocked</Pill> : <Pill tone="warn" icon="TriangleAlert">{it.feed?.state === 'off' ? 'Missing' : it.feed?.state === 'partial' ? 'Incomplete' : 'Stale'}</Pill>}
                  <span className="cv-xs cv-faint">Last update: {it.last}</span>
                </div>
                <span className="cv-small" style={{ fontWeight: 600 }}>{it.missing}</span>
                <dl className={s.attnFacts}>
                  <dt>Why</dt><dd>{it.why}</dd>
                  <dt>Unlocks</dt>
                  <dd>
                    {it.unlocks}
                    {it.blocked.map((b) => (
                      <span key={b.id} className={s.attnBlocked}>{b.title} · {usd(b.value)}/wk potential opportunity <Claim k={b.claim || 'est'} /></span>
                    ))}
                  </dd>
                  <dt>Best way in</dt><dd><span><Icon name={m.icon} size={13} style={{ verticalAlign: -2, marginRight: 4 }} /><b>{m.label}.</b> {m.how} About {it.minutes} min.</span></dd>
                </dl>
              </div>
              <div className={s.attnAct}>
                {primary}
                {it.method !== 'type' && <Button size="sm" variant="ghost" onClick={() => onOpen(it.kind, 'grid')}>Type it in instead</Button>}
              </div>
            </li>
          );
        })}
      </ol>
      {items.length > 3 && <span><Button size="sm" variant="ghost" icon={more ? 'ChevronUp' : 'ChevronDown'} onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Show fewer' : `Show ${items.length - 3} more`}</Button></span>}
    </section>
  );
}
