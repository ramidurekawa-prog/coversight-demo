'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { CV_D, CV_DS, CV_ROOM, Callout, PageHead, Pill } from '../core';
import { useEngine } from '../../engine';
import { KINDS } from '../../../lib/data/ingest';
import { attention, blockedWhy, dependsOn, stakes } from '../../../lib/data/page/inputs';
import { Coverage, FixNext, Hero, KindTiles, StakeBars } from './inputs-visual';
import { ToastImport } from '../toast-import';
import { BringIn } from '../bring-in';
import { boardRows } from './inputs-board';
import { Editor } from './inputs-editor';
import { History } from './inputs-history';
import { LinkedSheets, useLinkActions } from './inputs-links';
import { AddPanel, CapabilityPanel, KindPanel, LinkPanel, ReadinessPanel, SamplePanel } from './inputs-panels';
import { useHistory, useLinks } from './inputs-data';
import { useTodayTheme } from './today.themes';
import s from './inputs.module.css';

/* Data inputs: the manual ingestion layer. First, where each kind of this
 * room's data comes from now. Then the ways in: drop, paste, link, photo.
 * Anything that comes in opens in the editor, where it's checked row by row
 * and previewed (exactly which figures move) before it's committed. The
 * server checks it again with the same rules. Every commit is in the history
 * with who made it, the one in use can be undone, and verified figures never
 * move. */

function ToastExports() {
  const [open, setOpen] = React.useState(false);
  const t = CV_D.inputs.toast?.rows?.[0];
  if (open) return <ToastImport />;
  return (
    <section className="cv-card" aria-label="Toast data exports">
      <div className="cv-card-head">
        <div className="cv-row nowrap" style={{ gap: 12 }}>
          <span className="cv-q-ico"><Icon name="FileArchive" size={18} /></span>
          <div className="cv-col" style={{ gap: 2 }}>
            <span className="cv-small" style={{ fontWeight: 600 }}>Toast data exports, file by file</span>
            <span className="cv-xs cv-faint">No API keys needed: download 13 weeks from Toast Web → Reports → Data exports. A zip dropped above works too.</span>
          </div>
        </div>
        <span className="cv-row" style={{ gap: 8 }}>
          {t ? <Pill tone="good" icon="CircleCheck">{`Toast data to ${t.end}`}</Pill> : <Pill icon="CircleDashed">Not loaded</Pill>}
          <Button size="sm" variant="secondary" icon="ChevronDown" onClick={() => setOpen(true)} aria-expanded={false}>Open</Button>
        </span>
      </div>
    </section>
  );
}

