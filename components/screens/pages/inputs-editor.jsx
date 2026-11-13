'use client';

/* Data inputs: the guided import for one kind in one room (spec 8.4).
 * Enter or upload → map columns (risky guesses need a yes) → check every row
 * → preview exactly what changes (rows matched, new, overwritten; figures;
 * findings; running tests) → confirm when it's material → commit → verify
 * that what was stored is what was checked. The server repeats the checks
 * and the confirmation rules with the same code before anything lands. */

import * as React from 'react';

import { Button, Icon, Tabs } from '../../kit';
import { CV_D, CV_DS, CV_ROOM, Callout, Claim, Pill, useCv } from '../core';
import { engine, useEngine } from '../../engine';
import { SCHEMAS, mapColumns, parseCSV, templateRows } from '../../../lib/data/ingest';
import { analyze, checkRows, cleanOpts, fingerprint, mappingReview, safeCSV } from '../../../lib/data/page/inputs';
import { jfetch } from './inputs-data';
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
const fmtVal = (field, v) => (typeof v === 'number' && /price|cost|sales|refunds|voids|comps|discounts|rate/.test(field) ? `$${v.toFixed(2)}` : String(v));

/* The page remounts after every commit (the data changed), so the result of
   the last commit is kept here and shown when the editor comes back. */
const done = { key: null, result: null };

