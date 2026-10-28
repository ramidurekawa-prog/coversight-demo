'use client';

import * as React from 'react';

import { Button, Icon, Tabs } from '../kit';
import { CV_D, CV_DS, CV_ROOM, Callout, Claim, Pill, PageHead, useCv } from './core';
import { engine, useEngine } from '../engine';
import { KINDS, SCHEMAS, mapColumns, parseCSV, preview, templateCSV, templateRows, validate } from '../../lib/data/ingest';
import { SEED } from '../../lib/data/seed';

/* Data inputs: the manual ingestion layer. Six kinds of data a restaurant
 * often keeps by hand. Each one: type it in (pre-filled with what's there
 * now) or paste/upload a CSV, check it row by row, preview exactly which
 * figures move, then commit. Every commit is logged and can be undone, and
 * verified figures never move. */

const inputStyle = { width: '100%', minWidth: 70, height: 32, padding: '0 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--fg-1)', font: 'inherit', fontSize: 'var(--text-sm)' };

function download(name, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* downloads blocked: the template is still visible in the paste box */ }
}

function KindCard({ kind, on, onPick }) {
  const s = SCHEMAS[kind];
  const entry = CV_D.inputs[kind];
  const feed = CV_D.feeds.find((f) => f.name === s.feed);
  return (
    <button type="button" className={`cv-kind ${on ? 'on' : ''}`} onClick={() => onPick(kind)} aria-pressed={on}>
      <span className={`cv-q-ico ${entry ? 'good' : feed && feed.state !== 'healthy' ? 'warn' : 'accent'}`}><Icon name={s.icon} size={18} /></span>
      <span className="cv-col" style={{ gap: 3, alignItems: 'flex-start', textAlign: 'left' }}>
        <b>{s.title}</b>
        <span className="cv-xs cv-faint">{entry ? `Entered by hand ${entry.date} · ${entry.n} rows` : feed ? `${feed.state === 'healthy' ? 'Sample data' : feed.state === 'off' ? 'Nothing yet' : `Feed ${feed.state}`} · ${feed.last}` : 'Sample data'}</span>
      </span>
    </button>
  );
}

