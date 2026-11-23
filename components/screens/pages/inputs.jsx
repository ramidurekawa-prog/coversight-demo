'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button, Icon } from '../../kit';
import { CV_D, CV_DS, CV_ROOM, PageHead, Pill, useCv } from '../core';
import { useEngine } from '../../engine';
import { KINDS } from '../../../lib/data/ingest';
import { SCHEMAS, attention, blockedWhy, dependsOn, pageState, safeCSV, stakes } from '../../../lib/data/page/inputs';
import { AddWays, Connections, DataRows, applies } from './inputs-visual';
import { ToastImport } from '../toast-import';
import { BringIn } from '../bring-in';
import { boardRows } from './inputs-board';
import { Editor } from './inputs-editor';
import { History } from './inputs-history';
import { host, useLinkActions, when } from './inputs-links';
import { AddPanel, CapabilityPanel, KindPanel, LinkPanel, ReadinessPanel, SamplePanel, SidePanel } from './inputs-panels';
import { undoEntry, useHistory, useLinks } from './inputs-data';
import { templateRows } from '../../../lib/data/ingest';
import { useTodayTheme } from './today.themes';
import { StaffingReadiness, useStaffingInputs } from '../staffing';
import { shortDate, staffingDecision } from '../../../lib/data/page/staffing';
import { localNow } from '../../../lib/data/page/service';
import s from './inputs.module.css';

/* Add & Manage Data. Outcome and action first: is the data working, what
 * needs fixing and what fixing it unlocks. Then connections (the systems) kept
 * apart from coverage (the kinds of data). Adding data has one entry point,
 * and the editor and import steps only appear in a focused workspace while
 * something is actually being entered or imported. The server checks every
 * import again with the same rules; verified figures never move. */

