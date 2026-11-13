'use client';

/* Data inputs: where each kind of this room's data comes from now. One row
 * per kind, in the order that gets a sensible room fastest; picking a row
 * opens it in the editor below. */

import * as React from 'react';

import { Icon } from '../../kit';
import { CV_D, CV_ROOM, Pill } from '../core';
import { OWN_STEPS, SCHEMAS, STEP_ORDER, sourceOf } from '../../../lib/data/page/inputs';
import s from './inputs.module.css';

const TONE_ICO = { good: 'good', info: 'accent', warn: 'warn', neutral: '' };

export function boardRows(links, history) {
  const linkedKinds = new Set(links.filter((l) => l.roomId === CV_D.id).flatMap((l) => l.picks.map((p) => p.kind)));
  return STEP_ORDER.map((kind) => {
    const schema = SCHEMAS[kind];
    const entry = CV_D.inputs[kind];
    const feed = schema.feed ? CV_D.feeds.find((f) => f.name === schema.feed) : null;
    const src = sourceOf({ entry, feed, linked: linkedKinds.has(kind) });
    const last = history.find((e) => e.kind === kind && e.room === CV_D.id && e.current);
    return { kind, schema, entry, feed, src, last };
  });
}

export function StatusBoard({ rows, kind, onPick, open, setOpen }) {
  const count = (k) => rows.filter((r) => r.src.key === k).length;
  const mine = count('hand'), linked = count('linked'), stale = count('stale');
  const total = rows.length;
  const pct = (n) => `${(n / total) * 100}%`;
  const ownDone = Object.keys(OWN_STEPS).filter((k) => CV_D.inputs[k]).length;
  return (
    <section className={`cv-card ${s.board}`} aria-labelledby="inputs-board">
      <div className={s.boardHead}>
        <div className="cv-col" style={{ gap: 4 }}>
          <button type="button" className={s.boardToggle} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="inputs-board-rows">
            <span className="cv-h4" id="inputs-board" style={{ color: 'var(--fg-1)' }}>All seven kinds of data</span>
            <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} />
          </button>
          <span className="cv-small cv-muted" style={{ maxWidth: '68ch' }}>
            {mine + linked === 0
              ? <>Every kind below is sample data. Work down the numbered steps (about 15 minutes) and {CV_ROOM.short} runs on your own numbers; whatever you skip stays sample data, scaled to your sales.</>
              : <>{mine + linked} of {total} kinds are your own data{ownDone < 5 ? `; ${5 - ownDone} of the 5 first steps to go` : ''}. The rest stays sample data, scaled to your sales.</>}
          </span>
        </div>
        <div className="cv-col" style={{ gap: 6, alignItems: 'flex-end', flex: '0 1 360px' }}>
          <div className={s.meter} role="img" aria-label={`${mine} entered, ${linked} linked, ${stale} stale, ${total - mine - linked - stale} sample`}>
            <span className={s.mine} style={{ width: pct(mine) }} />
            <span className={s.linked} style={{ width: pct(linked) }} />
            <span className={s.stale} style={{ width: pct(stale) }} />
          </div>
          <div className={s.legend} aria-hidden="true">
            <span><i className={s.mine} />Yours {mine}</span>
            <span><i className={s.linked} />Linked {linked}</span>
            <span><i className={s.stale} />Stale {stale}</span>
            <span><i className={s.sample} />Sample {total - mine - linked - stale}</span>
          </div>
        </div>
      </div>
      {open && <div className={s.rows} role="list" aria-label={`Data kinds for ${CV_ROOM.short}`} id="inputs-board-rows">
        <div className={`${s.row} ${s.rowHead}`} aria-hidden="true"><span>Step</span><span>Data</span><span>Source</span><span>Last change</span><span style={{ textAlign: 'right' }}>Rows</span><span /></div>
        {rows.map(({ kind: k, schema, entry, feed, src, last }) => {
          const step = STEP_ORDER.indexOf(k) + 1;
          const own = k in OWN_STEPS;
          return (
            <button key={k} type="button" role="listitem" className={`${s.row} ${k === kind ? s.on : ''}`} onClick={() => onPick(k)} aria-current={k === kind ? 'true' : undefined} data-kind={k}>
              <span className={`${s.step} ${entry ? s.done : ''}`} title={own ? 'One of the five first steps' : 'Optional'}>{entry ? <Icon name="Check" size={12} /> : own ? step : '·'}</span>
              <span className={s.what}>
                <span className={`cv-q-ico ${TONE_ICO[src.tone]} ${s.ico}`}><Icon name={schema.icon} size={16} /></span>
                <span className="cv-col" style={{ gap: 1, minWidth: 0 }}>
                  <b>{schema.title}</b>
                  <span className={s.sub}>{OWN_STEPS[k] || schema.blurb.split('. ')[0].replace(/\.$/, '')}</span>
                </span>
              </span>
              <span><Pill tone={src.tone} icon={src.icon}>{src.label}</Pill></span>
              <span className={s.when}>
                {entry ? <>{entry.date}<span>{last ? `by ${last.by.name === 'You' ? 'you' : last.by.name}` : 'entered here'}</span></> : feed ? <>{feed.last}<span>{feed.state === 'healthy' ? 'from the sample feed' : `feed ${feed.state}`}</span></> : <>Sample<span>until you enter it</span></>}
              </span>
              <span className={s.n}>{entry ? entry.n.toLocaleString('en-US') : '—'}</span>
              <span className={s.go}>{k === kind ? 'Editing' : entry ? 'Update' : 'Enter'} <Icon name={k === kind ? 'ChevronDown' : 'ChevronRight'} size={14} /></span>
            </button>
          );
        })}
      </div>}
    </section>
  );
}
