import { strToU8, zipSync } from 'fflate';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../server/db/client';
import { auditLog, inputs, linkedSources, notifications, orgs, users } from '../server/db/schema';
import { DAILY, extractRows } from '../server/extract';
import { runJob } from '../server/jobs';
import { addLink, directUrl, fetchLink, listLinks, pullLinks, removeLink } from '../server/links';
import { createSampleOrg } from '../server/org';
import { freshDb } from './helpers/db';

/** A one-sheet .xlsx with inline strings. */
function book(sheets: { name: string; rows: (string | number)[][] }[]) {
  const col = (i: number) => String.fromCharCode(65 + i);
  const f: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(`<workbook xmlns:r="r"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`),
  };
  sheets.forEach((s, i) => {
    f[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<worksheet><sheetData>${s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${v}</t></is></c>`)).join('')}</row>`).join('')}</sheetData></worksheet>`);
  });
  return zipSync(f);
}

const SHEET = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK_lmnop/edit#gid=0';
/** Google: export → 307 to googleusercontent → the workbook. `rows` decides what the sheet holds today. */
function fakeGoogle(get: () => Uint8Array, { shared = true } = {}) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname === 'docs.google.com') return new Response(null, { status: 307, headers: { location: 'https://doc-0k-sheets.googleusercontent.com/export/abc?format=xlsx' } });
    if (u.hostname.endsWith('googleusercontent.com')) return shared
      ? new Response(get() as unknown as BodyInit, { status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="Rosewood back office.xlsx"' } })
      : new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response('no', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values({ id: 'u1', name: 'O', email: 'o@example.com' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});
afterEach(() => { delete process.env.ANTHROPIC_API_KEY; });

describe('links', () => {
  it('turns share links into file URLs and refuses everything else', () => {
    expect(directUrl(SHEET).url).toBe('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK_lmnop/export?format=xlsx');
    expect(directUrl('https://docs.google.com/spreadsheets/d/e/2PACX-1vQ/pubhtml').url).toBe('https://docs.google.com/spreadsheets/d/e/2PACX-1vQ/pub?output=xlsx');
    expect(directUrl('https://www.dropbox.com/scl/fi/abc/counts.xlsx?rlkey=x&dl=0').url).toBe('https://www.dropbox.com/scl/fi/abc/counts.xlsx?rlkey=x&dl=1');
    expect(() => directUrl('https://evil.example.com/x.csv')).toThrow(/Google Sheets or Dropbox/);
    expect(() => directUrl('http://docs.google.com/spreadsheets/d/x')).toThrow(/https/);
    expect(() => directUrl('https://docs.google.com/document/d/x')).toThrow(/Only Google Sheets/);
  });

  it('follows the Google redirect, but never off Google or Dropbox; an unshared sheet says how to share it', async () => {
    const g = fakeGoogle(() => book([{ name: 'Counts', rows: [['Item', 'On hand'], ['Salmon', 14]] }]));
    const f = await fetchLink(SHEET, g.f);
    expect(f.name).toBe('Rosewood back office.xlsx');
    expect(g.calls).toHaveLength(2);
    const evil = (async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } })) as unknown as typeof fetch;
    await expect(fetchLink(SHEET, evil)).rejects.toThrow(/redirected somewhere/);
    await expect(fetchLink(SHEET, fakeGoogle(() => new Uint8Array(), { shared: false }).f)).rejects.toThrow(/Anyone with the link/);
  });

  it('a linked sheet is read now and every morning; only passing, changed tabs are committed', async () => {
    let onHand = 14;
    const g = fakeGoogle(() => book([
      { name: 'Counts', rows: [['Walk-in count'], ['Item', 'On hand', 'Unit'], ['Salmon fillet', onHand, 'lb'], ['Ribeye, choice', 48, 'lb']] },
      { name: 'Invoices', rows: [['Product', 'Supplier', 'Unit price', 'Cases'], ['Salmon', 'Pacific Seafood', 11.25, 40]] },
    ]));
    const row = await addLink(db, owner(), { url: SHEET, roomId: 'oakland', picks: [{ source: 'Google Sheet.xlsx · Counts', kind: 'counts' }, { source: 'Google Sheet.xlsx · Invoices', kind: 'invoices' }] });
    const r1 = await pullLinks(db, orgId, { fetchImpl: g.f });
    expect(r1.results![row.id]).toMatchObject({ committed: ['Google Sheet.xlsx · Counts', 'Google Sheet.xlsx · Invoices'], failed: [] });
    const counts = () => db.select().from(inputs).where(and(eq(inputs.orgId, orgId), eq(inputs.kind, 'counts')));
    expect((await counts())[0]!.summary).toBe('Linked sheet · Counts · 2 rows');

    // Nothing changed overnight: nothing re-committed.
    const r2 = await pullLinks(db, orgId, { fetchImpl: g.f });
    expect(r2.results![row.id]!.unchanged).toHaveLength(2);
    expect(await counts()).toHaveLength(1);

    // The count changed: just that tab is committed again.
    onHand = 11;
    await runJob(db, 'links', { fetchImpl: g.f });
    expect(await counts()).toHaveLength(2);

    // A bad edit (text in a number column) is refused, flagged, and the owner is told.
    onHand = 'lots' as unknown as number;
    const r4 = await pullLinks(db, orgId, { fetchImpl: g.f });
    expect(r4.results![row.id]!.failed[0]!.why).toMatch(/error.*isn't a number/);
    expect(await counts()).toHaveLength(2);
    const [link] = await db.select().from(linkedSources).where(eq(linkedSources.id, row.id));
    expect(link!.lastError).toMatch(/Counts/);
    expect((await db.select().from(notifications).where(eq(notifications.orgId, orgId))).some((n) => n.title === 'A linked sheet couldn’t be read')).toBe(true);
  });

  it('only rooms you can see; Toast never comes in as a linked sheet; unlinking stops it', async () => {
    const gm = { ...owner(), role: 'gm' as const, rooms: ['berkeley'] };
    await expect(addLink(db, gm, { url: SHEET, roomId: 'oakland', picks: [{ source: 'x', kind: 'counts' }] })).rejects.toThrow(/not one of yours/);
    await expect(addLink(db, owner(), { url: SHEET, roomId: 'oakland', picks: [{ source: 'x', kind: 'toast' }] })).rejects.toThrow(/Connect/);
    await expect(addLink(db, owner(), { url: 'https://example.com/x', roomId: 'oakland', picks: [{ source: 'x', kind: 'counts' }] })).rejects.toThrow(/Google Sheets or Dropbox/);
    const row = await addLink(db, owner(), { url: SHEET, roomId: 'berkeley', picks: [{ source: 'x · Counts', kind: 'counts' }] });
    expect(await listLinks(db, orgId, ['oakland'])).toHaveLength(0);
    await removeLink(db, gm, row.id);
    expect(await listLinks(db, orgId)).toHaveLength(0);
  });
});

describe('photos and PDFs', () => {
  const photo = { name: 'invoice.jpg', type: 'image/jpeg', data: Buffer.from('fake-jpeg-bytes-here').toString('base64') };
  const fakeClaude = (input: unknown, status = 200) => {
    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    const f = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return new Response(JSON.stringify(status === 200 ? { content: [{ type: 'tool_use', name: 'record_rows', input }] } : { error: {} }), { status });
    }) as unknown as typeof fetch;
    return { f, calls };
  };

  it('needs ANTHROPIC_API_KEY, and says so plainly', async () => {
    await expect(extractRows(db, owner(), photo, fakeClaude({}).f)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('reads rows for review: only the kind’s columns, as text, never committed', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const c = fakeClaude({ kind: 'invoices', rows: [{ item: 'Salmon fillet', vendor: 'Pacific Seafood', unit: 'lb', unit_price: 11.25, qty: 40, extra: 'dropped' }, { item: '', unit_price: null }], notes: 'Line 3 smudged.' });
    const out = await extractRows(db, owner(), photo, c.f);
    expect(out).toMatchObject({ kind: 'invoices', notes: 'Line 3 smudged.', rows: [{ item: 'Salmon fillet', vendor: 'Pacific Seafood', unit: 'lb', unit_price: '11.25', qty: '40' }] });
    expect(out.rows[0]).not.toHaveProperty('extra');
    expect(c.calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(c.calls[0]!.headers['x-api-key']).toBe('sk-test-key');
    const content = (c.calls[0]!.body.messages as { content: { type: string }[] }[])[0]!.content;
    expect(content[0]!.type).toBe('image');
    expect(await db.select().from(inputs).where(eq(inputs.orgId, orgId))).toHaveLength(0);
    // The key never lands in the audit log.
    expect(JSON.stringify(await db.select().from(auditLog))).not.toContain('sk-test-key');
  });

  it('a PDF goes as a document; a refused key and wrong types fail in plain words', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const c = fakeClaude({ kind: 'counts', rows: [{ item: 'Salmon', close: 14 }] });
    await extractRows(db, owner(), { ...photo, name: 'count.pdf', type: 'application/pdf', kind: 'counts' }, c.f);
    expect((c.calls[0]!.body.messages as { content: { type: string }[] }[])[0]!.content[0]!.type).toBe('document');
    expect((c.calls[0]!.body.tool_choice as { name: string }).name).toBe('record_rows');
    await expect(extractRows(db, owner(), photo, fakeClaude({}, 401).f)).rejects.toThrow(/was refused/);
    await expect(extractRows(db, owner(), { ...photo, type: 'image/heic' }, c.f)).rejects.toThrow(/JPEG, PNG/);
  });

  it('a sample group gets a few reads a day', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    expect((await db.select().from(orgs).where(eq(orgs.id, orgId)))[0]!.sample).toBe(true);
    const c = fakeClaude({ kind: 'waste', rows: [{ item: 'Salmon', qty: 2, reason: 'spoiled' }] });
    for (let i = 0; i < DAILY.sample; i++) await extractRows(db, owner(), photo, c.f);
    await expect(extractRows(db, owner(), photo, c.f)).rejects.toThrow(/photos a day/);
  });
});