function Grid({ kind, rows, setRows, issues }) {
  const cols = SCHEMAS[kind].columns;
  const bad = (i, k) => issues.find((x) => x.row === i + 1 && (x.col === k || x.col == null));
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="cv-tablewrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
      <table className="cv-table cv-grid-edit">
        <thead><tr><th style={{ width: 36 }}>#</th>{cols.map((c) => <th key={c.k}>{c.label}{c.required ? '' : ' (optional)'}</th>)}<th style={{ width: 40 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="cv-xs cv-faint cv-num">{i + 1}</td>
              {cols.map((c) => {
                const b = bad(i, c.k);
                const style = { ...inputStyle, borderColor: b ? (b.level === 'error' ? 'var(--error-600)' : 'var(--warning-600)') : 'var(--border-strong)', textAlign: c.type === 'text' || c.type === 'enum' ? 'left' : 'right' };
                return (
                  <td key={c.k}>
                    {c.type === 'enum' ? (
                      <select aria-label={`${c.label}, row ${i + 1}`} value={r[c.k] ?? ''} onChange={(e) => set(i, c.k, e.target.value)} style={style}>
                        <option value="">Choose…</option>
                        {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input aria-label={`${c.label}, row ${i + 1}`} value={r[c.k] ?? ''} inputMode={c.type === 'text' ? 'text' : 'decimal'} onChange={(e) => set(i, c.k, e.target.value)} style={style} />
                    )}
                  </td>
                );
              })}
              <td><button className="iconbtn" style={{ width: 28, height: 28 }} aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="X" size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Issues({ result }) {
  if (!result) return null;
  const { errors, warnings, issues, rows } = result;
  return (
    <div className="cv-col" style={{ gap: 8 }}>
      <div className="cv-row" style={{ gap: 8 }}>
        <Pill tone={errors ? 'bad' : 'good'} icon={errors ? 'CircleX' : 'CircleCheck'}>{errors ? `${errors} error${errors === 1 ? '' : 's'}` : 'No errors'}</Pill>
        <Pill tone={warnings ? 'warn' : 'neutral'} icon="TriangleAlert">{warnings} warning{warnings === 1 ? '' : 's'}</Pill>
        <span className="cv-xs cv-faint">{rows.length} row{rows.length === 1 ? '' : 's'} ready</span>
      </div>
      {issues.length > 0 && (
        <ul className="cv-issues">
          {issues.slice(0, 12).map((x, i) => (
            <li key={i} className={x.level}>
              <Icon name={x.level === 'error' ? 'CircleX' : 'TriangleAlert'} size={14} />
              <span>{x.row ? <b>Row {x.row}{x.col ? ` · ${x.col}` : ''}: </b> : null}{x.msg}</span>
            </li>
          ))}
          {issues.length > 12 && <li className="cv-xs cv-faint">…and {issues.length - 12} more</li>}
        </ul>
      )}
    </div>
  );
}

function Preview({ pv }) {
  if (!pv) return null;
  return (
    <div className="cv-grid g2" style={{ alignItems: 'start' }}>
      <div className="cv-col" style={{ gap: 8 }}>
        <span className="cv-over">What changes if you commit</span>
        <div className="cv-diff">
          <div className="r h" style={{ gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1fr) minmax(0, 1fr)' }}><span>Figure</span><span>Now</span><span>After</span></div>
          {pv.moves.map((m) => (
            <div key={m.label} className="r" style={{ gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1fr) minmax(0, 1fr)' }}><span className="cv-row" style={{ gap: 6 }}>{m.label} <Claim k={m.claim} /></span><span className="was">{m.before}</span><span className="now" style={{ fontWeight: m.changed ? 700 : 400 }}>{m.after}</span></div>
          ))}
        </div>
      </div>
      <div className="cv-col" style={{ gap: 8 }}>
        <span className="cv-over">What can't change</span>
        <div className="cv-diff">
          <div className="r h" style={{ gridTemplateColumns: 'minmax(0,1fr) 120px' }}><span>Figure</span><span>Stays</span></div>
          {pv.frozen.map((m) => <div key={m.label} className="r" style={{ gridTemplateColumns: 'minmax(0,1fr) 120px' }}><span className="cv-row" style={{ gap: 6 }}>{m.label} <Claim k="book" /></span><span className="now">{m.value} <Icon name="Lock" size={12} /></span></div>)}
        </div>
        <span className="cv-xs cv-faint">Verified rates are frozen in their packets when the window closes. New data moves estimates and observed figures, never a proven number.</span>
      </div>
    </div>
  );
}

function Panel({ kind }) {
  const cv = useCv();
  const eng = useEngine();
  const room = CV_DS.rooms[CV_D.id];
  const s = SCHEMAS[kind];
  const [mode, setMode] = React.useState('grid');
  const [rows, setRows] = React.useState(() => templateRows(kind, room).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)]))));
  const [csv, setCsv] = React.useState('');
  const [result, setResult] = React.useState(null);
  const [mapInfo, setMapInfo] = React.useState(null);
  const [pv, setPv] = React.useState(null);
  const fileRef = React.useRef(null);
  const blankRow = () => Object.fromEntries(s.columns.map((c) => [c.k, '']));

  const check = () => {
    let res;
    if (mode === 'csv') {
      const parsed = parseCSV(csv);
      const mi = mapColumns(parsed.headers, kind);
      setMapInfo(mi);
      if (mi.missing.length) { setResult({ rows: [], issues: [{ row: 0, col: null, level: 'error', msg: `Missing column${mi.missing.length === 1 ? '' : 's'}: ${mi.missing.join(', ')}` }], errors: 1, warnings: 0 }); setPv(null); return; }
      res = validate(kind, parsed.rows, room, mi.map);
    } else {
      setMapInfo(null);
      res = validate(kind, rows, room, null);
    }
    setResult(res);
    const commitRows = kind === 'waste' ? [...(eng.inputs[CV_D.id]?.waste?.rows || []), ...res.rows] : res.rows;
    setPv(res.errors || !res.rows.length ? null : preview(SEED, eng.inputs, CV_D.id, kind, commitRows));
  };

  const commit = () => {
    const prior = kind === 'waste' ? eng.inputs[CV_D.id]?.waste?.rows || [] : [];
    const commitRows = [...prior, ...result.rows];
    const changed = pv.moves.filter((m) => m.changed).map((m) => `${m.label}: ${m.before} → ${m.after}`);
    engine.commit(kind, CV_D.id, commitRows, changed.length ? changed.join('; ') : 'No figure moved');
    cv.toast(`${s.title} committed for ${CV_ROOM.short}: ${result.rows.length} rows. ${changed.length ? `${changed.length} figure${changed.length === 1 ? '' : 's'} moved.` : 'Nothing moved.'}`);
  };

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result || '')); setResult(null); setPv(null); };
    reader.readAsText(f);
  };

  return (
    <section className="cv-card" id={`kind-${kind}`}>
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4">{s.title} · {CV_ROOM.name}</span>
          <span className="cv-small cv-muted" style={{ maxWidth: '70ch' }}>{s.blurb}</span>
        </div>
        <Button variant="secondary" size="sm" icon="Download" onClick={() => download(`${kind}-${CV_D.id}-template.csv`, templateCSV(kind, room))}>Template</Button>
      </div>
      <Tabs value={mode} onChange={(m) => { setMode(m); setResult(null); setPv(null); }} tabs={[{ value: 'grid', label: 'Type it in' }, { value: 'csv', label: 'Paste or upload CSV' }]} />
      {mode === 'grid' ? (
        <>
          <span className="cv-xs cv-faint">{kind === 'waste' ? 'Each row adds to the log.' : 'Pre-filled with what this room has now. Change what\'s different and check it.'}</span>
          <Grid kind={kind} rows={rows} setRows={(r) => { setRows(r); setResult(null); setPv(null); }} issues={result?.issues || []} />
          <div className="cv-row"><Button size="sm" variant="ghost" icon="Plus" onClick={() => setRows([...rows, blankRow()])}>Add a row</Button></div>
        </>
      ) : (
        <div className="cv-col" style={{ gap: 8 }}>
          <label htmlFor={`csv-${kind}`} className="cv-small" style={{ fontWeight: 600 }}>Paste rows with a header line, or upload a .csv</label>
          <textarea id={`csv-${kind}`} rows={8} value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); setPv(null); }} placeholder={templateCSV(kind, room).split('\n').slice(0, 3).join('\n')}
            style={{ ...inputStyle, height: 'auto', padding: 10, fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre' }} />
          <div className="cv-row">
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={onFile} style={{ display: 'none' }} />
            <Button size="sm" variant="secondary" icon="Upload" onClick={() => fileRef.current && fileRef.current.click()}>Upload a file</Button>
            <Button size="sm" variant="ghost" onClick={() => { setCsv(templateCSV(kind, room)); setResult(null); setPv(null); }}>Paste the template</Button>
            <span className="cv-xs cv-faint">Headers are matched by name: {s.columns.map((c) => c.k).join(', ')} (common alternatives work too).</span>
          </div>
          {mapInfo && mapInfo.ignored.length > 0 && <Callout icon="Info">Ignored column{mapInfo.ignored.length === 1 ? '' : 's'}: {mapInfo.ignored.join(', ')}.</Callout>}
        </div>
      )}
      <div className="cv-row">
        <Button icon="ListChecks" onClick={check}>Check {mode === 'grid' ? rows.length : 'the'} rows</Button>
        {result && !result.errors && pv && <Button icon="Check" onClick={commit}>Commit to {CV_ROOM.short}</Button>}
        {result && result.errors > 0 && <span className="cv-small cv-down">Fix the errors to commit. Warnings are allowed.</span>}
      </div>
      <Issues result={result} />
      <Preview pv={pv} />
    </section>
  );
}

