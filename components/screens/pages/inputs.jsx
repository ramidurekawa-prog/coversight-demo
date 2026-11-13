'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { CV_D, CV_DS, CV_ROOM, Callout, PageHead, Pill } from '../core';
import { useEngine } from '../../engine';
import { KINDS } from '../../../lib/data/ingest';
import { attention } from '../../../lib/data/page/inputs';
import { Attention } from './inputs-attention';
import { ToastImport } from '../toast-import';
import { BringIn } from '../bring-in';
import { StatusBoard, boardRows } from './inputs-board';
import { Editor } from './inputs-editor';
import { History } from './inputs-history';
import { LinkedSheets } from './inputs-links';
import { useHistory, useLinks } from './inputs-data';

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
  const server = eng.mode === 'server';
  const sample = !server || !!eng.org?.sample;
  const [kind, setKind] = React.useState('profile');
  const [seed, setSeed] = React.useState(null);
  const [startMode, setStartMode] = React.useState(null);
  const [boardOpen, setBoardOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
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

  return (
    <div className="cv-page wide">
      <PageHead over={`Data inputs · ${CV_ROOM.name}`} q="Complete your restaurant data"
        sub="Coversight uses this information to improve the accuracy of its recommendations."
        right={<>{sample && <Pill tone="warn" icon="FlaskConical">Sample group</Pill>}<Pill tone={server ? 'good' : 'neutral'} icon={server ? 'Cloud' : 'HardDrive'}>{server ? 'Saved to your account' : 'Saved in this browser only'}</Pill></>} />
      {sample && <Callout icon="FlaskConical">This is the sample restaurant group: its figures are sample data, not a real restaurant&apos;s. Anything you enter replaces the sample for that kind and is labelled as yours everywhere it&apos;s used.</Callout>}
      <Attention items={items} server={server} onOpen={open} onLink={focusLink} />
      <BringIn setLinks={setLinks} onReview={(x) => { setSeed(x); setKind(x.kind); setStartMode('csv'); setEditing(true); setHash(x.kind); }} />
      {editing
        ? <Editor key={`${CV_D.id}-${kind}-${seed?.id ?? ''}-${startMode ?? ''}`} kind={kind} seed={seed?.kind === kind ? seed : null} startMode={startMode} />
        : null}
      <StatusBoard rows={rows} kind={editing ? kind : null} onPick={(k) => open(k)} open={boardOpen} setOpen={setBoardOpen} />
      {server && <LinkedSheets links={links} setLinks={setLinks} />}
      <History server={server} onChanged={roomHistory.reload} />
      <ToastExports />
      <Callout icon="ShieldCheck">Data you bring in is labelled wherever it&apos;s used: its feed shows &quot;manual entry&quot; on Sources, running tests that read it are flagged for reassessment, and it never re-prices a verified saving.</Callout>
    </div>
  );
}

export { CvInputs };
