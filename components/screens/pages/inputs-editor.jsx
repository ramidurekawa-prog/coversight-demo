'use client';

/* Data inputs: the editor for one kind in one room. Type it in (pre-filled
 * with what's there now) or paste/upload a CSV, check it row by row, preview
 * exactly which figures move, then commit. The server checks it again with
 * the same rules before it lands. */

import * as React from 'react';

import { Button, Icon, Tabs } from '../../kit';
import { CV_D, CV_DS, CV_ROOM, Callout, Claim, Pill, useCv } from '../core';
import { engine, useEngine } from '../../engine';
import { SCHEMAS, mapColumns, parseCSV, preview, templateCSV, templateRows, validate } from '../../../lib/data/ingest';
import { cleanOpts, mergeRows } from '../../../lib/data/page/inputs';
import s from './inputs.module.css';

function download(name, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* downloads blocked: the template is still one click away in the paste box */ }
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const cellId = (kind, i, k) => `cell-${kind}-${i}-${k}`;

function Grid({ kind, rows, setRows, issues }) {
  const cols = SCHEMAS[kind].columns;
  const bad = (i, k) => issues.find((x) => x.row === i + 1 && (x.col === k || x.col == null));
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="cv-tablewrap" tabIndex={0} role="group" aria-label={`${SCHEMAS[kind].title} rows`} style={{ maxHeight: 460, overflowY: 'auto' }}>
      <table className="cv-table cv-grid-edit">
        <thead><tr><th style={{ width: 36 }}>#</th>{cols.map((c) => <th key={c.k} className={c.type === 'money' || c.type === 'number' ? 'r' : ''}>{c.label}{c.required ? '' : <span className="cv-faint" style={{ fontWeight: 400, textTransform: 'none' }}> · optional</span>}</th>)}<th style={{ width: 40 }}><span className="sr-only">Remove</span></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="cv-xs cv-faint cv-num">{i + 1}</td>
              {cols.map((c) => {
                const b = bad(i, c.k);
                const num = c.type === 'money' || c.type === 'number';
                const cls = `${s.cell} ${num ? s.num : ''} ${b ? (b.level === 'error' ? s.err : s.warn) : ''}`;
                const label = `${c.label}, row ${i + 1}`;
                return (
                  <td key={c.k}>
                    {c.type === 'enum' ? (
                      <select id={cellId(kind, i, c.k)} aria-label={label} aria-invalid={b?.level === 'error' || undefined} value={r[c.k] ?? ''} onChange={(e) => set(i, c.k, e.target.value)} className={cls}>
                        <option value="">Choose…</option>
                        {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input id={cellId(kind, i, c.k)} aria-label={label} aria-invalid={b?.level === 'error' || undefined} title={b?.msg} value={r[c.k] ?? ''} inputMode={num ? 'decimal' : 'text'} onChange={(e) => set(i, c.k, e.target.value)} className={cls} />
                    )}
                  </td>
                );
              })}
              <td><button type="button" className="iconbtn" style={{ width: 28, height: 28 }} aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="X" size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Issues({ kind, result, mode, onJump }) {
  if (!result) return null;
  const { errors, warnings, issues, rows } = result;
  const jump = (x) => {
    if (mode !== 'grid' || !x.row) return;
    const col = x.col || SCHEMAS[kind].columns[0].k;
    const el = document.getElementById(cellId(kind, x.row - 1, col));
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
    onJump?.();
  };
  return (
    <div className="cv-col" style={{ gap: 8 }} role="status" aria-live="polite">
      <div className="cv-row" style={{ gap: 8 }}>
        <Pill tone={errors ? 'bad' : 'good'} icon={errors ? 'CircleX' : 'CircleCheck'}>{errors ? plural(errors, 'error') : 'No errors'}</Pill>
        <Pill tone={warnings ? 'warn' : 'neutral'} icon="TriangleAlert">{plural(warnings, 'warning')}</Pill>
        <span className="cv-xs cv-faint">{plural(rows.length, 'row')} ready{errors ? '. Fix the errors to commit; warnings are allowed.' : ''}</span>
      </div>
      {issues.length > 0 && (
        <ul className="cv-issues">
          {issues.slice(0, 12).map((x, i) => (
            <li key={i} className={x.level}>
              <Icon name={x.level === 'error' ? 'CircleX' : 'TriangleAlert'} size={14} />
              {x.row && mode === 'grid'
                ? <button type="button" className={s.issue} onClick={() => jump(x)}><b>Row {x.row}{x.col ? ` · ${SCHEMAS[kind].columns.find((c) => c.k === x.col)?.label ?? x.col}` : ''}:</b> {x.msg}</button>
                : <span>{x.row ? <b>Row {x.row}{x.col ? ` · ${x.col}` : ''}: </b> : null}{x.msg}</span>}
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
  const cols = 'minmax(0, 1.8fr) minmax(0, 1fr) minmax(0, 1fr)';
  const moved = pv.moves.filter((m) => m.changed).length;
  return (
    <div className="cv-grid g2" style={{ alignItems: 'start' }}>
      <div className="cv-col" style={{ gap: 8 }}>
        <span className="cv-over">What changes if you commit · {moved ? plural(moved, 'figure') : 'nothing moves'}</span>
        <div className="cv-diff">
          <div className="r h" style={{ gridTemplateColumns: cols }}><span>Figure</span><span>Now</span><span>After</span></div>
          {pv.moves.map((m) => (
            <div key={m.label} className={`r ${m.changed ? s.changedRow : ''}`} style={{ gridTemplateColumns: cols }}>
              <span className="cv-row" style={{ gap: 6 }}>{m.label} <Claim k={m.claim} /></span>
              <span className={m.changed ? 'was' : 'now'} style={m.changed ? undefined : { fontWeight: 400 }}>{m.before}</span>
              <span className="now" style={{ fontWeight: m.changed ? 700 : 400 }}>{m.after}{m.changed && <Icon name={m.up ? 'ArrowUp' : 'ArrowDown'} size={12} style={{ marginLeft: 4, verticalAlign: -1 }} />}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="cv-col" style={{ gap: 8 }}>
        <span className="cv-over">What can&apos;t change</span>
        <div className="cv-diff">
          <div className="r h" style={{ gridTemplateColumns: 'minmax(0,1fr) 120px' }}><span>Figure</span><span>Stays</span></div>
          {pv.frozen.map((m) => <div key={m.label} className="r" style={{ gridTemplateColumns: 'minmax(0,1fr) 120px' }}><span className="cv-row" style={{ gap: 6 }}>{m.label} <Claim k="book" /></span><span className="now">{m.value} <Icon name="Lock" size={12} /></span></div>)}
        </div>
        <span className="cv-xs cv-faint">Verified rates are frozen in their packets when the window closes. New data moves estimates and observed figures, never a proven number.</span>
      </div>
    </div>
  );
}

function Stepper({ step, bad }) {
  const steps = ['Enter rows', 'Check them', 'Commit'];
  return (
    <ol className={s.stepper} aria-label="Steps" style={{ margin: 0, padding: 0 }}>
      {steps.map((label, i) => {
        const st = i < step ? 'ok' : i === step ? (bad && i === 1 ? 'bad' : 'now') : '';
        return (
          <li key={label} className={s[st] || ''} aria-current={i === step ? 'step' : undefined}>
            <span className={s.dot}>{i < step ? <Icon name="Check" size={12} /> : st === 'bad' ? <Icon name="X" size={12} /> : i + 1}</span>{label}
          </li>
        );
      })}
    </ol>
  );
}

export function Editor({ kind, seed }) {
  const cv = useCv();
  const eng = useEngine();
  const room = CV_DS.rooms[CV_D.id];
  const schema = SCHEMAS[kind];
  const blankRow = () => Object.fromEntries(schema.columns.map((c) => [c.k, '']));
  const initialRows = () => templateRows(kind, room).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)])));
  const [mode, setMode] = React.useState(seed ? 'csv' : 'grid');
  const [rows, setRowsState] = React.useState(initialRows);
  const [csv, setCsvState] = React.useState(seed?.csv ?? '');
  const [result, setResult] = React.useState(null);
  const [mapInfo, setMapInfo] = React.useState(null);
  const [pv, setPv] = React.useState(null);
  const [dirty, setDirty] = React.useState(!!seed);
  const [replace, setReplace] = React.useState(() => !!eng.inputs[CV_D.id]?.[kind]?.opts?.replace);
  const opts = cleanOpts(kind, { replace });
  const fileRef = React.useRef(null);
  const prior = kind === 'waste' ? eng.inputs[CV_D.id]?.waste?.rows || [] : [];

  const stale = () => { setResult(null); setPv(null); setDirty(true); };
  const setRows = (r) => { setRowsState(r); stale(); };
  const setCsv = (t) => { setCsvState(t); stale(); };

  const check = () => {
    let res;
    if (mode === 'csv') {
      const parsed = parseCSV(csv);
      const mi = mapColumns(parsed.headers, kind);
      setMapInfo(mi);
      if (mi.missing.length) { setResult({ rows: [], issues: [{ row: 0, col: null, level: 'error', msg: `Missing column${mi.missing.length === 1 ? '' : 's'}: ${mi.missing.join(', ')}` }], errors: 1, warnings: 0 }); setPv(null); return; }
      res = validate(kind, parsed.rows, room, mi.map, opts);
    } else {
      setMapInfo(null);
      res = validate(kind, rows, room, null, opts);
    }
    setResult(res);
    // The preview runs on the group's own base data (eng.base), as the server's check does.
    setPv(res.errors || !res.rows.length ? null : preview(eng.base, eng.inputs, CV_D.id, kind, mergeRows(kind, prior, res.rows), opts));
  };

  // Arrived from "Bring data in": check it straight away so the issues and the preview show.
  React.useEffect(() => { if (seed) { check(); document.getElementById('inputs-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    const commitRows = mergeRows(kind, prior, result.rows);
    const changed = pv.moves.filter((m) => m.changed).map((m) => `${m.label}: ${m.before} → ${m.after}`);
    engine.commit(kind, CV_D.id, commitRows, `${opts?.replace ? 'Replaced the sample list. ' : ''}${changed.length ? changed.join('; ') : 'No figure moved'}`, opts);
    cv.toast(`${schema.title} committed for ${CV_ROOM.short}: ${plural(result.rows.length, 'row')}. ${changed.length ? `${plural(changed.length, 'figure')} moved.` : 'Nothing moved.'}`);
  };

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { cv.toast('That file is over 5 MB. Drop it on "Bring data in" instead: it reads big files and Excel.'); return; }
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ''));
    reader.readAsText(f);
  };

  const discard = () => { setRowsState(initialRows()); setCsvState(seed?.csv ?? ''); setResult(null); setPv(null); setMapInfo(null); setDirty(false); };
  const step = pv ? 2 : result ? 1 : 0;
  const canCommit = result && !result.errors && pv && !eng.saving;

  return (
    <section className="cv-card" id="inputs-editor" aria-labelledby="inputs-editor-title" style={{ scrollMarginTop: 16 }}>
      <div className="cv-card-head" style={{ alignItems: 'flex-start' }}>
        <div className="cv-row nowrap" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="cv-q-ico accent"><Icon name={schema.icon} size={18} /></span>
          <div className="cv-col" style={{ gap: 4 }}>
            <span className="cv-h4" id="inputs-editor-title">{schema.title} · {CV_ROOM.name}</span>
            {seed && <span className="cv-xs cv-row" style={{ gap: 4 }}><Icon name="FileInput" size={12} /> From {seed.source}{seed.notes ? ` · ${seed.notes}` : ''}</span>}
            <span className="cv-small cv-muted" style={{ maxWidth: '72ch' }}>{schema.blurb}</span>
          </div>
        </div>
        <Button variant="secondary" size="sm" icon="Download" onClick={() => download(`${kind}-${CV_D.id}-template.csv`, templateCSV(kind, room))}>Template</Button>
      </div>
      <Stepper step={step} bad={!!result?.errors} />
      <Tabs value={mode} onChange={(m) => { setMode(m); setResult(null); setPv(null); }} tabs={[{ value: 'grid', label: 'Type it in' }, { value: 'csv', label: 'Paste or upload CSV' }]} />
      {mode === 'grid' ? (
        <>
          <span className="cv-xs cv-faint">{kind === 'waste' ? `Each row adds to the log${prior.length ? ` (${plural(prior.length, 'entry', 'entries')} logged so far)` : ''}.` : 'Pre-filled with what this room has now. Change what’s different, then check it.'}</span>
          <Grid kind={kind} rows={rows} setRows={setRows} issues={result?.issues || []} />
          {!schema.single && (
            <div className="cv-row">
              <Button size="sm" variant="ghost" icon="Plus" onClick={() => setRows([...rows, blankRow()])}>Add a row</Button>
              <Button size="sm" variant="ghost" icon="Eraser" onClick={() => setRows([blankRow()])}>Start blank</Button>
            </div>
          )}
        </>
      ) : (
        <div className="cv-col" style={{ gap: 8 }}>
          <label htmlFor={`csv-${kind}`} className="cv-small" style={{ fontWeight: 600 }}>Paste rows with a header line, or upload a .csv</label>
          <textarea id={`csv-${kind}`} rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={templateCSV(kind, room).split('\n').slice(0, 3).join('\n')} className={s.paste} spellCheck={false} />
          <div className="cv-row" style={{ gap: 8 }}>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={onFile} style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />
            <Button size="sm" variant="secondary" icon="Upload" onClick={() => fileRef.current && fileRef.current.click()}>Upload a file</Button>
            <Button size="sm" variant="ghost" icon="ClipboardPaste" onClick={() => setCsv(templateCSV(kind, room))}>Paste the template</Button>
          </div>
          <span className="cv-xs cv-faint">Headers are matched by name: {schema.columns.map((c) => c.k).join(', ')} (common alternatives work too).</span>
          {mapInfo && mapInfo.ignored.length > 0 && <Callout icon="Info">Ignored column{mapInfo.ignored.length === 1 ? '' : 's'}: {mapInfo.ignored.join(', ')}.</Callout>}
        </div>
      )}
      {schema.replace && (
        <label className="cv-row cv-small" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer', flexWrap: 'nowrap' }}>
          <input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); stale(); }} style={{ marginTop: 3 }} />
          <span className="cv-col" style={{ gap: 2 }}><b>{schema.replace.label}</b><span className="cv-xs cv-faint">{replace ? schema.replace.note : 'Off: your rows update matching sample rows, and new names are added.'}</span></span>
        </label>
      )}
      <Issues kind={kind} result={result} mode={mode} />
      <Preview pv={pv} />
      <div className={s.bar}>
        <span className={s.barNote}>
          {eng.saving ? <><Icon name="RefreshCw" size={14} /> Saving…</>
            : canCommit ? <><Icon name="CircleCheck" size={14} color="var(--success-600)" /> Checked. Commit to make it {CV_ROOM.short}&apos;s data.</>
              : result?.errors ? <><Icon name="CircleX" size={14} color="var(--error-600)" /> Fix {plural(result.errors, 'error')} and check again.</>
                : dirty ? <><Icon name="PencilLine" size={14} /> Changed. Check the rows to see what moves.</>
                  : <><Icon name="Info" size={14} /> Nothing changed yet.</>}
        </span>
        <span className="cv-row" style={{ gap: 8 }}>
          {dirty && <Button size="sm" variant="ghost" icon="RotateCcw" onClick={discard}>Discard</Button>}
          <Button size="sm" variant={canCommit ? 'secondary' : 'primary'} icon="ListChecks" onClick={check}>Check {mode === 'grid' ? plural(rows.length, 'row') : 'the rows'}</Button>
          <Button size="sm" icon="Check" disabled={!canCommit} onClick={commit}>Commit to {CV_ROOM.short}</Button>
        </span>
      </div>
    </section>
  );
}
