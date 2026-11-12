/**
 * A small .xlsx reader: every sheet as a grid of strings. Enough for what a
 * restaurant keeps in Excel or exports from Google Sheets (counts, invoices,
 * recipe costs): shared and inline strings, numbers, booleans, formula
 * results. Dates stay as Excel serial numbers here; sniff.js turns them into
 * dates for date-like columns. Pure JS (fflate for the zip), browser and server.
 */
import { strFromU8, unzipSync } from 'fflate';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
/** All the text of <t> runs inside one element (rich text has several). */
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** True when the bytes look like a zip (xlsx, or a zip of exports). */
export const isZip = (u8) => u8 && u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4b;

/**
 * @param {Uint8Array} u8 the .xlsx file
 * @param {{ maxRows?: number }} [opts]
 * @returns {{ name: string, grid: string[][] }[]} one entry per sheet, in workbook order
 */
export function readXlsx(u8, { maxRows = 20_000 } = {}) {
  const files = unzipSync(u8, { filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name) });
  const get = (p) => (files[p] ? strFromU8(files[p]) : null);
  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('This isn’t an Excel workbook (.xlsx).');
  const shared = [...(get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rels = Object.fromEntries([...(get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: decode(attr(m[0], 'name') || 'Sheet'), rid: attr(m[0], 'r:id'), hidden: attr(m[0], 'state') === 'hidden' }));
  const out = [];
  sheets.forEach((s, i) => {
    if (s.hidden) return;
    let target = rels[s.rid] || `worksheets/sheet${i + 1}.xml`;
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    const xml = get(`xl/${target}`);
    if (!xml) return;
    const grid = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (grid.length >= maxRows) break;
      const r = +(attr(row[0], 'r') || grid.length + 1) - 1;
      const cells = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = c[1], body = c[2] || '';
        const ref = attr(`<c${head}>`, 'r');
        const t = attr(`<c${head}>`, 't');
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = '';
        if (t === 's') val = shared[+v] ?? '';
        else if (t === 'inlineStr') val = texts(body);
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v != null) val = decode(v);
        const ci = ref ? colIndex(ref) : cells.length;
        cells[ci] = val;
      }
      grid[r] = Array.from(cells, (x) => x ?? '');
    }
    const dense = Array.from(grid, (x) => x ?? []).filter((r) => r.some((x) => String(x).trim() !== ''));
    if (dense.length) out.push({ name: s.name, grid: dense });
  });
  return out;
}

/** Excel serial day → "YYYY-MM-DD" (the 1900 leap-year bug included, as Excel does). */
export function excelDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5).toISOString().slice(0, 10);
}
