/**
 * Lane 2, the easy way in: take whatever someone has (a CSV, an Excel
 * workbook with several tabs, a zip of Toast exports, a paste from a
 * spreadsheet) and work out what each table is, so nobody has to pick a
 * "kind" or rename a column first.
 *
 *   readAny()   bytes → tables (one per CSV, per sheet, per file in a zip) and media (photos, PDFs)
 *   classify()  a table → a Toast export file, one of the Data inputs kinds, or unknown
 *   route()     everything dropped at once → what to load, what to review, what to ask about
 *
 * Every table still goes through validate() and the preview before it
 * lands; this only decides where it goes. Pure JS, browser and server.
 */
import { strFromU8, unzipSync } from 'fflate';

import { SCHEMAS, KINDS, gridToTable, mapColumns, parseRows, toCSV } from './ingest.js';
import { detectToastFile, TOAST_FILES } from './toast.js';
import { excelDate, isZip, readXlsx } from './xlsx.js';

export const MEDIA = /\.(jpe?g|png|webp|gif|heic|pdf)$/i;
const TEXT = /\.(csv|tsv|txt)$/i;
const SHEET = /\.(xlsx|xlsm)$/i;
const LEGACY = /\.(xls|numbers|ods)$/i;
/** Per file. A zip may hold several. */
export const MAX_BYTES = 60 * 1024 * 1024;

/** File-name words that settle a tie between kinds whose columns look alike. */
const HINTS = {
  recipes: /recipe|menu|plate|dish|costing/i,
  invoices: /invoice|vendor|supplier|purchase|order guide|sysco|usfoods|us foods/i,
  counts: /count|inventory|stock|on hand/i,
  waste: /waste|spoil|comp(?!s)/i,
  channels: /channel|deliver|doordash|uber|grubhub|takeout/i,
  exceptions: /void|comp|discount|staff|employee|server|exception/i,
  profile: /profile|restaurant|location/i,
};

const decodeText = (u8) => strFromU8(u8).replace(/^﻿/, '');

/**
 * @param {{ name: string, bytes?: Uint8Array, text?: string, type?: string }} file
 * @returns {{ tables: { source: string, name: string, grid: string[][] }[], media: { name: string, type: string, size: number, bytes?: Uint8Array }[], errors: { name: string, msg: string }[] }}
 */
export function readAny(file, depth = 0) {
  const out = { tables: [], media: [], errors: [] };
  const name = String(file.name || 'pasted');
  const size = file.bytes ? file.bytes.length : (file.text || '').length;
  if (size > MAX_BYTES) { out.errors.push({ name, msg: `Over ${MAX_BYTES / 1024 / 1024} MB. Export a shorter range (13 weeks is plenty).` }); return out; }
  try {
    if (file.text != null) {
      out.tables.push({ source: name, name, grid: parseRows(file.text) });
    } else if (MEDIA.test(name) || /^image\/|^application\/pdf$/.test(file.type || '')) {
      out.media.push({ name, type: file.type || (/\.pdf$/i.test(name) ? 'application/pdf' : `image/${name.split('.').pop().toLowerCase().replace('jpg', 'jpeg')}`), size, bytes: file.bytes });
    } else if (SHEET.test(name) || (isZip(file.bytes) && !/\.zip$/i.test(name) && tryWorkbook(file.bytes))) {
      for (const s of readXlsx(file.bytes)) out.tables.push({ source: `${name} · ${s.name}`, name, grid: s.grid });
    } else if (/\.zip$/i.test(name) || isZip(file.bytes)) {
      if (depth > 1) { out.errors.push({ name, msg: 'A zip inside a zip inside a zip. Unzip it once and drop the files.' }); return out; }
      const entries = unzipSync(file.bytes, { filter: (f) => !/(^|\/)(__MACOSX|\.)/.test(f.name) && (TEXT.test(f.name) || SHEET.test(f.name) || /\.zip$/i.test(f.name)) && f.originalSize <= MAX_BYTES });
      const names = Object.keys(entries);
      if (!names.length) out.errors.push({ name, msg: 'No CSV or Excel files inside this zip.' });
      for (const n of names) {
        const sub = readAny({ name: n.split('/').pop(), bytes: entries[n] }, depth + 1);
        out.tables.push(...sub.tables.map((t) => ({ ...t, source: `${name} › ${t.source}` })));
        out.errors.push(...sub.errors);
      }
    } else if (LEGACY.test(name)) {
      out.errors.push({ name, msg: 'Older spreadsheet format. In Excel or Numbers use File → Save As → .xlsx or CSV, then drop it again.' });
    } else if (TEXT.test(name) || !file.bytes || looksLikeText(file.bytes)) {
      out.tables.push({ source: name, name, grid: parseRows(decodeText(file.bytes)) });
    } else {
      out.errors.push({ name, msg: 'Not a file Coversight can read. Drop CSV, Excel (.xlsx), a zip of those, or a photo or PDF.' });
    }
  } catch (e) {
    out.errors.push({ name, msg: `Couldn’t read it: ${e instanceof Error ? e.message : String(e)}` });
  }
  return out;
}