function CvInputs() {
  const eng = useEngine();
  useTodayTheme(false); // Today's Persimmon & Ink palette while this page is on screen
  const server = eng.mode === 'server';
  const sample = !server || !!eng.org?.sample;
  const [kind, setKind] = React.useState('profile');
  const [seed, setSeed] = React.useState(null);
  const [startMode, setStartMode] = React.useState(null);
  const [editing, setEditing] = React.useState(false);
  const [panel, setPanel] = React.useState(null); // { type, kind?, link? }
  const [histKind, setHistKind] = React.useState('');
  const close = React.useCallback(() => setPanel(null), []);
  const { links, setLinks } = useLinks(server);
  // The board needs who made each room's current entry; the History card keeps its own filtered list.
  const roomHistory = useHistory({ server, roomId: CV_D.id, kind: null });

  React.useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1); if (KINDS.includes(h)) { setKind(h); setEditing(true); } };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const setHash = (k) => { try { window.history.replaceState(null, '', `#${k}`); } catch { /* no history */ } };
  const scrollTo = (id) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const open = (k, m = null) => { setKind(k); setSeed(null); setStartMode(m); setEditing(true); setHash(k); scrollTo('inputs-editor'); };
  const focusLink = () => { scrollTo('bring-in'); setTimeout(() => document.getElementById('inputs-link')?.focus(), 350); };
  const rows = boardRows(links, roomHistory.entries);
  const linkedKinds = new Set(links.filter((l) => l.roomId === CV_D.id).flatMap((l) => l.picks.map((p) => p.kind)));
  const items = attention(CV_D, CV_DS.rooms[CV_D.id], { windows: eng.windows, linkedKinds, server });
  const stake = stakes(CV_D, CV_DS.rooms[CV_D.id]);
  const { busy: linkBusy, readNow, unlink } = useLinkActions(setLinks);
  const linkFor = (k) => links.find((l) => l.roomId === CV_D.id && l.picks.some((p) => p.kind === k)) || null;
  const lastFor = (k) => roomHistory.entries.find((e) => e.kind === k && e.room === CV_D.id && e.current) || null;
  const edit = (k, m = null) => { setPanel(null); open(k, m); };
  const review = (x) => { setPanel(null); setSeed(x); setKind(x.kind); setStartMode('csv'); setEditing(true); setHash(x.kind); scrollTo('inputs-editor'); };
  const findingsFor = (k) => {
    const room = CV_DS.rooms[CV_D.id];
    return CV_D.candidates.filter((c) => dependsOn(k, c) && !c.prevent && c.value > 0)
      .map((c) => { const why = blockedWhy(c, room, CV_D.inputs || {}); return { id: c.id, title: c.title, value: c.value, claim: c.claim, held: why && (k === 'recipes' || c.needs === k) ? why : null }; })
      .sort((a, b) => b.value - a.value);
  };

  return (
    <div className={`cv-page wide ${s.page}`} data-page="inputs">
      <PageHead over={`Data inputs · ${CV_ROOM.name}`} q="Your data, at a glance"
        sub="The more of it is yours, the sharper every number in Coversight."
        right={<>
          {sample && <button type="button" className={`cv-pill warn ${s.pillBtn}`} onClick={() => setPanel({ type: 'sample' })} aria-label="Sample group: what this is and how to switch to real data"><Icon name="FlaskConical" size={13} />Sample group<Icon name="ChevronRight" size={13} /></button>}
          <Button size="sm" variant="secondary" icon="Plus" onClick={() => setPanel({ type: 'add' })}>Add data</Button>
          <Pill tone={server ? 'good' : 'neutral'} icon={server ? 'Cloud' : 'HardDrive'}>{server ? 'Saved to your account' : 'Saved in this browser only'}</Pill></>} />
      {sample && <Callout icon="FlaskConical">Sample restaurant group. Anything you enter replaces the sample for that kind and is labeled as yours.</Callout>}
      <Hero rows={rows} stakes={stake} items={items} onReadiness={() => setPanel({ type: 'ready' })} />
      <div className={s.split}>
        <section className="cv-card" aria-labelledby="inputs-next">
          <span className="cv-h4" id="inputs-next">Fix next</span>
          <FixNext items={items} server={server} onOpen={open} onLink={focusLink} quiet={editing} />
        </section>
        <section className="cv-card" aria-labelledby="inputs-cover">
          <span className="cv-h4" id="inputs-cover">Where your data comes from</span>
          <Coverage rows={rows} onPick={() => setPanel({ type: 'ready' })} />
        </section>
      </div>
      <section className="cv-card" aria-labelledby="inputs-stakes">
        <span className="cv-h4" id="inputs-stakes">What each kind of data unlocks</span>
        <StakeBars stakes={stake} onPick={(k) => setPanel({ type: 'cap', kind: k })} />
      </section>
      <section className="cv-card" aria-labelledby="inputs-kinds">
        <div className="cv-card-head">
          <span className="cv-h4" id="inputs-kinds">All seven kinds</span>
          <span className="cv-xs cv-faint">Tap one for a preview, its freshness and checks</span>
        </div>
        <KindTiles rows={rows} kind={editing ? kind : null} onPick={(k) => setPanel({ type: 'kind', kind: k })} />
      </section>
      {editing
        ? <Editor key={`${CV_D.id}-${kind}-${seed?.id ?? ''}-${startMode ?? ''}`} kind={kind} seed={seed?.kind === kind ? seed : null} startMode={startMode} />
        : null}
      {panel?.type !== 'add' && <BringIn setLinks={setLinks} onReview={review} />}
      {server && <LinkedSheets links={links} setLinks={setLinks} onSettings={(l) => setPanel({ type: 'link', link: l })} />}
      <div id="inputs-history-card" style={{ scrollMarginTop: 16 }}><History server={server} onChanged={roomHistory.reload} kindFilter={histKind} /></div>
      <ToastExports />
      <span className="cv-xs cv-faint" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="ShieldCheck" size={13} />Your data is labeled wherever it&apos;s used, and it never re-prices a verified saving.</span>

      {panel?.type === 'kind' && (() => { const r = rows.find((x) => x.kind === panel.kind); return (
        <KindPanel row={r} item={items.find((x) => x.kind === panel.kind)} stake={stake.find((x) => x.kind === panel.kind)} last={lastFor(panel.kind)} link={linkFor(panel.kind)} server={server}
          onEdit={edit} onLink={() => { setPanel(null); focusLink(); }} onReadNow={readNow}
          onHistory={(k) => { setPanel(null); setHistKind(k); scrollTo('inputs-history-card'); }} onClose={close} />
      ); })()}
      {panel?.type === 'ready' && <ReadinessPanel rows={rows} items={items} onPick={(k) => setPanel({ type: 'kind', kind: k })} onClose={close} />}
      {panel?.type === 'cap' && <CapabilityPanel kind={panel.kind} stake={stake.find((x) => x.kind === panel.kind)} findings={findingsFor(panel.kind)} onEdit={edit} onClose={close} />}
      {panel?.type === 'sample' && <SamplePanel server={server} onAdd={() => setPanel({ type: 'add' })} onClose={close} />}
      {panel?.type === 'link' && <LinkPanel link={links.find((l) => l.id === panel.link.id) || panel.link} busy={linkBusy} onReadNow={readNow} onUnlink={(l) => unlink(l, close)} onClose={close} />}
      {panel?.type === 'add' && <AddPanel onClose={close}><BringIn setLinks={setLinks} onReview={review} /></AddPanel>}
    </div>
  );
}

export { CvInputs };
