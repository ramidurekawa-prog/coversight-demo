'use client';

import * as React from 'react';

import { Button, Icon } from '../kit';
import { CV_D, CV_ROOM, Callout, Pill, useCv } from './core';
import { engine, useEngine } from '../engine';
import { TOAST_FILES, readToastExports } from '../../lib/data/toast';

/* Toast data exports → this room. Works today with no API credentials: every
 * Toast restaurant can download these CSVs (Toast Web → Reports → Data
 * exports, or the nightly export). Files are read in this browser; only the
 * summary (dishes, team, hourly covers and staffing, timings) is saved. */

const LIMIT = 60 * 1024 * 1024; // per file; a quarter of a busy room is well under this

export function ToastImport({ compact = false }) {
  const cv = useCv();
  const eng = useEngine();
  const [busy, setBusy] = React.useState(false);
  const [sum, setSum] = React.useState(null);
  const inputRef = React.useRef(null);
  const current = CV_D.inputs.toast;
  const t = current?.rows?.[0];

  const pick = async (fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const tooBig = files.find((f) => f.size > LIMIT);
    if (tooBig) { setSum({ ok: false, error: `${tooBig.name} is over 60 MB. Export a shorter range (13 weeks is enough).` }); return; }
    setBusy(true);
    try {
      const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
      setSum(readToastExports(texts));
    } catch (err) {
      setSum({ ok: false, error: `Couldn't read those files: ${err.message}` });
    } finally { setBusy(false); }
  };

  const commit = () => {
    if (!sum?.ok) return;
    const { unknown, ...summary } = sum;
    const label = `${summary.weeksCovered} weeks to ${summary.end}: ${summary.counted.recipes} dishes, ${summary.counted.employees} people`;
    engine.commit('toast', CV_D.id, [summary], label);
    setSum(null);
    if (inputRef.current) inputRef.current.value = '';
    cv.toast(`Toast data loaded for ${CV_ROOM.short}. Every figure now reads your own sales, team and timings.`);
  };

  const missingCosts = sum?.ok ? sum.rows.recipes?.filter((r) => !CV_D.menu?.menu?.some((m) => m.name === r.dish && !m.costEstimated)).length ?? 0 : 0;

  return (
    <section className="cv-card" aria-labelledby="toast-import">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4" id="toast-import">Load your Toast data exports</span>
          <span className="cv-small cv-muted">No API keys needed. In Toast Web go to Reports → Data exports (or turn on the nightly export), download 13 weeks, and drop the CSVs here. Files are read in your browser; only the summary is saved.</span>
        </div>
        {t ? <Pill tone="good" icon="CircleCheck">{`${CV_ROOM.short}: Toast data to ${t.end} · ${t.weeksCovered} wk`}</Pill> : <Pill icon="CircleDashed">{`${CV_ROOM.short} is on sample data`}</Pill>}
      </div>
      {!compact && (
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>File</th><th>What it feeds</th><th>Loaded</th></tr></thead>
            <tbody>
              {Object.entries(TOAST_FILES).map(([k, f]) => (
                <tr key={k}><td className="cv-num">{f.file}</td><td className="cv-small">{f.feeds}</td><td>{t?.files?.includes(k) ? <Pill tone="good" icon="Check">Yes</Pill> : <span className="cv-xs cv-faint">Not yet</span>}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="cv-row" style={{ gap: 8 }}>
        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
          <Icon name="Upload" size={15} /> {busy ? 'Reading…' : 'Choose Toast CSV files'}
          <input ref={inputRef} type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => pick(e.target.files)} aria-label="Toast export CSV files" />
        </label>
        {eng.mode === 'local' && <span className="cv-xs cv-faint">Saved in this browser only until the server is set up.</span>}
      </div>
      {sum && !sum.ok && <Callout tone="warn" icon="CircleX">{sum.error}{sum.unknown?.length ? ` Not recognised: ${sum.unknown.join(', ')}.` : ''}</Callout>}
      {sum?.ok && (
        <div className="cv-col" style={{ gap: 10 }}>
          <div className="cv-grid g4" style={{ gap: 8 }}>
            {[['Weeks', sum.weeksCovered, `to ${sum.end}`], ['Dishes', sum.counted.recipes, 'priced from what guests paid'], ['People', sum.counted.employees, 'sales, voids, hours, wage'], ['Service hours', sum.counted.serviceHours, 'covers vs servers on the floor']].map(([k, v, n]) => (
              <div key={k} className="cv-card" style={{ padding: 10, gap: 2 }}><span className="cv-xs cv-faint">{k}</span><span className="cv-num" style={{ fontWeight: 700 }}>{v}</span><span className="cv-xs cv-faint">{n}</span></div>
            ))}
          </div>
          {sum.notes.map((n) => <Callout key={n} icon="Info">{n}</Callout>)}
          {sum.unknown?.length > 0 && <Callout icon="Info">Skipped (not a Toast export we read): {sum.unknown.join(', ')}.</Callout>}
          {missingCosts > 0 && <Callout icon="Calculator">{missingCosts} dish{missingCosts === 1 ? '' : 'es'} have no plate cost yet. They&apos;ll carry an <b>estimated</b> cost at your food-cost rate until you enter them under Recipe costs.</Callout>}
          <div className="cv-row" style={{ gap: 8 }}>
            <Button icon="Check" onClick={commit}>Load into {CV_ROOM.short}</Button>
            <Button variant="ghost" onClick={() => setSum(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