function Grid({ kind, rows, setRows, issues }) {
  const cols = SCHEMAS[kind].columns;
  const bad = (i, k) => issues.find((x) => x.row === i + 1 && (x.col === k || x.col == null) && x.level === 'error') || issues.find((x) => x.row === i + 1 && x.col === k);
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

function Mapping({ kind, review, map, setMap, confirmed, setConfirmed }) {
  const cols = SCHEMAS[kind].columns;
  const missing = cols.filter((c) => c.required && !Object.values(map).includes(c.k));
  return (
    <div className="cv-col" style={{ gap: 8 }}>
      <span className="cv-over">Columns · how your headers were matched</span>
      <div className="cv-tablewrap">
        <table className={`cv-table ${s.mapTable}`}>
          <thead><tr><th>Your column</th><th>Read as</th><th>Match</th></tr></thead>
          <tbody>
            {review.rows.map((r) => (
              <tr key={r.header}>
                <td className="cv-num">{r.header}</td>
                <td>
                  <select className={s.select} value={map[r.header] ?? ''} aria-label={`What ${r.header} is`} onChange={(e) => { const next = { ...map }; Object.keys(next).forEach((h) => { if (next[h] === e.target.value) delete next[h]; }); if (e.target.value) next[r.header] = e.target.value; else delete next[r.header]; setMap(next); }}>
                    <option value="">Ignore this column</option>
                    {cols.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}
                  </select>
                </td>
                <td className="cv-xs">{r.how === 'exact' ? <Pill tone="good" icon="CircleCheck">Exact</Pill> : r.how === 'alias' ? (r.risk ? <span className="cv-row nowrap" style={{ gap: 6 }}><Pill tone="warn" icon="TriangleAlert">Check</Pill>{r.risk}</span> : <Pill icon="Check">Common name</Pill>) : <span className="cv-faint">Ignored</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && <Callout tone="bad" icon="CircleX">Pick a column for {missing.map((c) => c.label.toLowerCase()).join(', ')}.</Callout>}
      {review.needsConfirm && (
        <label className="cv-row cv-small" style={{ gap: 8, cursor: 'pointer', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 3 }} />
          <span><b>These columns are right.</b> <span className="cv-faint">Some were matched by a guess that could swap a money or unit meaning (per case vs per unit, gross vs net). Check them before the rows are read.</span></span>
        </label>
      )}
    </div>
  );
}

function Issues({ kind, result, mode }) {
  if (!result) return null;
  const { issues } = result;
  const jump = (x) => {
    if (mode !== 'grid' || !x.row) return;
    const col = x.col || SCHEMAS[kind].columns[0].k;
    const el = document.getElementById(cellId(kind, x.row - 1, col));
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
  };
  if (!issues.length) return null;
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? (b.confirm ? 1 : 0) - (a.confirm ? 1 : 0) : a.level === 'error' ? -1 : 1));
  return (
    <ul className="cv-issues" aria-label="Row issues">
      {sorted.slice(0, 14).map((x, i) => (
        <li key={i} className={x.level}>
          <Icon name={x.level === 'error' ? 'CircleX' : 'TriangleAlert'} size={14} />
          {x.row && mode === 'grid'
            ? <button type="button" className={s.issue} onClick={() => jump(x)}><b>Row {x.row}{x.col ? ` · ${SCHEMAS[kind].columns.find((c) => c.k === x.col)?.label ?? x.col}` : ''}:</b> {x.msg}{x.confirm ? ' (needs your yes)' : ''}</button>
            : <span>{x.row ? <b>Row {x.row}{x.col ? ` · ${x.col}` : ''}: </b> : null}{x.msg}{x.confirm ? ' (needs your yes)' : ''}</span>}
        </li>
      ))}
      {issues.length > 14 && <li className="cv-xs cv-faint">…and {issues.length - 14} more</li>}
    </ul>
  );
}

function Counts({ result, a }) {
  const d = a?.diff;
  const cells = [
    ['Accepted', result.rows.length, ''],
    ['Rejected', result.rejected, result.rejected ? 'bad' : ''],
    ['Warnings', result.warnings, result.warnings ? 'warn' : ''],
    ...(d ? [['Match existing', d.matched, ''], ['New', d.added, ''], ['Values overwritten', d.overwrites.length, d.overwrites.length ? 'warn' : ''], ...(d.removed.length ? [['Drop out', d.removed.length, 'warn']] : []), ...(a.duplicates ? [['Already logged', a.duplicates, '']] : [])] : []),
  ];
  return (
    <div className={s.counts} role="status" aria-live="polite">
      {cells.map(([label, n, tone]) => <div key={label} className={`${s.count} ${tone ? s[tone] : ''}`}><b>{n.toLocaleString('en-US')}</b><span>{label}</span></div>)}
    </div>
  );
}

const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };

/* One figure that moves: big new value, the change, and a before/after pair of bars on one scale. */
function MoveTile({ m }) {
  const b = num(m.before), af = num(m.after);
  const max = Math.max(Math.abs(b ?? 0), Math.abs(af ?? 0)) || 1;
  const pct = b ? Math.round(((af - b) / Math.abs(b)) * 100) : null;
  return (
    <div className={s.move} role="group" aria-label={`${m.label}: ${m.before} now, ${m.after} after`}>
      <span className={s.moveLabel}>{m.label} <Claim k={m.claim} /></span>
      <b className={s.moveBig}>{m.after}</b>
      <span className={s.moveDelta}><Icon name={m.up ? 'ArrowUp' : 'ArrowDown'} size={12} />{pct != null && Number.isFinite(pct) ? `${pct > 0 ? '+' : ''}${pct}%` : 'changed'} <span className="cv-faint">from {m.before}</span></span>
      {b != null && af != null && (
        <span className={s.moveBars} aria-hidden="true">
          <span title={`Now ${m.before}`}><i style={{ width: `${(Math.abs(b) / max) * 100}%`, background: 'var(--neutral-300)' }} /></span>
          <span title={`After ${m.after}`}><i style={{ width: `${(Math.abs(af) / max) * 100}%`, background: 'var(--accent)' }} /></span>
        </span>
      )}
    </div>
  );
}

function Preview({ a }) {
  if (!a) return null;
  const cols = 'minmax(0, 1.8fr) minmax(0, 1fr) minmax(0, 1fr)';
  const moved = a.moves.filter((m) => m.changed).length;
  const f = a.findings;
  const usd = (v) => `$${Math.round(v).toLocaleString('en-US')}/wk`;
  return (
    <div className="cv-col" style={{ gap: 14 }}>
      {a.diff.overwrites.length > 0 && (
        <details>
          <summary className="cv-small" style={{ cursor: 'pointer', fontWeight: 600 }}>{plural(a.diff.overwrites.length, 'value')} you&apos;re changing</summary>
          <ul className="cv-col cv-xs" style={{ gap: 2, margin: '6px 0 0', paddingLeft: 18 }}>
            {a.diff.overwrites.slice(0, 20).map((o, i) => <li key={i}>{o.name} · {o.field.replace('_', ' ')}: <span className="cv-faint" style={{ textDecoration: 'line-through' }}>{fmtVal(o.field, o.from)}</span> → <b>{fmtVal(o.field, o.to)}</b></li>)}
            {a.diff.overwrites.length > 20 && <li className="cv-faint">…and {a.diff.overwrites.length - 20} more</li>}
          </ul>
        </details>
      )}
      {a.diff.removed.length > 0 && <Callout tone="warn" icon="TriangleAlert">Replacing the list drops {a.diff.removed.slice(0, 6).join(', ')}{a.diff.removed.length > 6 ? ` and ${a.diff.removed.length - 6} more` : ''}.</Callout>}
      {moved > 0 ? (
        <div className={s.moves} aria-label="Figures that change">
          {a.moves.filter((m) => m.changed).slice(0, 4).map((m) => <MoveTile key={m.label} m={m} />)}
        </div>
      ) : <span className="cv-small cv-muted"><Icon name="Minus" size={13} style={{ verticalAlign: -2 }} /> No figure moves with these rows.</span>}
      <div className="cv-row" style={{ gap: 8 }}>
        <Pill tone="neutral" icon="Lock">{plural(a.frozen.length, 'verified saving')} stay{a.frozen.length === 1 ? 's' : ''} frozen</Pill>
        <Claim k="book" />
      </div>
      <details>
        <summary className="cv-small" style={{ cursor: 'pointer', fontWeight: 600 }}>Every figure, before and after</summary>
        <div className="cv-grid g2" style={{ alignItems: 'start', marginTop: 8 }}>
          <div className="cv-diff">
            <div className="r h" style={{ gridTemplateColumns: cols }}><span>Figure</span><span>Now</span><span>After</span></div>
            {a.moves.map((m) => (
              <div key={m.label} className={`r ${m.changed ? s.changedRow : ''}`} style={{ gridTemplateColumns: cols }}>
                <span className="cv-row" style={{ gap: 6 }}>{m.label} <Claim k={m.claim} /></span>
                <span className={m.changed ? 'was' : 'now'} style={m.changed ? undefined : { fontWeight: 400 }}>{m.before}</span>
                <span className="now" style={{ fontWeight: m.changed ? 700 : 400 }}>{m.after}{m.changed && <Icon name={m.up ? 'ArrowUp' : 'ArrowDown'} size={12} style={{ marginLeft: 4, verticalAlign: -1 }} />}</span>
              </div>
            ))}
          </div>
          <div className="cv-col" style={{ gap: 8 }}>
            <div className="cv-diff">
              <div className="r h" style={{ gridTemplateColumns: 'minmax(0,1fr) 120px' }}><span>Can&apos;t change</span><span>Stays</span></div>
              {a.frozen.map((m) => <div key={m.label} className="r" style={{ gridTemplateColumns: 'minmax(0,1fr) 120px' }}><span className="cv-row" style={{ gap: 6 }}>{m.label} <Claim k="book" /></span><span className="now">{m.value} <Icon name="Lock" size={12} /></span></div>)}
            </div>
            <span className="cv-xs cv-faint">Verified savings are frozen when their test window closes. New data never moves them.</span>
          </div>
        </div>
      </details>
      {(f.unblocked.length + f.blocked.length + f.changed.length + f.added.length + f.gone.length > 0 || a.tests.length > 0) && (
        <div className="cv-col" style={{ gap: 6 }}>
          <span className="cv-over">Findings and tests affected</span>
          <ul className="cv-issues">
            {f.unblocked.map((x) => <li key={`u${x.id}`} className="good" style={{ background: 'var(--success-50)' }}><Icon name="CircleCheck" size={14} color="var(--success-600)" /><span><b>Can be acted on:</b> {x.title} · {usd(x.value)} potential opportunity <Claim k={x.claim || 'est'} /></span></li>)}
            {f.blocked.map((x) => <li key={`b${x.id}`} className="warn"><Icon name="Ban" size={14} /><span><b>Held back:</b> {x.title}</span></li>)}
            {f.changed.slice(0, 6).map((x) => <li key={`c${x.id}`} style={{ background: 'var(--surface-sunken)' }}><Icon name="ArrowRightLeft" size={14} /><span>{x.title}: potential opportunity {usd(x.from)} → <b>{usd(x.to)}</b> <Claim k={x.claim || 'est'} /></span></li>)}
            {f.added.map((x) => <li key={`a${x.id}`} style={{ background: 'var(--surface-sunken)' }}><Icon name="Plus" size={14} /><span><b>New finding:</b> {x.title}</span></li>)}
            {f.gone.map((x) => <li key={`g${x.id}`} style={{ background: 'var(--surface-sunken)' }}><Icon name="Minus" size={14} /><span><b>No longer a finding:</b> {x.title}</span></li>)}
            {a.tests.map((t) => <li key={`t${t.id}`} className="warn"><Icon name="FlaskConical" size={14} /><span><b>Running test reads this data:</b> {t.title}. It will be flagged for reassessment.</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

const STEPS = ['Enter', 'Map', 'Check', 'Preview', 'Confirm', 'Commit'];
function Stepper({ step, bad, csv }) {
  return (
    <ol className={s.stepper} aria-label="Import steps" style={{ margin: 0, padding: 0 }}>
      {STEPS.filter((l) => csv || l !== 'Map').map((label) => {
        const i = STEPS.indexOf(label);
        const st = i < step ? 'ok' : i === step ? (bad ? 'bad' : 'now') : '';
        return (
          <li key={label} className={s[st] || ''} aria-current={i === step ? 'step' : undefined}>
            <span className={s.dot}>{i < step ? <Icon name="Check" size={12} /> : st === 'bad' ? <Icon name="X" size={12} /> : STEPS.filter((l) => csv || l !== 'Map').indexOf(label) + 1}</span>{label}
          </li>
        );
      })}
    </ol>
  );
}

function Verified({ r, onClose }) {
  const bad = !r.verify.ok;
  return (
    <div className={`${s.verifyBox} ${bad ? s.bad : ''}`} role="status" aria-live="polite">
      <Icon name={bad ? 'CircleX' : r.unchanged ? 'Info' : 'ShieldCheck'} size={18} color={bad ? 'var(--error-600)' : 'var(--success-600)'} />
      <div className="cv-col" style={{ gap: 2, flex: 1 }}>
        <b>{bad ? 'Saved, but the stored rows don’t match what was checked.' : r.unchanged ? 'Nothing new: identical to what’s in use, so nothing was added.' : `Committed and verified: ${plural(r.verify.rows, 'row')} stored, matching what was checked.`}</b>
        {bad && <span className="cv-xs">Undo it below and import again; if it repeats, tell us. Expected print {r.verify.expected}, stored {r.verify.fingerprint || 'nothing'}.</span>}
        {!bad && !r.unchanged && (
          <span className="cv-xs cv-faint">
            {r.effects.moved ? `${plural(r.effects.moved, 'figure')} moved. ` : 'No figure moved. '}
            {r.duplicates ? `${plural(r.duplicates, 'row')} already logged, skipped. ` : ''}
            {r.effects.unblocked.length ? `Can now be acted on: ${r.effects.unblocked.join(', ')}. ` : ''}
            {r.effects.tests.length ? `Flagged for reassessment: ${r.effects.tests.join(', ')}.` : ''}
          </span>
        )}
      </div>
      <button type="button" className="iconbtn" style={{ width: 28, height: 28 }} aria-label="Dismiss" onClick={onClose}><Icon name="X" size={14} /></button>
    </div>
  );
}

export function Editor({ kind, seed, startMode }) {
  const cv = useCv();
  const eng = useEngine();
  const server = eng.mode === 'server';
  const room = CV_DS.rooms[CV_D.id];
  const schema = SCHEMAS[kind];
  const blankRow = () => Object.fromEntries(schema.columns.map((c) => [c.k, '']));
  const initialRows = () => templateRows(kind, room).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)])));
  const doneKey = `${CV_D.id}/${kind}`;
  const [last, setLast] = React.useState(done.key === doneKey ? done.result : null);
  const [mode, setMode] = React.useState(seed ? 'csv' : startMode || 'grid');
  const [rows, setRowsState] = React.useState(initialRows);
  const [csv, setCsvState] = React.useState(seed?.csv ?? '');
  const [file, setFile] = React.useState(seed ? { name: seed.source, source: seed.via || 'file' } : null);
  const [map, setMapState] = React.useState(null);
  const [mapOk, setMapOk] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [a, setA] = React.useState(null);
  const [yes, setYes] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(!!seed);
  const [replace, setReplace] = React.useState(() => !!eng.inputs[CV_D.id]?.[kind]?.opts?.replace);
  const opts = cleanOpts(kind, { replace });
  const fileRef = React.useRef(null);

  const parsed = React.useMemo(() => (mode === 'csv' && csv.trim() ? parseCSV(csv) : null), [mode, csv]);
  const autoMap = React.useMemo(() => (parsed ? mapColumns(parsed.headers, kind).map : {}), [parsed, kind]);
  const curMap = map ?? autoMap;
  const review = parsed ? mappingReview(parsed.headers, kind, curMap) : null;
  const missingCols = schema.columns.filter((c) => c.required && !Object.values(curMap).includes(c.k));

  const stale = () => { setResult(null); setA(null); setYes(false); setDirty(true); };
  const setRows = (r) => { setRowsState(r); stale(); };
  const setCsv = (t) => { setCsvState(t); setMapState(null); setMapOk(false); stale(); };
  const setMap = (m) => { setMapState(m); stale(); };

  const check = () => {
    setLast(null); done.key = null;
    let res;
    if (mode === 'csv') {
      if (!parsed) return;
      res = checkRows(kind, parsed.rows, room, opts, { mapping: curMap });
      res.rejected = new Set(res.issues.filter((x) => x.level === 'error' && x.row).map((x) => x.row)).size;
    } else {
      res = checkRows(kind, rows, room, opts);
      res.rejected = new Set(res.issues.filter((x) => x.level === 'error' && x.row).map((x) => x.row)).size;
    }
    setResult(res);
    setYes(false);
    setA(res.errors || !res.rows.length ? null : analyze({ base: eng.base, inputs: eng.inputs, roomId: CV_D.id, kind, rows: res.rows, opts, windows: eng.windows, issues: res.issues, mappingNeedsConfirm: false }));
  };

  // Arrived from "Bring data in": check it straight away so the issues and the preview show.
  React.useEffect(() => { if (seed) { if (!review?.needsConfirm && !missingCols.length) check(); document.getElementById('inputs-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (r) => { done.key = doneKey; done.result = r; setLast(r); };
  const commit = async () => {
    if (a.unchanged) { finish({ unchanged: true, duplicates: a.duplicates, verify: { ok: true, rows: a.rows.length, fingerprint: a.fingerprint, expected: a.fingerprint }, effects: { moved: 0, unblocked: [], tests: [] } }); return; }
    const changed = a.moves.filter((m) => m.changed).map((m) => `${m.label}: ${m.before} → ${m.after}`);
    const source = mode === 'grid' ? 'grid' : file?.source || 'csv';
    setBusy(true);
    try {
      if (server) {
        const r = await jfetch('/api/inputs', { method: 'POST', body: JSON.stringify({
          roomId: CV_D.id, kind, rows: result.rows, opts, confirm: a.confirm.length ? yes : undefined,
          mappingConfirmed: review?.needsConfirm ? mapOk : undefined,
          provenance: { source, ...(file?.name ? { file: file.name.slice(0, 300) } : {}), ...(mode === 'csv' ? { filePrint: fingerprint(csv), mapping: curMap } : {}), rejected: result.rejected },
        }) });
        finish(r);
        await engine.hydrate();
      } else {
        engine.commit(kind, CV_D.id, a.rows, `${opts?.replace ? 'Replaced the sample list. ' : ''}${changed.length ? changed.join('; ') : 'No figure moved'}`, opts);
        const stored = engine.get().inputs[CV_D.id]?.[kind]?.rows || [];
        finish({ unchanged: false, duplicates: a.duplicates, verify: { ok: fingerprint(stored) === a.fingerprint, rows: stored.length, fingerprint: fingerprint(stored), expected: a.fingerprint }, effects: { moved: changed.length, unblocked: a.findings.unblocked.map((x) => x.title), tests: a.tests.map((t) => t.title) } });
      }
      cv.toast(`${schema.title} committed for ${CV_ROOM.short}.`);
    } catch (e) {
      cv.toast(`Not saved: ${e.message}`);
    } finally { setBusy(false); }
  };

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { cv.toast('That file is over 5 MB. Drop it on "Bring data in" instead: it reads big files and Excel.'); return; }
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result || '')); setFile({ name: f.name, source: 'file' }); };
    reader.readAsText(f);
  };

  const discard = () => { setRowsState(initialRows()); setCsvState(seed?.csv ?? ''); setMapState(null); setMapOk(false); setResult(null); setA(null); setDirty(false); setYes(false); };
  const needYes = !!a?.confirm.length;
  const step = a ? (needYes && !yes ? 4 : 5) : result ? 2 : mode === 'csv' && parsed ? 1 : 0;
  const mapBlocked = mode === 'csv' && (!parsed || missingCols.length > 0 || (review?.needsConfirm && !mapOk));
  const canCommit = result && !result.errors && a && (!needYes || yes) && !busy && !eng.saving;

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
        <Button variant="secondary" size="sm" icon="Download" onClick={() => download(`${kind}-${CV_D.id}-template.csv`, safeCSV(schema.columns.map((c) => c.k), templateRows(kind, room)))}>Template</Button>
      </div>
      {last && <Verified r={last} onClose={() => { done.key = null; setLast(null); }} />}
      <Stepper step={step} bad={!!result?.errors} csv={mode === 'csv'} />
      <Tabs value={mode} onChange={(m) => { setMode(m); stale(); }} tabs={[{ value: 'grid', label: 'Type it in' }, { value: 'csv', label: 'Paste or upload CSV' }]} />
      {mode === 'grid' ? (
        <>
          <span className="cv-xs cv-faint">{kind === 'waste' ? `Each row adds to the log${eng.inputs[CV_D.id]?.waste?.rows?.length ? ` (${plural(eng.inputs[CV_D.id].waste.rows.length, 'entry', 'entries')} logged so far)` : ''}. A row already logged isn’t added twice.` : 'Pre-filled with what this room has now. Change what’s different, then check it.'}</span>
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
          <textarea id={`csv-${kind}`} rows={8} value={csv} onChange={(e) => { setCsv(e.target.value); if (file?.source === 'file') setFile({ name: `${file.name} (edited)`, source: 'paste' }); else if (!file) setFile({ name: null, source: 'paste' }); }} placeholder={safeCSV(schema.columns.map((c) => c.k), templateRows(kind, room)).split('\n').slice(0, 3).join('\n')} className={s.paste} spellCheck={false} />
          <div className="cv-row" style={{ gap: 8 }}>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={onFile} style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />
            <Button size="sm" variant="secondary" icon="Upload" onClick={() => fileRef.current && fileRef.current.click()}>Upload a file</Button>
            <Button size="sm" variant="ghost" icon="ClipboardPaste" onClick={() => { setCsv(safeCSV(schema.columns.map((c) => c.k), templateRows(kind, room))); setFile({ name: 'template', source: 'paste' }); }}>Paste the template</Button>
          </div>
          {review && <Mapping kind={kind} review={review} map={curMap} setMap={setMap} confirmed={mapOk} setConfirmed={(v) => { setMapOk(v); stale(); }} />}
        </div>
      )}
      {schema.replace && (
        <label className="cv-row cv-small" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer', flexWrap: 'nowrap' }}>
          <input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); stale(); }} style={{ marginTop: 3 }} />
          <span className="cv-col" style={{ gap: 2 }}><b>{schema.replace.label}</b><span className="cv-xs cv-faint">{replace ? schema.replace.note : 'Off: your rows update matching sample rows, and new names are added.'}</span></span>
        </label>
      )}
      {result && <Counts result={result} a={a} />}
      <Issues kind={kind} result={result} mode={mode} />
      <Preview a={a} />
      {needYes && (
        <div className={s.confirmBox}>
          <b>Confirm before this lands</b>
          <ul>{a.confirm.map((r) => <li key={r}>{r}</li>)}</ul>
          <label className="cv-row" style={{ gap: 8, cursor: 'pointer', flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={yes} onChange={(e) => setYes(e.target.checked)} />
            <span>Yes, I&apos;ve checked this and want to commit it.</span>
          </label>
        </div>
      )}
      <div className={s.bar}>
        <span className={s.barNote}>
          {busy || eng.saving ? <><Icon name="RefreshCw" size={14} /> Saving and verifying…</>
            : canCommit ? <><Icon name="CircleCheck" size={14} color="var(--success-600)" /> {a.unchanged ? 'Identical to what’s in use.' : `Checked. Commit to make it ${CV_ROOM.short}’s data.`}</>
              : a && needYes && !yes ? <><Icon name="TriangleAlert" size={14} color="var(--warning-600)" /> Confirm above to commit.</>
                : result?.errors ? <><Icon name="CircleX" size={14} color="var(--error-600)" /> Fix {plural(result.errors, 'error')} and check again.</>
                  : mapBlocked && parsed ? <><Icon name="Columns3" size={14} /> {missingCols.length ? 'Pick the missing columns.' : 'Confirm the columns first.'}</>
                    : dirty ? <><Icon name="PencilLine" size={14} /> Changed. Check the rows to see what moves.</>
                      : <><Icon name="Info" size={14} /> Nothing changed yet.</>}
        </span>
        <span className="cv-row" style={{ gap: 8 }}>
          {dirty && <Button size="sm" variant="ghost" icon="RotateCcw" onClick={discard}>Discard</Button>}
          <Button size="sm" variant={canCommit ? 'secondary' : 'primary'} icon="ListChecks" disabled={mapBlocked} onClick={check}>Check {mode === 'grid' ? plural(rows.length, 'row') : parsed ? plural(parsed.rows.length, 'row') : 'the rows'}</Button>
          <Button size="sm" icon="Check" disabled={!canCommit} onClick={commit}>{a?.unchanged ? 'Nothing to commit' : `Commit to ${CV_ROOM.short}`}</Button>
        </span>
      </div>
    </section>
  );
}
