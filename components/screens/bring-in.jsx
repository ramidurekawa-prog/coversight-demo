'use client';

import * as React from 'react';

import { Button, Icon } from '../kit';
import { CV_D, CV_ROOM, Callout, Pill, useCv } from './core';
import { engine, useEngine } from '../engine';
import { KINDS, SCHEMAS, gridToTable, toCSV } from '../../lib/data/ingest';
import { route } from '../../lib/data/sniff';
import { summarizeToast, TOAST_FILES } from '../../lib/data/toast';

/* Lane 2: the easiest ways in. Drop anything (CSV, Excel with several tabs,
 * a zip of Toast exports, a photo or PDF), paste from a spreadsheet, or paste
 * a Google Sheets / Dropbox link and keep it linked. Each table is recognised
 * and opened in the review panel below, where it's checked and previewed
 * before anything lands. Nothing here commits a hand table on its own. */

const LANES = [
  ['api', 'Toast API', 'PlugZap'], ['export', 'Toast exports', 'FileArchive'], ['file', 'Spreadsheet or CSV', 'FileSpreadsheet'],
  ['paste', 'Paste', 'ClipboardPaste'], ['link', 'Linked sheet', 'Link'], ['photo', 'Photo or PDF', 'Camera'], ['type', 'Type it in', 'PencilLine'],
];
const FEEDS = [
  ['Sales, orders and covers', ['api', 'export']],
  ['Labour hours, wages, overtime', ['api', 'export']],
  ['Menu prices and plates sold', ['api', 'export', 'file', 'paste', 'link', 'type']],
  ['Plate costs', ['file', 'paste', 'link', 'photo', 'type']],
  ['Invoice lines', ['file', 'paste', 'link', 'photo', 'type']],
  ['Inventory counts', ['file', 'paste', 'link', 'photo', 'type']],
  ['Waste log', ['file', 'paste', 'link', 'photo', 'type']],
  ['Sales by channel', ['api', 'export', 'file', 'paste', 'link', 'photo', 'type']],
  ['Voids, comps, discounts by person', ['api', 'export', 'file', 'paste', 'link', 'photo', 'type']],
  ['Kitchen ticket times', ['export']],
  ['Restaurant profile', ['file', 'paste', 'type']],
];

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

/** Photos are shrunk in the browser (long side 2200 px, JPEG) so they fit a request; PDFs go as they are. */
async function prepareMedia(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { type: 'application/pdf', data: b64(new Uint8Array(await file.arrayBuffer())) };
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('This browser can’t open that photo (HEIC?). Set the camera to “Most compatible” (JPEG), or take a screenshot of it.'); }
  const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  return { type: 'image/jpeg', data: b64(new Uint8Array(await blob.arrayBuffer())) };
}

