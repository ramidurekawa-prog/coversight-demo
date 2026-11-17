'use client';

/* Data inputs: every commit, who made it, what it moved, and an undo for the
 * one each room holds now. Resetting the whole group is the owner's call. */

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { CV_D, CV_DS, CV_ROOM, Pill, useCv } from '../core';
import { engine } from '../../engine';
import { SCHEMAS } from '../../../lib/data/page/inputs';
import { undoEntry, useHistory } from './inputs-data';
import s from './inputs.module.css';

const META = (k) => SCHEMAS[k] || (k === 'toast' ? { title: 'Toast exports', icon: 'PlugZap' } : { title: k, icon: 'FilePen' });
const SOURCE = { grid: 'typed in', csv: 'pasted CSV', file: 'uploaded file', paste: 'pasted', link: 'linked sheet', photo: 'read from a photo', toast: 'Toast export' };
const roomName = (id) => CV_DS.rooms[id]?.profile?.short || id;

export function History({ server, onChanged, kindFilter = '' }) {
  const cv = useCv();
  const [scope, setScope] = React.useState('room');
  const [kind, setKind] = React.useState(kindFilter);
  const [open, setOpen] = React.useState(null);
  React.useEffect(() => { setKind(kindFilter); }, [kindFilter]);
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(null);
  const hist = useHistory({ server, roomId: scope === 'room' ? CV_D.id : null, kind: kind || null });
  const many = Object.keys(CV_DS.rooms).length > 1;

  const undo = async (e) => {
    setBusy(e.id);
    try {
      await undoEntry(e.id);
      cv.toast(`Undone. ${META(e.kind).title} at ${roomName(e.room)} is back to what it was before.`);
      onChanged?.();
    } catch (err) { cv.toast(`Couldn’t undo: ${err.message}`); } finally { setBusy(null); }
  };
  const reset = () => { engine.reset(); setConfirm(false); cv.toast('Back to the sample data. Every hand-entered row is cleared, and the history keeps a record.'); };

  return (
    <section className="cv-card" aria-labelledby="inputs-history">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4" id="inputs-history">History</span>
          <span className="cv-small cv-muted">Who changed what. Undo the latest one per kind.</span>
        </div>
        <div className={s.filters}>
          {many && (
            <select className={s.select} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Which rooms">
              <option value="room">{CV_ROOM.short} only</option>
              <option value="all">All your rooms</option>
            </select>
          )}
          <select className={s.select} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Which kind of data">
            <option value="">Every kind</option>
            {Object.keys(SCHEMAS).map((k) => <option key={k} value={k}>{SCHEMAS[k].title}</option>)}
            <option value="toast">Toast exports</option>
          </select>
        </div>
      </div>

      {hist.error && <span className="cv-small cv-down">Couldn’t load the history: {hist.error}</span>}
      {!hist.entries.length && !hist.loading && !hist.error && (
        <div className="cv-row nowrap" style={{ gap: 12, padding: '6px 0' }}>
          <span className="cv-q-ico"><Icon name="History" size={16} /></span>
          <span className="cv-small cv-muted">Nothing entered{kind ? ` for ${META(kind).title.toLowerCase()}` : ''}{scope === 'room' ? ` at ${CV_ROOM.short}` : ''} yet.</span>
        </div>
      )}
      {hist.entries.length > 0 && (
        <div className="cv-col" style={{ gap: 0 }}>
          {hist.entries.map((e) => {
            const status = e.undone ? { tone: 'neutral', icon: 'Undo2', label: 'Undone' } : e.current ? { tone: 'good', icon: 'CircleCheck', label: 'In use' } : { tone: 'neutral', icon: 'History', label: 'Replaced later' };
            const on = open === e.id;
            const moves = e.effects?.moves || [];
            return (
              <div key={e.id} className={`${s.entryWrap} ${e.undone || !e.current ? s.gone : ''}`}>
                <div className={s.entry}>
                  <span className="cv-q-ico" style={{ width: 32, height: 32 }}><Icon name={META(e.kind).icon} size={15} /></span>
                  <button type="button" className={s.entryBtn} aria-expanded={on} aria-controls={`hist-${e.id}`} onClick={() => setOpen(on ? null : e.id)}>
                    <span className={s.entryTitle}>{META(e.kind).title}{scope === 'all' ? ` · ${roomName(e.room)}` : ''} · {e.rows.toLocaleString('en-US')} row{e.rows === 1 ? '' : 's'} <Pill tone={status.tone} icon={status.icon}>{status.label}</Pill></span>
                    <span className={s.entryMeta}>{e.at} · {e.by.kind === 'link' ? 'read from a linked sheet' : `by ${e.by.kind === 'you' ? 'you' : e.by.name}`}{e.source && e.by.kind !== 'link' ? ` · ${SOURCE[e.source] || e.source}` : ''}</span>
                  </button>
                  <Icon name={on ? 'ChevronUp' : 'ChevronDown'} size={16} className={s.chev} />
                  {e.current && !e.undone && <Button size="sm" variant="secondary" icon="Undo2" disabled={!!busy} onClick={() => undo(e)}>{busy === e.id ? 'Undoing…' : 'Undo'}</Button>}
                </div>
                {on && (
                  <dl className={s.histDetail} id={`hist-${e.id}`}>
                    <dt>Source</dt><dd>{e.by.kind === 'link' ? 'Linked sheet' : SOURCE[e.source] || e.source || 'Entered here'}{e.file ? ` · ${e.file}` : ''}</dd>
                    {e.counts && <><dt>Rows</dt><dd>{e.counts.added ?? 0} new, {e.counts.updated ?? 0} updated{e.counts.duplicates ? `, ${e.counts.duplicates} already logged` : ''}</dd></>}
                    {e.validation && <><dt>Checks</dt><dd>{e.validation.warnings ?? 0} warning{e.validation.warnings === 1 ? '' : 's'}{e.validation.rejected ? `, ${e.validation.rejected} rejected` : ''}</dd></>}
                    {e.mapping && Object.keys(e.mapping).length > 0 && <><dt>Columns</dt><dd>{Object.entries(e.mapping).map(([from, to]) => `${from} → ${to}`).join(', ')}</dd></>}
                    {moves.length > 0 && <><dt>Moved</dt><dd><ul className={s.histMoves}>{moves.slice(0, 6).map((m, i) => <li key={i}>{m}</li>)}</ul></dd></>}
                    {e.effects?.unblocked?.length > 0 && <><dt>Unblocked</dt><dd>{e.effects.unblocked.length} finding{e.effects.unblocked.length === 1 ? '' : 's'}</dd></>}
                    {e.effects?.tests?.length > 0 && <><dt>Tests</dt><dd>{e.effects.tests.length} running test{e.effects.tests.length === 1 ? '' : 's'} flagged for review</dd></>}
                    {e.summary && <><dt>Summary</dt><dd>{e.summary}</dd></>}
                    {e.verified != null && <><dt>Stored</dt><dd>{e.verified ? 'Verified: what was saved matches what was sent' : 'Stored rows didn’t match what was sent'}</dd></>}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      )}
      {(hist.more || hist.loading) && <span><Button size="sm" variant="ghost" icon="ChevronDown" disabled={hist.loading} onClick={hist.loadMore}>{hist.loading ? 'Loading…' : 'Show older'}</Button></span>}

      {hist.canReset && (
        <div className="cv-row" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12, justifyContent: 'space-between' }}>
          <span className="cv-xs cv-faint">{server ? 'Saved to your account and kept for every teammate.' : 'Saved in this browser only.'}</span>
          {confirm ? (
            <span className="cv-row" style={{ gap: 8 }}>
              <span className="cv-small">Clear every hand-entered row in every room?</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep them</Button>
              <Button size="sm" variant="secondary" icon="RotateCcw" onClick={reset}>Yes, reset</Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" icon="RotateCcw" disabled={!server && !engine.get().log.length} onClick={() => setConfirm(true)}>Reset to sample data</Button>
          )}
        </div>
      )}
    </section>
  );
}