function tryWorkbook(u8) {
  try { return !!unzipSync(u8, { filter: (f) => f.name === 'xl/workbook.xml' })['xl/workbook.xml']; } catch { return false; }
}
function looksLikeText(u8) {
  const n = Math.min(u8.length, 2000);
  let bad = 0;
  for (let i = 0; i < n; i++) if (u8[i] === 0 || (u8[i] < 9)) bad++;
  return bad === 0;
}

/**
 * What one table is. Spreadsheets often carry a title or a blank line above
 * the header, so the first ten rows are each tried as the header.
 * @returns {{ lane: 'toast', kind: string, headerRow: number } | { lane: 'manual', kind: string, headerRow: number, score: number, also: string[] } | { lane: 'unknown', guess: string|null, missing: string[], headerRow: number }}
 */
export function classify(grid, name = '') {
  let best = null, partial = null;
  for (let h = 0; h < Math.min(10, grid.length - 1); h++) {
    const headers = (grid[h] || []).map((x) => String(x ?? '').trim());
    if (headers.filter(Boolean).length < 2) continue;
    const toast = detectToastFile(headers);
    if (toast) return { lane: 'toast', kind: toast, headerRow: h };
    for (const kind of KINDS) {
      const m = mapColumns(headers, kind);
      const mapped = Object.keys(m.map).length;
      const score = mapped * 10 + (HINTS[kind]?.test(name) ? 5 : 0) - h * 0.1;
      if (!m.missing.length) {
        if (!best || score > best.score) best = { lane: 'manual', kind, headerRow: h, score, also: [] };
      } else if (mapped > 0 && (!partial || score > partial.score)) partial = { kind, missing: m.missing, headerRow: h, score };
    }
  }
  if (best) {
    // Other kinds that would also take this table (shown as a "not right?" switch).
    const headers = grid[best.headerRow].map((x) => String(x ?? '').trim());
    best.also = KINDS.filter((k) => k !== best.kind && !mapColumns(headers, k).missing.length);
    return best;
  }
  return { lane: 'unknown', guess: partial?.kind ?? null, missing: partial?.missing ?? [], headerRow: partial?.headerRow ?? 0 };
}

/** A manual table as CSV with its header row first and Excel dates turned into dates. */
export function tableCSV(grid, headerRow, kind) {
  const t = gridToTable(grid, headerRow);
  const dateCols = new Set(t.headers.filter((h) => /date|day|when/i.test(h)));
  const rows = t.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, dateCols.has(k) && excelDate(v) ? excelDate(v) : v])));
  return { csv: toCSV(t.headers, rows), rows: rows.length, headers: t.headers, kind };
}

/**
 * Everything dropped (or pasted, or fetched) at once.
 * @param {{ name: string, bytes?: Uint8Array, text?: string, type?: string }[]} files
 */
export function route(files) {
  const toast = [], manual = [], unknown = [], media = [], errors = [];
  for (const f of files) {
    const r = readAny(f);
    media.push(...r.media);
    errors.push(...r.errors);
    for (const t of r.tables) {
      if (t.grid.length < 2) { errors.push({ name: t.source, msg: 'Only one line. A header row and at least one row of data are needed.' }); continue; }
      const c = classify(t.grid, t.source);
      if (c.lane === 'toast') toast.push({ source: t.source, kind: c.kind, name: TOAST_FILES[c.kind].file, rows: gridToTable(t.grid, c.headerRow).rows });
      else if (c.lane === 'manual') manual.push({ source: t.source, kind: c.kind, also: c.also, ...tableCSV(t.grid, c.headerRow, c.kind) });
      else unknown.push({ source: t.source, guess: c.guess, missing: c.missing, grid: t.grid, headerRow: c.headerRow, headers: (t.grid[c.headerRow] || []).map(String) });
    }
  }
  return { toast, manual, unknown, media, errors };
}

/** The columns a kind takes, for the "what is this?" picker and for photo reading. */
export const kindColumns = (kind) => SCHEMAS[kind].columns.map((c) => ({ k: c.k, label: c.label, required: c.required, type: c.type, ...(c.options ? { options: c.options } : {}) }));