async function jfetch(url, init) {
  const r = await fetch(url, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

function KindSelect({ value, onChange, label }) {
  return (
    <select className="input" style={{ width: 'auto', minWidth: 160 }} value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {!value && <option value="">What is this?</option>}
      {KINDS.map((k) => <option key={k} value={k}>{SCHEMAS[k].title}</option>)}
    </select>
  );
}

/* The page remounts whenever data changes (a commit), so what was dropped is
   kept here: committing one tab doesn't lose the rest of the list. */
const keep = { found: null, picks: {}, link: '', room: null };

export function BringIn({ onReview }) {
  const cv = useCv();
  const eng = useEngine();
  const server = eng.mode === 'server';
  const fresh = keep.room === CV_D.id;
  const [found, setFoundState] = React.useState(fresh ? keep.found : null); // route() result + where it came from
  const [picks, setPicksState] = React.useState(fresh ? keep.picks : {});
  const setFound = (v) => setFoundState((prev) => { const next = typeof v === 'function' ? v(prev) : v; keep.found = next; keep.room = CV_D.id; return next; });
  const setPicks = (v) => setPicksState((prev) => { const next = typeof v === 'function' ? v(prev) : v; keep.picks = next; return next; });
  const [busy, setBusy] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [paste, setPaste] = React.useState(null);
  const [link, setLinkState] = React.useState(keep.link);
  const setLink = (v) => { keep.link = v; setLinkState(v); };
  const [links, setLinks] = React.useState([]);
  const [photo, setPhoto] = React.useState(null); // { configured }
  const [over, setOver] = React.useState(false);
  const fileRef = React.useRef(null);
  const camRef = React.useRef(null);

  React.useEffect(() => {
    if (!server) return;
    jfetch('/api/inputs/extract').then((j) => setPhoto({ configured: j.configured })).catch(() => setPhoto({ configured: false }));
    jfetch('/api/inputs/links').then((j) => setLinks(j.links || [])).catch(() => setLinks([]));
  }, [server]);

  const take = (r, from) => {
    setErr(null);
    setFound({ ...r, from });
    setPicks(Object.fromEntries([...r.manual.map((m) => [m.source, m.kind]), ...r.unknown.map((u) => [u.source, u.guess || ''])]));
  };
  const onFiles = async (list) => {
    const files = [...(list || [])];
    if (!files.length) return;
    setBusy('read');
    try {
      const read = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()), file: f })));
      const r = route(read);
      // Keep the File for photos so it can be shrunk and read later.
      r.media = r.media.map((m) => ({ ...m, file: read.find((x) => x.name === m.name)?.file }));
      take(r, files.length === 1 ? files[0].name : `${files.length} files`);
    } catch (e) { setErr(`Couldn’t read those files: ${e.message}`); } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ''; if (camRef.current) camRef.current.value = ''; }
  };
  const onPasteText = (text) => { if (text && text.trim()) take(route([{ name: 'Pasted rows', text }]), 'your paste'); };
  const fetchLink = () => run('link', async () => { const j = await jfetch('/api/inputs/link', { method: 'POST', body: JSON.stringify({ url: link }) }); take({ ...j, viaLink: true }, j.name); });
  const run = async (name, fn) => { setBusy(name); setErr(null); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(null); } };

  const loadToast = () => {
    const s = summarizeToast(found.toast);
    if (!s.ok) { setErr(s.error); return; }
    engine.commit('toast', CV_D.id, [s], `${s.weeksCovered} weeks to ${s.end}: ${s.counted.recipes} dishes, ${s.counted.employees} people`);
    cv.toast(`Toast data loaded for ${CV_ROOM.short}: ${s.weeksCovered} weeks to ${s.end}.`);
    setFound((f) => ({ ...f, toast: [], toastDone: s }));
  };
  const review = (src) => {
    const kind = picks[src.source];
    if (!kind) { setErr('Pick what this table is first.'); return; }
    const csv = src.csv ?? toCSV(...(() => { const t = gridToTable(src.grid, src.headerRow); return [t.headers, t.rows]; })());
    setFound((f) => ({ ...f, opened: { ...(f.opened || {}), [src.source]: true } }));
    onReview({ kind, csv, source: src.source, id: `${src.source}-${Date.now()}` });
  };
  const readPhoto = (m) => run(`photo:${m.name}`, async () => {
    const prepared = await prepareMedia(m.file);
    const j = await jfetch('/api/inputs/extract', { method: 'POST', body: JSON.stringify({ name: m.name, ...prepared }) });
    if (!j.rows.length) throw new Error('No rows could be read. Try a closer, straighter photo of just the table.');
    onReview({ kind: j.kind, csv: toCSV(j.columns, j.rows), source: `${m.name} (read from the photo)`, notes: j.notes, id: `${m.name}-${Date.now()}` });
    cv.toast(`Read ${j.rows.length} rows from ${m.name}. Check them below before committing.`);
  });
  const keepLinked = () => run('keep', async () => {
    const tabs = [...found.manual, ...found.unknown].filter((t) => picks[t.source]).map((t) => ({ source: t.source, kind: picks[t.source] }));
    if (!tabs.length) throw new Error('Pick what at least one tab is.');
    const j = await jfetch('/api/inputs/links', { method: 'POST', body: JSON.stringify({ url: link, roomId: CV_D.id, picks: tabs }) });
    setLinks(j.links);
    const res = j.pulled?.results?.[j.id];
    await engine.hydrate();
    cv.toast(res?.failed?.length ? `Linked. ${res.committed.length} tab${res.committed.length === 1 ? '' : 's'} loaded; ${res.failed.length} need a fix (see below).` : `Linked to ${CV_ROOM.short}: ${res?.committed?.length ?? 0} tab${res?.committed?.length === 1 ? '' : 's'} loaded. It’s read again every morning.`);
  });

  const nothing = found && !found.toast.length && !found.manual.length && !found.unknown.length && !found.media.length && !found.toastDone;

  return (
    <section className="cv-card" aria-labelledby="bring-in" data-lane="drop">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4" id="bring-in">Bring data in</span>
          <span className="cv-small cv-muted" style={{ maxWidth: '72ch' }}>Drop whatever you have. Coversight works out what each file, tab or photo is and opens it below to check before anything changes. You don&apos;t need to rename columns or pick a template.</span>
        </div>
        <Pill icon="ShieldCheck">Every lane, same checks</Pill>
      </div>

      <div role="button" tabIndex={0} aria-label="Drop files here, or press Enter to choose files"
        onClick={() => fileRef.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
        onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); onPasteText(t); } else if (e.clipboardData.files.length) onFiles(e.clipboardData.files); }}
        style={{ border: `2px dashed ${over ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-lg)', padding: '22px 16px', textAlign: 'center', cursor: 'pointer', background: over ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'var(--surface-sunken)' }}>
        <Icon name="Upload" size={22} />
        <div className="cv-h4" style={{ marginTop: 6 }}>{busy === 'read' ? 'Reading…' : 'Drop files here, or click to choose'}</div>
        <div className="cv-xs cv-faint" style={{ marginTop: 4 }}>CSV · Excel (.xlsx, every tab) · a zip of Toast exports · a photo or PDF of an invoice, count sheet or statement. You can also paste rows here (⌘V).</div>
        <input ref={fileRef} type="file" multiple onChange={(e) => onFiles(e.target.files)} style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
      </div>

      <div className="cv-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button size="sm" variant="secondary" icon="ClipboardPaste" onClick={() => setPaste(paste == null ? '' : null)}>Paste from a spreadsheet</Button>
        <input ref={camRef} type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => onFiles(e.target.files)} style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
        <Button size="sm" variant="secondary" icon="Camera" onClick={() => camRef.current?.click()}>Take a photo</Button>
        <span className="cv-row nowrap" style={{ gap: 6, flex: '1 1 280px' }}>
          <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder="Paste a Google Sheets or Dropbox link" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Google Sheets or Dropbox link" disabled={!server} />
          <Button size="sm" variant="secondary" icon="Link" disabled={!server || !link || !!busy} onClick={fetchLink}>{busy === 'link' ? 'Fetching…' : 'Fetch'}</Button>
        </span>
      </div>
      {!server && <span className="cv-xs cv-faint">Links and photo reading need the server; in this browser-only preview, drop files or paste instead.</span>}
      {server && photo && !photo.configured && <span className="cv-xs cv-faint">Photo reading is off until an admin sets ANTHROPIC_API_KEY on the server. Photos you drop are listed, and spreadsheets and pastes work as usual.</span>}

      {paste != null && (
        <div className="cv-col" style={{ gap: 6 }}>
          <textarea className="input" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Copy the cells (with the header row) in Excel or Google Sheets and paste here.\nItem\tOn hand\tUnit\nSalmon fillet\t14\tlb'} aria-label="Pasted rows" style={{ height: 'auto', padding: 10, fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre' }} />
          <span><Button size="sm" icon="ScanSearch" disabled={!paste.trim()} onClick={() => onPasteText(paste)}>Read the paste</Button></span>
        </div>
      )}

      {err && <Callout tone="bad" icon="CircleX">{err}</Callout>}

      {found && (
        <div className="cv-col" style={{ gap: 8 }} data-found="1">
          <span className="cv-small" style={{ fontWeight: 600 }}>What&apos;s in {found.from}</span>
          {nothing && !found.errors.length && <Callout icon="Info">Nothing with a header row and data was found.</Callout>}
          <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="What was found">
            <table className="cv-table">
              <thead><tr><th>File or tab</th><th>Recognised as</th><th className="r">Rows</th><th /></tr></thead>
              <tbody>
                {found.toast.length > 0 && (
                  <tr data-row="toast">
                    <td>{(() => { const src = found.toast.map((t) => t.source); const zip = src[0].split(' › ')[0]; return src.length > 1 && src.every((x) => x.startsWith(`${zip} › `)) ? `${zip} · ${src.length} files` : src.join(', '); })()}</td>
                    <td><span className="cv-row" style={{ gap: 6 }}><Icon name="PlugZap" size={14} />Toast export: {found.toast.map((t) => TOAST_FILES[t.kind].file.replace('.csv', '')).join(' + ')}</span></td>
                    <td className="r cv-num">{found.toast.reduce((s, t) => s + t.rows.length, 0).toLocaleString('en-US')}</td>
                    <td className="r"><Button size="sm" icon="Check" onClick={loadToast}>Load into {CV_ROOM.short}</Button></td>
                  </tr>
                )}
                {found.toastDone && <tr><td colSpan={4}><span className="cv-small cv-up"><Icon name="CircleCheck" size={14} /> Toast data loaded: {found.toastDone.weeksCovered} weeks to {found.toastDone.end}.</span></td></tr>}
                {[...found.manual, ...found.unknown].map((t) => (
                  <tr key={t.source}>
                    <td>{t.source}{!t.csv && t.missing?.length ? <div className="cv-xs cv-faint">Not sure: missing {t.missing.join(', ')}</div> : null}{t.also?.length ? <div className="cv-xs cv-faint">Could also be {t.also.map((k) => SCHEMAS[k].title.toLowerCase()).join(' or ')}</div> : null}</td>
                    <td><KindSelect value={picks[t.source]} onChange={(k) => setPicks((p) => ({ ...p, [t.source]: k }))} label={`What ${t.source} is`} /></td>
                    <td className="r cv-num">{(t.rows ?? Math.max(0, t.grid.length - 1 - t.headerRow)).toLocaleString('en-US')}</td>
                    <td className="r"><Button size="sm" variant={found.opened?.[t.source] ? 'ghost' : 'secondary'} icon={found.opened?.[t.source] ? 'Check' : 'ListChecks'} onClick={() => review(t)}>{found.opened?.[t.source] ? 'Opened' : 'Review'}</Button></td>
                  </tr>
                ))}
                {found.media.map((m) => (
                  <tr key={m.name}>
                    <td>{m.name} <span className="cv-xs cv-faint">· {(m.size / 1024 / 1024).toFixed(1)} MB</span></td>
                    <td><span className="cv-row" style={{ gap: 6 }}><Icon name="Camera" size={14} />{m.type === 'application/pdf' ? 'PDF' : 'Photo'}: read it into rows</span></td>
                    <td className="r">—</td>
                    <td className="r"><Button size="sm" variant="secondary" icon="ScanText" disabled={!server || !photo?.configured || !m.file || !!busy} onClick={() => readPhoto(m)}>{busy === `photo:${m.name}` ? 'Reading…' : 'Read it'}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span><Button size="sm" variant="ghost" icon="Eraser" onClick={() => setFound(null)}>Clear the list</Button></span>
          {found.errors.map((e, i) => <Callout key={i} tone="warn" icon="TriangleAlert"><b>{e.name}</b>: {e.msg}</Callout>)}
          {server && found.viaLink && (found.manual.length > 0 || found.unknown.length > 0) && (
            <div className="cv-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" icon="Link2" disabled={!!busy} onClick={keepLinked}>{busy === 'keep' ? 'Linking…' : `Keep linked to ${CV_ROOM.short}`}</Button>
              <span className="cv-xs cv-faint">Read again every morning. A tab that passes every check is loaded; one that doesn&apos;t is flagged and nothing changes.</span>
            </div>
          )}
        </div>
      )}

      {server && links.length > 0 && (
        <div className="cv-col" style={{ gap: 6 }} data-links="1">
          <span className="cv-small" style={{ fontWeight: 600 }}>Linked sheets</span>
          <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Linked sheets">
            <table className="cv-table">
              <thead><tr><th>Link</th><th>Room</th><th>Tabs</th><th>Last read</th><th /></tr></thead>
              <tbody>{links.map((l) => (
                <tr key={l.id}>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><a href={l.url} target="_blank" rel="noreferrer">{l.url.replace(/^https:\/\//, '')}</a></td>
                  <td>{l.roomId}</td>
                  <td className="cv-xs">{l.picks.map((p) => `${p.source.split(' · ').pop()} → ${SCHEMAS[p.kind]?.title ?? p.kind}`).join(', ')}</td>
                  <td className="cv-xs">{l.pulledAt ? new Date(l.pulledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet'}{l.lastError ? <div className="cv-down">{l.lastError}</div> : null}</td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="ghost" icon="RefreshCw" disabled={!!busy} onClick={() => run(`pull:${l.id}`, async () => { const j = await jfetch(`/api/inputs/links/${l.id}`, { method: 'POST' }); setLinks(j.links); await engine.hydrate(); cv.toast('Read again.'); })}>Read now</Button>
                    <Button size="sm" variant="ghost" icon="Unlink" disabled={!!busy} onClick={() => run(`del:${l.id}`, async () => { const j = await jfetch(`/api/inputs/links/${l.id}`, { method: 'DELETE' }); setLinks(j.links); cv.toast('Unlinked. Data already loaded stays.'); })}>Unlink</Button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      <details>
        <summary className="cv-small" style={{ cursor: 'pointer', fontWeight: 600 }}>Every way in, by kind of data</summary>
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Ways in by kind of data" style={{ marginTop: 8 }}>
          <table className="cv-table" style={{ fontSize: 'var(--text-xs)' }}>
            <thead><tr><th>Data</th>{LANES.map(([k, l, ic]) => <th key={k} className="r"><span className="cv-row" style={{ gap: 4, justifyContent: 'flex-end' }}><Icon name={ic} size={12} />{l}</span></th>)}</tr></thead>
            <tbody>{FEEDS.map(([name, ways]) => (
              <tr key={name}><td>{name}</td>{LANES.map(([k]) => <td key={k} className="r">{ways.includes(k) ? <Icon name="Check" size={14} aria-label="yes" /> : <span className="cv-faint">·</span>}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
        <span className="cv-xs cv-faint">The Toast API sync is on Connect. Everything that comes in goes through the same reader and the same checks, so a figure doesn&apos;t change with the lane it arrived by.</span>
      </details>
    </section>
  );
}
