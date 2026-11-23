'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { ASSIGNEES, assigneeLabel, DECLINE, worthOf, unlocksOf } from '../../../lib/data/page/today';
import { AREAS, areaOf, carriedOut } from '../../../lib/data/page/today-brief';
import { CV_CLAIM, CV_D, Claim, useCv } from '../core';
import { StaffingEvidence, StaffingHours, StaffingReadiness } from '../staffing';
import s from './today.module.css';

/* The review panel: one recommendation, opened in place. A side panel on a
 * desktop, the full screen on a phone. Problem, evidence, what we suggest,
 * what it's worth (and how sure), limits, who decides, then the choices. */

/** A dialog that keeps focus inside, closes on Escape, and gives focus back. */
export function Panel({ label, onClose, children, wide = false }) {
  const ref = React.useRef(null);
  const back = React.useRef(null);
  React.useEffect(() => {
    back.current = document.activeElement;
    const el = ref.current;
    el?.querySelector('[data-autofocus]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const f = [...el.querySelectorAll('button:not([disabled]), a[href], select, input, [tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
      back.current?.focus?.();
    };
  }, [onClose]);
  return (
    <div className={s.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`${s.panel} ${wide ? s.panelWide : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function PanelHead({ over, title, onClose }) {
  return (
    <div className={s.panelHead}>
      <div className={s.panelHeadText}>
        {over && <span className={s.panelOver}>{over}</span>}
        <h2 className={s.panelTitle} tabIndex={-1} data-autofocus>{title}</h2>
      </div>
      <button type="button" className={s.iconBtn} aria-label="Close" onClick={onClose}><Icon name="X" size={18} /></button>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <section className={s.block}>
      <h3 className={s.blockTitle}>{title}</h3>
      {children}
    </section>
  );
}

/** Who can act on a card, by its kind. */
function whoDecides(q) {
  if (q.staffing) return 'The GM or the owner approves a schedule change. A floor manager can review it, mark it made and add clock-ins.';
  if (q.approval) return 'The owner or the room’s GM approves. Anyone can be asked to review it first.';
  if (q.task) return `Whoever runs ${q.task.system} for this room makes the change.`;
  if (q.kind === 'data') return 'Anyone with access to the data can do this.';
  return 'The GM or the owner.';
}

/**
 * @param {{ q: any, cards: any[], history: any[], fix: any, busy: boolean, label: string, onClose: () => void, caution?: string|null,
 *   people?: { id: string, name: string, roleLabel: string }[], held?: any, meId?: string|null,
 *   act: { primary: () => void, snooze: () => void, decline: (r: string) => void, assign: (to: string, name?: string) => void, ack: () => void, done: () => void, open?: () => void } }} p
 */
export function ReviewPanel({ q, cards, history, fix, busy, label, onClose, act, caution, people = [], held = null, meId = null, onService, onFixData }) {
  const cv = useCv();
  const st = q.staffing || null;
  const forMe = !!(held && meId && held.to === meId);
  const [asking, setAsking] = React.useState(null); // 'decline' | 'assign' | null
  const w = worthOf(q);
  const un = w.figure ? null : unlocksOf(q, cards);
  const how = carriedOut(q);
  const claim = CV_CLAIM[un ? un.claim : q.claim];
  const mine = history.filter((h) => h.cardId === q.id);
  const canSnooze = !q.critical && q.deadline !== 'today';
  const canDecline = q.refuse && !q.critical;
  const area = AREAS[areaOf(q)];
  const through = q.source?.through ? new Date(`${q.source.through}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
  return (
    <Panel label={q.title} onClose={onClose}>
      <PanelHead over={[area, q.deadline === 'today' ? 'Due today' : q.deadline ? `Due ${q.deadline}` : null].filter(Boolean).join(' · ')} title={q.title} onClose={onClose} />
      <div className={s.panelBody}>
        {held && (
          <p className={s.heldNote} role="status"><Icon name="UserCheck" size={15} /><span>{forMe ? 'Handed to you' : `With ${assigneeLabel(held.to, CV_D.profile, held.name)}`}{held.ack ? ` · seen ${new Date(held.ack.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ' · not seen yet'}</span>
            {forMe && !held.ack && <Button size="sm" icon="Check" disabled={busy} onClick={act.ack}>Got it</Button>}</p>
        )}
        {caution && (
          <p className={s.caution} role="note"><Icon name="TriangleAlert" size={15} /><span>{caution}</span></p>
        )}
        <Block title="What we see">
          <p className={s.blockText}>{q.body}</p>
        </Block>

        <Block title="The money">
          {w.figure || un ? (
            <div className={s.panelMoney}>
              <span className={s.panelMoneyLabel}>{un ? 'What finishing this unlocks' : w.means}</span>
              <span className={s.panelFig}>{w.about && <span className={s.about}>about </span>}{w.figure || un.figure}<span className={s.panelUnit}> {(w.unit || un?.unit || '').replace(/^\//, 'a ').replace('a wk', 'a week')}</span></span>
              <span className={s.panelClaim}><Claim k={un ? un.claim : q.claim} /><span>{claim?.tip}</span></span>
            </div>
          ) : (
            <p className={s.blockText}>{w.note || 'No dollar figure for this one.'} {q.kind === 'data' ? 'It keeps the other numbers right.' : ''}</p>
          )}
          {/prevent|avoid/i.test(`${q.value} ${q.means}`) && <p className={s.blockNote}>Money that’s avoided is never counted as saved.</p>}
        </Block>

        {st?.hoursRows && (
          <Block title={`${st.label}, hour by hour`}>
            <StaffingHours dec={st} />
          </Block>
        )}

        {st?.state === 'blocked' && (
          <Block title="What the staffing check needs">
            <StaffingReadiness readiness={st.readiness} onFix={(f) => { onClose(); if (onFixData) onFixData(f); else cv.go('inputs', { kind: f.kind, date: f.date, meal: f.meal, back: 'today' }); }} />
          </Block>
        )}

        {st?.forecast ? (
          <Block title="Evidence">
            <StaffingEvidence dec={st} />
            {onService && <button type="button" className={s.textLink} onClick={onService}>Open {st.label.toLowerCase()} in Service<Icon name="ArrowRight" size={13} /></button>}
          </Block>
        ) : (
        <Block title="Evidence">
          <dl className={s.facts}>
            <dt>Why it’s here</dt><dd>{q.why}</dd>
            <dt>Data</dt><dd>{st ? ({ hand: 'Your entries on Data', toast: 'Your Toast data', sample: 'Sample restaurant data' }[st.readiness?.source] || 'Your data') : q.source?.kind === 'toast' ? 'Your Toast data' : 'Sample restaurant data'}{through && !st ? `, through ${through}` : ''}</dd>
            {q.blocked && <><dt>Waiting on</dt><dd>{fix ? `${fix.title}. ` : ''}{q.blocked}</dd></>}
          </dl>
          {act.open && <button type="button" className={s.textLink} onClick={act.open}>See the full numbers<Icon name="ArrowRight" size={13} /></button>}
        </Block>
        )}

        <Block title="If you go ahead">
          <p className={s.blockText}>{st?.state === 'act' ? `${st.short}. Approving records the decision; someone still changes ${st.system.toLowerCase()} and tells the person. After the shift, clock-ins show whether it happened.` : how.text}</p>
          {(q.task?.diff || (st?.state === 'act' && st.diff)) && (
            <table className={s.diff}>
              <thead><tr><th scope="col">What</th><th scope="col">Now</th><th scope="col">After</th></tr></thead>
              <tbody>{(q.task?.diff || st.diff).map((r, i) => <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
            </table>
          )}
        </Block>

        <Block title="Who decides">
          <p className={s.blockText}>{whoDecides(q)}</p>
          {mine.length > 0 && (
            <ul className={s.hist}>
              {mine.map((h, i) => <li key={i}>{h.op === 'assign' ? `Assigned to ${assigneeLabel(h.to, CV_D.profile, h.name)}` : h.op === 'ack' ? 'Seen' : { done: 'Marked done', refuse: 'Turned down', snooze: 'Snoozed', undo: 'Put back', reset: 'Reset' }[h.op]}{h.by?.you ? ', by you' : h.by?.name ? `, by ${h.by.name}` : ''}</li>)}
            </ul>
          )}
        </Block>
      </div>

      <div className={s.panelFoot}>
        {asking === 'decline' && (
          <div className={s.ask} role="group" aria-label="Why isn’t this for you?">
            <span className={s.askQ}>Why not?</span>
            {Object.entries(DECLINE).map(([k, d]) => <button key={k} type="button" className={s.choice} disabled={busy} onClick={() => { setAsking(null); act.decline(k); }}>{d.label}</button>)}
            <button type="button" className={s.textBtn} onClick={() => setAsking(null)}>Cancel</button>
          </div>
        )}
        {asking === 'assign' && (
          <div className={s.ask} role="group" aria-label="Assign to">
            <span className={s.askQ}>Assign to</span>
            {people.filter((p) => p.id !== meId).map((p) => <button key={p.id} type="button" className={s.choice} disabled={busy} onClick={() => { setAsking(null); act.assign(p.id, p.name); }}>{p.name} <span className={s.choiceSub}>{p.roleLabel}</span></button>)}
            {Object.keys(ASSIGNEES).map((k) => <button key={k} type="button" className={s.choice} disabled={busy} onClick={() => { setAsking(null); act.assign(k); }}>{assigneeLabel(k, CV_D.profile)}</button>)}
            <button type="button" className={s.textBtn} onClick={() => setAsking(null)}>Cancel</button>
          </div>
        )}
        {!asking && (
          <>
            <Button size="lg" className={s.panelPrimary} disabled={busy} onClick={act.primary}>{label}</Button>
            <div className={s.panelMore}>
              <Button size="sm" variant="secondary" icon="UserPlus" disabled={busy} onClick={() => setAsking('assign')}>Assign</Button>
              {canSnooze && <Button size="sm" variant="secondary" disabled={busy} onClick={act.snooze}>Not now</Button>}
              {canDecline && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsking('decline')}>{st ? 'Keep the schedule' : 'Not for us'}</Button>}
              {q.go && !q.blocked && !q.approval && <Button size="sm" variant="ghost" disabled={busy} onClick={act.done}>Already done</Button>}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