function Log() {
  const cv = useCv();
  const eng = useEngine();
  const name = (id) => CV_DS.locs.find((l) => l.id === id)?.short || id;
  return (
    <section className="cv-card">
      <div className="cv-card-head">
        <span className="cv-h4">Audit log</span>
        <Button size="sm" variant="ghost" icon="RotateCcw" disabled={!eng.log.length} onClick={() => { engine.reset(); cv.toast('Back to the sample restaurant group. Every hand-entered row is cleared.'); }}>Reset to sample data</Button>
      </div>
      {eng.log.length === 0 ? <span className="cv-small cv-muted">Nothing entered by hand yet. Every commit lands here with what it moved, and each one can be undone.</span> : (
        <div className="cv-col" style={{ gap: 0 }}>
          {eng.log.map((e, i) => (
            <div key={e.id} className="cv-row nowrap" style={{ gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 0, alignItems: 'flex-start', opacity: e.undone ? 0.55 : 1 }}>
              <span className="cv-q-ico" style={{ width: 30, height: 30 }}><Icon name={SCHEMAS[e.kind].icon} size={15} /></span>
              <div className="cv-col" style={{ gap: 2, flex: 1 }}>
                <span className="cv-small" style={{ fontWeight: 600 }}>{SCHEMAS[e.kind].title} · {name(e.room)} · {e.rows} rows{e.undone ? ' · undone' : ''}</span>
                <span className="cv-xs cv-faint">{e.at} · by you · {e.summary}</span>
              </div>
              {!e.undone && <Button size="sm" variant="secondary" icon="Undo2" onClick={() => { engine.undo(e.id); cv.toast('Undone. The figures are back to what they were.'); }}>Undo</Button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CvInputs() {
  const [kind, setKind] = React.useState('recipes');
  React.useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1); if (KINDS.includes(h)) setKind(h); };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const pick = (k) => { setKind(k); try { window.history.replaceState(null, '', `#${k}`); } catch { /* no history */ } };
  const entered = KINDS.filter((k) => CV_D.inputs[k]).length;
  return (
    <div className="cv-page wide">
      <PageHead over={`Data inputs · ${CV_ROOM.name}`} q="Bring in what isn't connected yet"
        sub="Recipe costs, counts, waste, invoices, channel sales and register exceptions, typed in or uploaded. Every row is checked before it lands, you see exactly which figures move, and every commit can be undone." />
      <div className="cv-row" style={{ gap: 8 }}>
        <Pill tone={entered ? 'info' : 'neutral'} icon="PencilLine">{entered ? `${entered} of ${KINDS.length} kinds entered by hand at ${CV_ROOM.short}` : `${CV_ROOM.short} is on sample data`}</Pill>
        <span className="cv-xs cv-faint">Saved in this browser only. Switch rooms in the top bar to enter another room's data.</span>
      </div>
      <div className="cv-kinds">
        {KINDS.map((k) => <KindCard key={k} kind={k} on={k === kind} onPick={pick} />)}
      </div>
      <Panel key={`${CV_D.id}-${kind}`} kind={kind} />
      <Log />
      <Callout icon="ShieldCheck">Hand-entered data is labelled wherever it's used: its feed shows "manual entry" on Sources, and a quarantined test that was waiting on it restarts its window from the day it arrived. It never re-prices a verified result.</Callout>
    </div>
  );
}

export { CvInputs };
