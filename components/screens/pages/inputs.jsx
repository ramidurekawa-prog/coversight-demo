'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { CV_D, CV_ROOM, Callout, PageHead, Pill } from '../core';
import { useEngine } from '../../engine';
import { KINDS } from '../../../lib/data/ingest';
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
  const [kind, setKind] = React.useState('profile');
  const [seed, setSeed] = React.useState(null);
  const { links, setLinks } = useLinks(server);
  // The board needs who made each room's current entry; the History card keeps its own filtered list.
  const roomHistory = useHistory({ server, roomId: CV_D.id, kind: null });

  React.useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1); if (KINDS.includes(h)) setKind(h); };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const setHash = (k) => { try { window.history.replaceState(null, '', `#${k}`); } catch { /* no history */ } };
  const pick = (k) => {
    setKind(k); setSeed(null); setHash(k);
    requestAnimationFrame(() => document.getElementById('inputs-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const rows = boardRows(links, roomHistory.entries);

  return (
    <div className="cv-page wide">
      <PageHead over={`Data inputs · ${CV_ROOM.name}`} q="Bring in what isn't connected yet"
        sub="Drop a file, paste from a spreadsheet, link a Google Sheet, snap a photo, or type it in. Every row is checked before it lands, you see exactly which figures move, and the latest commit for each kind can be undone."
        right={<Pill tone={server ? 'good' : 'neutral'} icon={server ? 'Cloud' : 'HardDrive'}>{server ? 'Saved to your account' : 'Saved in this browser only'}</Pill>} />
      <StatusBoard rows={rows} kind={kind} onPick={pick} />
      <BringIn setLinks={setLinks} onReview={(x) => { setSeed(x); setKind(x.kind); setHash(x.kind); }} />
      <Editor key={`${CV_D.id}-${kind}-${seed?.id ?? ''}`} kind={kind} seed={seed?.kind === kind ? seed : null} />
      {server && <LinkedSheets links={links} setLinks={setLinks} />}
      <History server={server} onChanged={roomHistory.reload} />
      <ToastExports />
      <Callout icon="ShieldCheck">Hand-entered data is labelled wherever it&apos;s used: its feed shows &quot;manual entry&quot; on Sources, and a quarantined test that was waiting on it restarts its window from the day it arrived. It never re-prices a verified result.</Callout>
    </div>
  );
}

export { CvInputs };
