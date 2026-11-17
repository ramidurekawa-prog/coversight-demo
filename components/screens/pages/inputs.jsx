'use client';

import * as React from 'react';
import Link from 'next/link';

import { Button, Icon } from '../../kit';
import { CV_D, CV_DS, CV_ROOM, PageHead, Pill } from '../core';
import { useEngine } from '../../engine';
import { KINDS } from '../../../lib/data/ingest';
import { SCHEMAS, attention, blockedWhy, dependsOn, pageState, stakes } from '../../../lib/data/page/inputs';
import { Connections, CoverageMatrix, FixNext, Summary } from './inputs-visual';
import { ToastImport } from '../toast-import';
import { BringIn } from '../bring-in';
import { boardRows } from './inputs-board';
import { Editor } from './inputs-editor';
import { History } from './inputs-history';
import { host, useLinkActions, when } from './inputs-links';
import { AddPanel, CapabilityPanel, KindPanel, LinkPanel, ReadinessPanel, SamplePanel, SidePanel } from './inputs-panels';
import { useHistory, useLinks } from './inputs-data';
import { useTodayTheme } from './today.themes';
import s from './inputs.module.css';

/* Data & Connections. Outcome and action first: is the data working, what
 * needs fixing and what fixing it unlocks. Then connections (the systems) kept
 * apart from coverage (the kinds of data). Adding data has one entry point,
 * and the editor and import steps only appear in a focused workspace while
 * something is actually being entered or imported. The server checks every
 * import again with the same rules; verified figures never move. */

