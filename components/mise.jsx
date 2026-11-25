'use client';

import * as React from 'react';
import { Icon } from './kit';
import { Claim } from './screens/core';
import { casebook } from '../lib/ai/casebook';
import { miseLine } from '../lib/ai/mise';
import s from './mise.module.css';

/* Mise, the restaurant's brain, inside the platform. It has no page: it runs
   in the background (server/ai/mise.ts, on new data and nightly) and its
   understanding travels with every decision the platform shows, on the
   page's agent strip and on the Pass. These are the two ways it is drawn. */

/** The casebook for the room in view, from this browser's copy of the data (no logging; that stays with Consultants and the nightly pass). */
export function roomBook(d, { own, windows, group, today, levels }) {
  const rooms = Object.fromEntries((group?.rows || []).map((r) => [r.id, r.name]));
  const seeded = Object.fromEntries(Object.entries(d.room?.autonomy || {}).map(([k, [now]]) => [k, now]));
  return casebook(d, { windows: own ? windows || [] : undefined, rooms, today: own ? undefined : today, levels: { ...seeded, ...(levels || {}) } });
}

/** One quiet line under a move: what went wrong last time, else the consultant's record. */
export function MiseLine({ b }) {
  const l = miseLine(b);
  if (!l) return null;
  return <span className={`${s.line} ${l.tone === 'warn' ? s.warn : ''}`} title={l.text}><Icon name={l.tone === 'warn' ? 'History' : 'Target'} size={13} /><span className={s.lineText}>{l.text}</span></span>;
}

/** Why, how, the record, last time, who does it and how we'll know, for one move. */
export function MiseBrief({ b }) {
  if (!b) return null;
  return (
    <dl className={s.brief} aria-label="Mise: how to do it and what it knows">
      <dt>How</dt>
      <dd><ol className={s.steps}>{b.how.map((h) => <li key={h}>{h}</li>)}</ol></dd>
      {b.aim && <><dt>Its record</dt><dd>{b.aim.text}{b.aim.claim && <> <Claim k={b.aim.claim} /></>}</dd></>}
      {b.risks.length > 0 && <><dt>Last time</dt><dd>{b.risks.map((r) => <p key={r} className={s.warn}>{r}</p>)}</dd></>}
      <dt>Who does it</dt><dd><b>{b.who}</b>, A{b.level.n} {b.level.name}. {b.level.does}</dd>
      {b.measure && <><dt>How we’ll know</dt><dd>{b.measure}</dd></>}
    </dl>
  );
}

/** Mise's read of a test on a ticket: how it is pointing, or how it ended and the lesson. */
export function MiseTest({ r }) {
  if (!r) return null;
  const cls = r.tone === 'good' ? 'cv-up' : r.tone === 'bad' ? 'cv-down' : r.tone === 'warn' ? s.warn : '';
  return (
    <>
      <p className={`${s.read} ${cls}`}>{r.text}</p>
      {r.lesson && <p className={s.lesson}><Icon name="GraduationCap" size={13} />{r.lesson}</p>}
    </>
  );
}