function CvInputs() {
  const eng = useEngine();
  const router = useRouter();
  const cv = useCv();
  useTodayTheme(false); // Today's Persimmon & Ink palette while this page is on screen
  const server = eng.mode === 'server';
  const sample = !server || !!eng.org?.sample;
  const [kind, setKind] = React.useState('profile');
  const [seed, setSeed] = React.useState(null);
  const [startMode, setStartMode] = React.useState(null);
  const [editing, setEditing] = React.useState(false);
  const [quick, setQuick] = React.useState(false);
  const [panel, setPanel] = React.useState(null); // { type, kind?, link?, start?, files? }
  const [histKind, setHistKind] = React.useState('');
  const close = React.useCallback(() => setPanel(null), []);
  const { links, setLinks } = useLinks(server);
  // Coverage needs who made each room's current entry; Recent activity keeps its own filtered list.
  const roomHistory = useHistory({ server, roomId: CV_D.id, kind: null });

  // A staffing link (?date=&meal=&back=) opens the schedule or history editor for that service, and shows the way back.
  const [ctx, setCtx] = React.useState(/** @type {{ date: string, meal: 'lunch'|'dinner', back: string|null, today: string }|null} */ (null));
  const staffToday = () => localNow(new Date(), CV_D.room.tz).date;
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const d = p.get('date'); const m = p.get('meal'); const b = p.get('back');
    if (/^\d{4}-\d{2}-\d{2}$/.test(d || '') && (m === 'lunch' || m === 'dinner')) setCtx({ date: d, meal: m, back: b === 'today' || b === 'service' ? b : null, today: staffToday() });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1); if (KINDS.includes(h)) { setKind(h); setEditing(true); } };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const setHash = (k) => { try { window.history.replaceState(null, '', k ? `#${k}` : window.location.pathname + window.location.search); } catch { /* no history */ } };
  const open = (k, m = null, q = false) => { setPanel(null); setKind(k); setSeed(null); setStartMode(m); setQuick(q); setEditing(true); setHash(q ? '' : k); };
  const closeEditor = React.useCallback(() => { setEditing(false); setSeed(null); setHash(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const review = (x) => { setPanel(null); setQuick(false); setSeed(x); setKind(x.kind); setStartMode('csv'); setEditing(true); setHash(x.kind); };
  const add = (start = null, files = null) => setPanel({ type: 'add', start, files });
  // A file dragged anywhere onto the page goes straight to the reader.
  const [dragging, setDragging] = React.useState(false);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const dropHandlers = editing || panel ? {} : {
    onDragOver: (e) => { if (hasFiles(e)) { e.preventDefault(); setDragging(true); } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); },
    onDrop: (e) => { if (hasFiles(e)) { e.preventDefault(); setDragging(false); const f = [...e.dataTransfer.files]; if (f.length) add('file', f); } },
  };

  const room = CV_DS.rooms[CV_D.id];
  const rows = boardRows(links, roomHistory.entries);
  const linkedKinds = new Set(links.filter((l) => l.roomId === CV_D.id).flatMap((l) => l.picks.map((p) => p.kind)));
  const items = attention(CV_D, room, { windows: eng.windows, linkedKinds, server });
  const stake = stakes(CV_D, room);
  const { busy: linkBusy, readNow, unlink } = useLinkActions(setLinks);
  const linkFor = (k) => links.find((l) => l.roomId === CV_D.id && l.picks.some((p) => p.kind === k)) || null;
  const lastFor = (k) => roomHistory.entries.find((e) => e.kind === k && e.room === CV_D.id && e.current) || null;
  const download = (k) => {
    const cols = SCHEMAS[k].columns.map((c) => c.k);
    const data = CV_D.inputs?.[k]?.rows?.length ? CV_D.inputs[k].rows : templateRows(k, room);
    try {
      const url = URL.createObjectURL(new Blob([safeCSV(cols, data)], { type: 'text/csv' }));
      const el = document.createElement('a'); el.href = url; el.download = `${k}-${CV_D.id}.csv`; document.body.appendChild(el); el.click(); el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { cv.toast('Couldn’t start the download in this browser.'); }
  };
  const undoLast = async (e) => {
    try { await undoEntry(e.id); cv.toast(`Undone. ${SCHEMAS[e.kind].title} is back to what it was before.`); roomHistory.reload(); setPanel(null); closeEditor(); } catch (err) { cv.toast(`Couldn’t undo: ${err.message}`); }
  };
  const findingsFor = (k) => CV_D.candidates.filter((c) => dependsOn(k, c) && !c.prevent && c.value > 0)
    .map((c) => { const why = blockedWhy(c, room, CV_D.inputs || {}); return { id: c.id, title: c.title, value: c.value, claim: c.claim, held: why && (k === 'recipes' || c.needs === k) ? why : null }; })
    .sort((x, y) => y.value - x.value);

  // Connections are systems, not kinds of data: the feeds that aren't one of the seven hand-entered kinds, plus linked sheets.
  const own = !!CV_D.room?.fromToast;
  const systems = [
    ...CV_D.feeds.filter((f) => !f.input || f.input === 'toast').map((f) => ({
      id: f.name, name: f.name, icon: 'PlugZap', required: f.name === 'Toast', supplies: f.what, state: f.state, last: f.last, note: f.note, ok: f.state === 'healthy', sample: !own,
      refresh: f.name === 'Toast' ? 'Every night once Toast is connected, or whenever you upload new exports' : 'On its own once connected',
      href: f.name === 'Toast' ? '/connect' : '/sources',
    })),
    ...links.filter((l) => l.roomId === CV_D.id).map((l) => ({
      id: l.id, name: `${host(l.url)} sheet`, icon: 'Link2', supplies: l.picks.map((p) => SCHEMAS[p.kind]?.title ?? p.kind).join(', '),
      state: !l.pulledAt ? 'off' : l.lastError ? 'partial' : 'healthy', last: l.pulledAt ? `Read ${when(l.pulledAt)}` : 'Not read yet', note: l.lastError || null,
      ok: !!l.pulledAt && !l.lastError, sample: false, required: true, refresh: 'Every morning at 1:30 am Pacific, or when you press Read it now', link: l, failed: l.lastResult?.failed || [],
    })),
  ];
  const ownKinds = rows.filter((r) => r.src.key === 'hand' || r.src.key === 'linked').length;
  const head = pageState({ sample, items, own: ownKinds, connected: systems.filter((x) => !x.sample && x.state !== 'off').length });

  const daysIn = eng.inputs?.[CV_D.id]?.days?.rows?.length || 0;
  const needs = items.length;
  const headline = needs ? `${needs} of ${rows.length} need${needs === 1 ? 's' : ''} your data` : 'Your data is up to date';

  return (
    <div className={`cv-page ${s.page} ${s.narrow}`} data-page="inputs" data-state={head.state} {...dropHandlers}>
      <PageHead over={`Add & Manage Data · ${CV_ROOM.name}`} q={headline}
        sub="Add it any way that’s easy, then keep it right. Use this when a connection is missing or gets something wrong."
        right={sample
          ? <Button size="sm" variant="secondary" icon="FlaskConical" onClick={() => setPanel({ type: 'sample' })}>Sample data</Button>
          : <Pill tone="good" icon="Cloud">Saved to your account</Pill>} />

      <button type="button" className={s.todayBar} onClick={() => open('days', 'grid', true)}>
        <span className="cv-q-ico"><Icon name="CalendarDays" size={20} /></span>
        <span><b>Enter today’s sales and labor</b><span className={s.todaySub}>{daysIn ? `${daysIn} day${daysIn === 1 ? '' : 's'} entered so far. ` : ''}Net sales, guests and labor for one day. About 30 seconds.</span></span>
        <span className={s.todayGo}>Enter<Icon name="ChevronRight" size={16} /></span>
      </button>

      <StaffingCheck ctx={ctx} onFix={(f) => { setCtx((c) => ({ date: f.date, meal: f.meal, back: c?.back ?? null, today: staffToday() })); open(f.kind, 'grid'); }} />

      <AddWays over={dragging} onFiles={(f) => add('file', f)} onPhoto={(f) => add('scan', f)}
        onWay={(id) => (id === 'connect' ? router.push('/connect') : add(id === 'link' ? 'connect' : id === 'type' ? 'manual' : 'paste'))} />

      <section className="cv-card" aria-label={`Data for ${CV_ROOM.short}`} id="inputs-next">
        <DataRows rows={rows} items={items} sample={sample} server={server} quiet={editing}
          onOpen={open} onLink={() => add('connect')} onDetails={(k) => open(k, 'grid')}
          onQuick={(k) => open(k, 'grid', true)} onDownload={download} onUndo={undoLast} onHistory={(k) => { setHistKind(k); setPanel({ type: 'hist' }); }} />
      </section>

      <nav className={s.moreLinks} aria-label="More">
        <button type="button" onClick={() => setPanel({ type: 'conns' })}><Icon name="PlugZap" size={16} />Connections<span className={s.moreNote}>{systems.filter(applies).filter((x) => x.ok).length} of {systems.filter(applies).length} up to date</span></button>
        <button type="button" onClick={() => { setHistKind(''); setPanel({ type: 'hist' }); }}><Icon name="History" size={16} />History and undo</button>
        <Link href="/data"><Icon name="Download" size={16} />Export or delete</Link>
      </nav>

      {!editing && panel?.type === 'conns' && (
        <SidePanel over={CV_ROOM.short} title="Connections" onClose={close} wide
          foot={<Link className="btn btn-secondary btn-sm" href="/sources">All connections<Icon name="ChevronRight" size={15} /></Link>}>
          <Connections systems={systems} busy={linkBusy} onReadNow={readNow}
            onSettings={(l) => setPanel({ type: 'link', link: l })} onToastExports={() => setPanel({ type: 'toast' })} />
        </SidePanel>
      )}
      {!editing && panel?.type === 'hist' && (
        <SidePanel over={CV_ROOM.short} title="History and undo" onClose={close} wide>
          <History server={server} onChanged={roomHistory.reload} kindFilter={histKind} />
        </SidePanel>
      )}

      {editing && quick && (
        <SidePanel wide over={CV_ROOM.short} title="Quick add" onClose={closeEditor}>
          <Editor key={`${CV_D.id}-${kind}-quick`} kind={kind} seed={null} startMode="grid" quick />
        </SidePanel>
      )}
      {editing && !quick && (
        <SidePanel workspace over={CV_ROOM.short} title={seed ? 'Import a file' : 'Manage data'} onClose={closeEditor}>
          <Editor key={`${CV_D.id}-${kind}-${seed?.id ?? ''}-${startMode ?? ''}-${ctx?.date ?? ''}`} kind={kind} seed={seed?.kind === kind ? seed : null} startMode={startMode}
            context={ctx && (kind === 'shifts' || kind === 'services') ? ctx : null}
            lastEntry={lastFor(kind)} onUndo={undoLast} onHistory={(k) => { closeEditor(); setHistKind(k); setPanel({ type: 'hist' }); }} />
        </SidePanel>
      )}
      {!editing && panel?.type === 'kind' && (() => { const r = rows.find((x) => x.kind === panel.kind); return (
        <KindPanel row={r} item={items.find((x) => x.kind === panel.kind)} stake={stake.find((x) => x.kind === panel.kind)} last={lastFor(panel.kind)} link={linkFor(panel.kind)} server={server} sample={sample}
          onEdit={open} onLink={() => add('connect')} onReadNow={readNow} onUndo={undoLast} onDownload={download}
          onHistory={(k) => { setHistKind(k); setPanel({ type: 'hist' }); }} onClose={close} />
      ); })()}
      {!editing && panel?.type === 'ready' && <ReadinessPanel rows={rows} items={items} onPick={(k) => setPanel({ type: 'kind', kind: k })} onClose={close} />}
      {!editing && panel?.type === 'cap' && <CapabilityPanel kind={panel.kind} stake={stake.find((x) => x.kind === panel.kind)} findings={findingsFor(panel.kind)} sample={sample} onEdit={open} onClose={close} />}
      {!editing && panel?.type === 'sample' && <SamplePanel server={server} onAdd={() => add()} onClose={close} />}
      {!editing && panel?.type === 'link' && <LinkPanel link={links.find((l) => l.id === panel.link.id) || panel.link} busy={linkBusy} onReadNow={readNow} onUnlink={(l) => unlink(l, close)} onClose={close} />}
      {!editing && panel?.type === 'toast' && <SidePanel workspace over="Toast" title="Upload Toast data exports" onClose={close}><ToastImport /></SidePanel>}
      {!editing && panel?.type === 'add' && (
        <AddPanel key={panel.start || 'menu'} server={server} start={panel.start} onManual={(k) => open(k, 'grid')} onToastExports={() => setPanel({ type: 'toast' })} onClose={close}>
          <BringIn setLinks={setLinks} onReview={review} files={panel.files} startPaste={panel.start === 'paste'} />
        </AddPanel>
      )}
    </div>
  );
}

/**
 * "Ready for the staffing check?": what the next service's pre-shift call
 * needs (the same list Today and Service evaluate), each item with the
 * input that fixes it. A link names the service; otherwise it's the next one
 * still ahead today, else tomorrow's dinner.
 */
function StaffingCheck({ ctx, onFix }) {
  const cv = useCv();
  const x = useStaffingInputs();
  const next = ctx ? { date: ctx.date, meal: ctx.meal }
    : x.nowMin < 11 * 60 - 30 ? { date: x.today, meal: 'lunch' }
      : x.nowMin < 17 * 60 - 30 ? { date: x.today, meal: 'dinner' }
        : { date: new Date(Date.parse(`${x.today}T12:00:00Z`) + 864e5).toISOString().slice(0, 10), meal: 'dinner' };
  const dec = React.useMemo(() => staffingDecision(x.room, { ...x, date: next.date, meal: next.meal }), [x.room, x.fences, x.cc, x.tasks, x.entries, x.today, x.nowMin, next.date, next.meal]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!dec?.readiness) return null;
  const r = dec.readiness;
  const need = r.items.filter((i) => i.need === 'required' && i.state !== 'ready').length;
  const label = `${next.meal === 'lunch' ? 'Lunch' : 'Dinner'} · ${shortDate(next.date)}`;
  return (
    <section className={`cv-card ${s.staffCheck}`} aria-labelledby="staff-check-h">
      <div className={s.staffCheckHead}>
        <span className="cv-q-ico"><Icon name="CalendarClock" size={20} /></span>
        <span className={s.staffCheckText}>
          <b id="staff-check-h">{need ? `${need} thing${need === 1 ? '' : 's'} before the staffing check for ${label.toLowerCase()}` : `Ready for the staffing check: ${label.toLowerCase()}`}</b>
          <span>{need ? 'Coversight compares the schedule with what each hour needs. It holds back until these are in.' : dec.state === 'act' ? `There’s a change to look at: ${dec.short}.` : dec.state === 'hold' ? 'No change needed. The schedule fits the forecast.' : dec.title}</span>
        </span>
        {ctx?.back && !need && <Button size="sm" icon="ArrowLeft" onClick={() => cv.go(ctx.back, { date: next.date, meal: next.meal, ...(ctx.back === 'today' ? { card: dec.id } : {}) })}>Back to the decision</Button>}
        {!ctx?.back && !need && dec.state === 'act' && <Button size="sm" variant="secondary" iconRight="ArrowRight" onClick={() => cv.go('service', { date: next.date, meal: next.meal, back: 'inputs' })}>Open in Service</Button>}
      </div>
      <StaffingReadiness readiness={r} onFix={onFix} />
    </section>
  );
}

export { CvInputs };
