import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { classify, readAny, route } from '../lib/data/sniff.js';
import { parseRows, validate } from '../lib/data/ingest.js';
import { excelDate, readXlsx } from '../lib/data/xlsx.js';
import { summarizeToast } from '../lib/data/toast.js';
import { SEED } from '../lib/data/seed.js';

/** A minimal .xlsx the way Excel writes one: shared strings, numbers, an inline string, a hidden sheet. */
function xlsx(sheets) {
  const shared = [];
  const si = (s) => { let i = shared.indexOf(s); if (i < 0) { shared.push(s); i = shared.length - 1; } return i; };
  const col = (i) => String.fromCharCode(65 + i);
  const files = {
    'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.hidden ? ' state="hidden"' : ''}/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships>${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`),
  };
  sheets.forEach((s, i) => {
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v === '' ? '' : typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : ci === 0 && ri === 0 && s.inline ? `<c r="A1" t="inlineStr"><is><t>${v}</t></is></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>`)).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`);
  });
  files['xl/sharedStrings.xml'] = strToU8(`<sst>${shared.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`);
  return zipSync(files);
}

const room = SEED.rooms.oakland;

describe('reading whatever is dropped', () => {
  it('reads every visible sheet of a workbook, skipping a hidden one', () => {
    const u8 = xlsx([
      { name: 'Counts', rows: [['Walk-in count, Oct 26', ''], ['', ''], ['Item', 'On hand', 'Unit cost'], ['Salmon', 14, 11.5], ['Ribeye & strip', 9, 18]], inline: true },
      { name: 'Scratch', hidden: true, rows: [['x', 'y'], [1, 2]] },
      { name: 'Invoices', rows: [['Product', 'Supplier', 'Price', 'Cases'], ['Salmon', 'Pacific Seafood', 11.25, 40]] },
    ]);
    const sheets = readXlsx(u8);
    expect(sheets.map((s) => s.name)).toEqual(['Counts', 'Invoices']);
    expect(sheets[0].grid[3]).toEqual(['Ribeye & strip', '9', '18']);
    const r = route([{ name: 'october.xlsx', bytes: u8 }]);
    expect(r.manual.map((m) => [m.source, m.kind])).toEqual([['october.xlsx · Counts', 'counts'], ['october.xlsx · Invoices', 'invoices']]);
  });

  it('finds the header below a title line, and the rows validate', () => {
    const grid = parseRows('Rosewood recipe costing\n\nMenu item,Menu price,Plate cost,Plates\nBurger,"$18.00",$5.10,120\n');
    const c = classify(grid, 'costing.csv');
    expect(c).toMatchObject({ lane: 'manual', kind: 'recipes', headerRow: 1 });
  });

  it('settles look-alike tables by columns, then by file name', () => {
    // item, price, cost, units fits recipes fully and invoices partly: recipes maps more columns.
    expect(classify(parseRows('Item,Price,Cost,Units\nBurger,18,5,100'), 'x.csv').kind).toBe('recipes');
    // A plain item/price/qty sheet is an invoice; its name confirms it.
    expect(classify(parseRows('Item,Unit price,Qty\nSalmon,11.25,40'), 'sysco-oct.csv').kind).toBe('invoices');
  });

  it('a paste from Excel is tab-separated and keeps "$1,234.50" whole', () => {
    const r = route([{ name: 'pasted', text: 'Channel\tNet sales\tOrders\nDoorDash\t$1,234.50\t61\nDine-in\t$18,400.00\t512' }]);
    expect(r.manual[0].kind).toBe('channels');
    const rows = parseRows(r.manual[0].csv);
    expect(rows[1]).toEqual(['DoorDash', '$1,234.50', '61']);
    const v = validate('channels', rows.slice(1).map((x) => ({ channel: x[0], sales: x[1], orders: x[2] })), room, null);
    expect(v.errors).toBe(0);
    expect(v.rows[0].sales).toBe(1234.5);
  });

  it('a header with a comma in it survives the trip to the review panel', () => {
    const r = route([{ name: 'pasted', text: 'Channel\tNet sales, this week\tOrders\nDoorDash\t$3,120.40\t118' }]);
    expect(parseRows(r.manual[0].csv)[0]).toEqual(['Channel', 'Net sales, this week', 'Orders']);
  });

  it('a zip of Toast exports is unpacked, recognised and summarised', () => {
    const items = 'Order Id,Order Date,Sent Date,Menu Item,Qty,Net Price,Gross Price,Void?,Server,Dining Option,Sales Category\n'
      + Array.from({ length: 30 }, (_, i) => `o${i},10/2${i % 7}/26 7:0${i % 10} PM,10/2${i % 7}/26 7:0${i % 10} PM,Burger,1,18.00,18.00,false,Ana,Dine In,Food`).join('\n');
    const orders = 'Order Id,Opened,Paid,# of Guests,Server,Amount,Discount Amount,Voided,Dining Options,Table\n'
      + Array.from({ length: 30 }, (_, i) => `o${i},10/2${i % 7}/26 7:0${i % 10} PM,10/2${i % 7}/26 8:0${i % 10} PM,2,Ana,18.00,0,false,Dine In,${i % 5}`).join('\n');
    const zip = zipSync({ 'export/ItemSelectionDetails.csv': strToU8(items), 'export/OrderDetails.csv': strToU8(orders), '__MACOSX/._x.csv': strToU8('junk') });
    const r = route([{ name: 'toast-export.zip', bytes: zip }]);
    expect(r.toast.map((t) => t.kind).sort()).toEqual(['items', 'orders']);
    expect(r.errors).toEqual([]);
    const s = summarizeToast(r.toast);
    expect(s.ok).toBe(true);
    expect(s.rows.recipes[0].dish).toBe('Burger');
  });

  it('photos and PDFs go to the photo lane; old formats get a plain fix', () => {
    const r = route([
      { name: 'invoice.jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]) },
      { name: 'count sheet.PDF', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
      { name: 'old.xls', bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) },
    ]);
    expect(r.media.map((m) => [m.name, m.type])).toEqual([['invoice.jpg', 'image/jpeg'], ['count sheet.PDF', 'application/pdf']]);
    expect(r.errors[0]).toMatchObject({ name: 'old.xls', msg: expect.stringMatching(/Save As → .xlsx or CSV/) });
  });

  it('a table it can’t place is asked about, with its best guess', () => {
    const r = route([{ name: 'mystery.csv', text: 'Item,Notes\nSalmon,looks fine' }]);
    expect(r.unknown).toHaveLength(1);
    expect(r.unknown[0].guess).toBeTruthy();
    expect(r.unknown[0].missing.length).toBeGreaterThan(0);
  });

  it('Excel date serials become dates in date columns', () => {
    expect(excelDate(46321)).toBe('2026-10-26');
    const r = route([{ name: 'waste.xlsx', bytes: xlsx([{ name: 'Log', rows: [['Item', 'Qty', 'Reason', 'Date'], ['Salmon', 2, 'spoiled', 46321]] }]) }]);
    expect(r.manual[0].kind).toBe('waste');
    expect(r.manual[0].csv).toContain('2026-10-26');
  });

  it('refuses a file that is too large before reading it', () => {
    const r = readAny({ name: 'huge.csv', bytes: { length: 61 * 1024 * 1024 } });
    expect(r.errors[0].msg).toMatch(/Over 60 MB/);
  });
});
