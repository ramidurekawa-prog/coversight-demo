'use client';

import * as React from 'react';
import { Icon } from '../kit';
import { TEAMMATE, proofPlain, roomReason, scheduleFit, serviceChecks } from '../../lib/data/touches';

/* Quiet additions from the competitor scan. Each one is a single line or chip
 * inside something that already exists, opens its detail in place (never a
 * new page), and shows nothing when it has nothing to say. Numbers come from
 * lib/data/touches.js, which reads the derived room. */

const quiet = { color: 'var(--fg-3)' };

/** "Spotted by Sous": a tiny tag on a card the AI found. */
export function SpottedBy({ style }) {
  return (
    <span className="cv-xs" style={{ ...quiet, display: 'inline-flex', alignItems: 'center', gap: 4, ...style }}>
      <Icon name="Eye" size={12} />Spotted by {TEAMMATE}
    </span>
  );
}

/** "How we know": opens a one-line method under a proven dollar figure. */
export function HowWeKnow({ proof }) {
  const [open, setOpen] = React.useState(false);
  const text = proofPlain(proof);
  if (!text) return null;
  return (
    <span className="cv-col" style={{ gap: 4 }}>
      <button type="button" className="cv-link" style={{ fontWeight: 500, fontSize: 'var(--text-xs)' }} aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <Icon name="BadgeCheck" size={13} />How we know<Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={12} />
      </button>
      {open && <span className="cv-xs" style={{ color: 'var(--fg-2)', lineHeight: 1.5, maxWidth: 420 }}>{proof.title}: {text}</span>}
    </span>
  );
}

/** One grey line under a room's name: the reason it ranks where it does. */
export function RoomReason({ d }) {
  const r = roomReason(d);
  if (!r) return null;
  return <span className="cv-xs" style={{ display: 'block', fontWeight: 400, marginTop: 2, color: r.tone === 'good' ? 'var(--money-up)' : 'var(--fg-3)' }}>{r.text}</span>;
}

/** A small "N of M checks green" chip; the checks open in place. */
export function ServiceCheck({ d, period }) {
  const [open, setOpen] = React.useState(false);
  const c = serviceChecks(d);
  if (!c.total) return null;
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className={`cv-pill ${c.good === c.total ? 'good' : c.good ? 'neutral' : 'warn'}`} style={{ cursor: 'pointer' }} aria-expanded={open} onClick={() => setOpen((x) => !x)}
        title="Quick checks from your own data, like a mystery shop on every shift">
        <Icon name="ClipboardCheck" size={13} />{period}: {c.good} of {c.total} checks green<Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={12} />
      </button>
      {open && (
        <ul className="cv-card" style={{ listStyle: 'none', margin: 0, padding: 12, gap: 8, minWidth: 300, textAlign: 'left', position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 20, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)' }}>
          {c.list.map((x) => (
            <li key={x.k} className="cv-row nowrap" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Icon name={x.ok ? 'CircleCheck' : 'CircleDot'} size={15} style={{ color: x.ok ? 'var(--money-up)' : 'var(--warning-600)', flex: 'none', marginTop: 2 }} />
              <span className="cv-col" style={{ gap: 1 }}><span className="cv-small" style={{ fontWeight: 600 }}>{x.label}</span><span className="cv-xs" style={quiet}>{x.detail}</span></span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** A grade chip for a schedule, before anyone posts it. */
export function ScheduleGrade({ day }) {
  const g = scheduleFit(day);
  if (!g) return null;
  return (
    <span className={`cv-pill ${g.good ? 'good' : 'warn'}`} style={{ alignSelf: 'flex-start' }} title={`${g.off} server-hours off what each hour needs`}>
      <Icon name={g.good ? 'CircleCheck' : 'CircleDot'} size={13} />Schedule grade {g.grade} · {Math.round(g.fit * 100)}% of hours match
    </span>
  );
}