function CvInputs() {
  const eng = useEngine();
  useTodayTheme(false); // Today's Persimmon & Ink palette while this page is on screen
  const server = eng.mode === 'server';
  const sample = !server || !!eng.org?.sample;
  const [kind, setKind] = React.useState('profile');
  const [seed, setSeed] = React.useState(null);
  const [startMode, setStartMode] = React.useState(null);
  const [editing, setEditing] = React.useState(false);
  const [panel, setPanel] = React.useState(null); // { type, kind?, link?, start? }
  const [histKind, setHistKind] = React.useState('');
  const close = React.useCallback(() => setPanel(null), []);
  const { links, setLinks } = useLinks(server);
  // Coverage needs who made each room's current entry; Recent activity keeps its own filtered list.
  const roomHistory = useHistory({ server, roomId: CV_D.id, kind: null });

  React.useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1); if (KINDS.includes(h)) { setKind(h); setEditing(true); } };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const setHash = (k) => { try { window.history.replaceState(null, '', k ? `#${k}` : window.location.pathname + window.location.search); } catch { /* no history */ } };
  const scrollTo = (id) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const open = (k, m = null) => { setPanel(null); setKind(k); setSeed(null); setStartMode(m); setEditing(true); setHash(k); };
  const closeEditor = React.useCallback(() => { setEditing(false); setSeed(null); setHash(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const review = (x) => { setPanel(null); setSeed(x); setKind(x.kind); setStartMode('csv'); setEditing(true); setHash(x.kind); };
  const add = (start = null) => setPanel({ type: 'add', start });

  const room = CV_DS.rooms[CV_D.id];
  const rows = boardRows(links, roomHistory.entries);
  const linkedKinds = new Set(links.filter((l) => l.roomId === CV_D.id).flatMap((l) => l.picks.map((p) => p.kind)));
  const items = attention(CV_D, room, { windows: eng.windows, linkedKinds, server });
  const stake = stakes(CV_D, room);
  const { busy: linkBusy, readNow, unlink } = useLinkActions(setLinks);
  const linkFor = (k) => links.find((l) => l.roomId === CV_D.id && l.picks.some((p) => p.kind === k)) || null;
  const lastFor = (k) => roomHistory.entries.find((e) => e.kind === k && e.room === CV_D.id && e.current) || null;
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

  return (
    <div className={`cv-page wide ${s.page}`} data-page="inputs">
      <PageHead over={`Data & Connections · ${CV_ROOM.name}`} q={head.headline} sub={head.sub}
        right={<>
          <Pill tone={server ? 'good' : 'neutral'} icon={server ? 'Cloud' : 'HardDrive'}>{server ? 'Saved to your account' : 'Demo: saved in this browser only'}</Pill>
          <Button size="sm" variant={items.length || editing ? 'secondary' : 'primary'} icon="Plus" onClick={() => add()}>Add data</Button>
        </>} />
      {sample && (
        <div className={s.sampleBar} role="note">
          <Icon name="FlaskConical" size={18} />
          <span className={s.sampleText}><b>You&apos;re viewing a sample restaurant.</b> Every figure here is an example, not your restaurant&apos;s result.</span>
          <span className={s.sampleActs}>
            <Button size="sm" variant="ghost" onClick={() => setPanel({ type: 'sample' })}>How the sample works</Button>
            <Link className={`btn btn-sm ${s.inkBtn}`} href="/connect"><Icon name="PlugZap" size={15} />Connect your restaurant</Link>
          </span>
        </div>
      )}
      <Summary systems={systems} rows={rows} items={items}
        onConnections={() => scrollTo('inputs-conns')} onReadiness={() => setPanel({ type: 'ready' })} onIssues={() => scrollTo('inputs-next')} />

      <section className="cv-card" aria-labelledby="inputs-next-h" id="inputs-next" style={{ scrollMarginTop: 16 }}>
        <div className="cv-card-head">
          <span className="cv-h4" id="inputs-next-h">Fix next</span>
          {items.length > 0 && <span className="cv-xs cv-faint">Most important first</span>}
        </div>
        <FixNext items={items} server={server} sample={sample} onOpen={open} onLink={() => add('connect')} onUnlocks={(k) => setPanel({ type: 'cap', kind: k })} quiet={editing} />
      </section>

      <div className={s.split2}>
        <section className="cv-card" aria-labelledby="inputs-conns-h" id="inputs-conns" style={{ scrollMarginTop: 16 }}>
          <div className="cv-card-head">
            <div className="cv-col" style={{ gap: 2 }}>
              <span className="cv-h4" id="inputs-conns-h">Connections</span>
              <span className="cv-xs cv-faint">{sample ? 'The sample restaurant’s systems' : 'The systems your data comes from'}</span>
            </div>
          </div>
          <Connections systems={systems} busy={linkBusy} onReadNow={readNow}
            onSettings={(l) => setPanel({ type: 'link', link: l })} onToastExports={() => setPanel({ type: 'toast' })} />
        </section>
        <section className="cv-card" aria-labelledby="inputs-cover-h">
          <div className="cv-card-head">
            <div className="cv-col" style={{ gap: 2 }}>
              <span className="cv-h4" id="inputs-cover-h">Data coverage</span>
              <span className="cv-xs cv-faint">Each kind of data, and whether it&apos;s ready to use</span>
            </div>
          </div>
          <CoverageMatrix rows={rows} items={items} sample={sample} kind={editing ? kind : null} onPick={(k) => setPanel({ type: 'kind', kind: k })} />
        </section>
      </div>

      <div id="inputs-history-card" style={{ scrollMarginTop: 16 }}><History server={server} onChanged={roomHistory.reload} kindFilter={histKind} /></div>
      <div className={s.trust} aria-label={server ? 'How your data is kept' : 'About this demo'}>
        {server ? <>
          <span><Icon name="Cloud" size={15} />Saved to your account for your whole team</span>
          <span><Icon name="Users" size={15} />Owners see every location; a manager sees only their own</span>
          <span><Icon name="History" size={15} />Every change is recorded and can be undone</span>
          <span><Icon name="ShieldCheck" size={15} />New data never re-prices a verified saving</span>
        </> : <>
          <span><Icon name="HardDrive" size={15} />Demo only: what you enter here stays in this browser and isn&apos;t shared</span>
          <span><Icon name="Cloud" size={15} />A real account saves to your restaurant&apos;s account, with a login for each teammate</span>
        </>}
      </div>

      {editing && (
        <SidePanel workspace over={CV_ROOM.short} title={seed ? 'Import a file' : 'Edit data'} onClose={closeEditor}>
          <Editor key={`${CV_D.id}-${kind}-${seed?.id ?? ''}-${startMode ?? ''}`} kind={kind} seed={seed?.kind === kind ? seed : null} startMode={startMode} />
        </SidePanel>
      )}
      {!editing && panel?.type === 'kind' && (() => { const r = rows.find((x) => x.kind === panel.kind); return (
        <KindPanel row={r} item={items.find((x) => x.kind === panel.kind)} stake={stake.find((x) => x.kind === panel.kind)} last={lastFor(panel.kind)} link={linkFor(panel.kind)} server={server} sample={sample}
          onEdit={open} onLink={() => add('connect')} onReadNow={readNow}
          onHistory={(k) => { setPanel(null); setHistKind(k); scrollTo('inputs-history-card'); }} onClose={close} />
      ); })()}
      {!editing && panel?.type === 'ready' && <ReadinessPanel rows={rows} items={items} onPick={(k) => setPanel({ type: 'kind', kind: k })} onClose={close} />}
      {!editing && panel?.type === 'cap' && <CapabilityPanel kind={panel.kind} stake={stake.find((x) => x.kind === panel.kind)} findings={findingsFor(panel.kind)} sample={sample} onEdit={open} onClose={close} />}
      {!editing && panel?.type === 'sample' && <SamplePanel server={server} onAdd={() => add()} onClose={close} />}
      {!editing && panel?.type === 'link' && <LinkPanel link={links.find((l) => l.id === panel.link.id) || panel.link} busy={linkBusy} onReadNow={readNow} onUnlink={(l) => unlink(l, close)} onClose={close} />}
      {!editing && panel?.type === 'toast' && <SidePanel workspace over="Toast" title="Upload Toast data exports" onClose={close}><ToastImport /></SidePanel>}
      {!editing && panel?.type === 'add' && (
        <AddPanel key={panel.start || 'menu'} server={server} start={panel.start} onManual={(k) => open(k, 'grid')} onToastExports={() => setPanel({ type: 'toast' })} onClose={close}>
          <BringIn setLinks={setLinks} onReview={review} />
        </AddPanel>
      )}
    </div>
  );
}

export { CvInputs };
