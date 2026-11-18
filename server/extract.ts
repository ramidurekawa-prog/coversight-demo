// Lane 2, by photo: a picture or PDF of an invoice, a count sheet, a waste
// log or a delivery statement, read into rows by Claude through the shared AI engine (server/ai/claude.ts). The rows are never
// committed from here: they go back to the Data inputs screen to be checked,
// previewed and committed like any upload. Runs only with ANTHROPIC_API_KEY;
// the key is never logged or returned.
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { kindColumns } from '../lib/data/sniff.js';
import { aiConfigured, askClaude } from './ai/claude';
import type { Db } from './db/client';
import { auditLog, orgs } from './db/schema';
import { InputError } from './org';
import type { Viewer } from './session';

export const PHOTO_KINDS = ['invoices', 'counts', 'waste', 'recipes', 'channels', 'exceptions'] as const;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const;
/** Kept under the 4.5 MB request limit of a serverless function once base64'd; the browser shrinks photos first. */
const MAX = { image: 3 * 1024 * 1024, pdf: 3 * 1024 * 1024 };
/** Reads per group per day: a sample visitor gets a taste, a real group a working allowance. */
export const DAILY = { sample: 5, real: 300 };

export const extractConfigured = aiConfigured;

const body = z.object({
  name: z.string().max(300).default('photo'),
  type: z.enum(TYPES),
  data: z.string().min(10).max(Math.ceil((MAX.pdf * 4) / 3) + 8),
  kind: z.enum(PHOTO_KINDS).optional(),
});

const DESCRIBE: Record<(typeof PHOTO_KINDS)[number], string> = {
  invoices: 'a supplier invoice or delivery receipt: one row per line item',
  counts: 'an inventory count sheet: one row per counted item',
  waste: 'a waste or spoilage log: one row per entry',
  recipes: 'a menu or recipe-costing sheet: one row per dish',
  channels: 'a delivery-platform or sales-by-channel statement: one row per channel',
  exceptions: 'a register report of sales, voids, comps and discounts per employee: one row per person',
};

function prompt(kind?: string) {
  const kinds = PHOTO_KINDS.map((k) => `- "${k}": ${DESCRIBE[k]}. Columns: ${kindColumns(k).map((c: { k: string; label: string; required: boolean; options?: string[] }) => `${c.k} (${c.label}${c.required ? ', required' : ''}${c.options ? `; one of ${c.options.join(' / ')}` : ''})`).join(', ')}`).join('\n');
  return `You are reading a document a restaurant manager photographed or scanned so its figures can be loaded into their books.

${kind ? `It is ${DESCRIBE[kind as keyof typeof DESCRIBE]}. Use kind "${kind}".` : 'First decide which kind it is:'}
${kinds}

Rules:
- Copy values exactly as printed. Do not compute, estimate or fill in anything that isn't on the page; leave a cell empty instead.
- Numbers without currency symbols or thousands separators (1234.50, not $1,234.50).
- Skip subtotal, tax, delivery-fee and total lines; only item lines.
- If a value is unreadable, leave it empty and say so in notes.
Reply with the kind, the column keys you filled (in order), one array of cell values per row in that same order, and any notes.`;
}

/** The reply's shape: a small table (column keys, then rows of cells), so one schema fits every kind. */
const shape = (kind?: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'columns', 'rows', 'notes'],
  properties: {
    kind: { type: 'string', enum: kind ? [kind] : [...PHOTO_KINDS] },
    columns: { type: 'array', items: { type: 'string' }, description: 'The column keys for this kind, in the order the cells are given.' },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'One array of cell values per row, in the same order as columns. An empty string for a cell that is blank or unreadable.' },
    notes: { type: 'string', description: 'Anything unreadable or uncertain, in one or two short sentences. Empty if nothing.' },
  },
});

/** How many reads this group has used in the last 24 hours. */
async function usedToday(db: Db, orgId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, 'input.extracted'), gt(auditLog.at, new Date(Date.now() - 864e5))));
  return r?.n ?? 0;
}

export async function extractRows(db: Db, v: Pick<Viewer, 'orgId' | 'userId'>, raw: unknown, fetchImpl?: typeof fetch) {
  if (!aiConfigured()) throw new InputError('Reading photos needs ANTHROPIC_API_KEY on the server. Until it’s set, type the rows in or upload a spreadsheet.');
  const p = body.safeParse(raw);
  if (!p.success) throw new InputError(p.error.issues[0]?.path.join('.') === 'type' ? 'Send a JPEG, PNG, WebP or GIF photo, or a PDF.' : `Can’t read that upload: ${p.error.issues[0]?.message}`);
  const bytes = Math.floor((p.data.data.length * 3) / 4);
  const isPdf = p.data.type === 'application/pdf';
  if (bytes > (isPdf ? MAX.pdf : MAX.image)) throw new InputError(isPdf ? 'That PDF is over 3 MB. Send just the pages with the table.' : 'That photo is over 3 MB. Crop it to the table and try again.');
  const [org] = await db.select({ sample: orgs.sample }).from(orgs).where(eq(orgs.id, v.orgId));
  const limit = org?.sample ? DAILY.sample : DAILY.real;
  if ((await usedToday(db, v.orgId)) >= limit) throw new InputError(org?.sample ? `The sample group can read ${DAILY.sample} photos a day. Sign up to read more.` : `This group has read ${limit} documents in the last 24 hours. Try again tomorrow.`);

  const media = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data.data } }
    : { type: 'image', source: { type: 'base64', media_type: p.data.type, data: p.data.data } };
  const r = await askClaude<{ kind?: string; columns?: unknown; rows?: unknown; notes?: string }>({
    system: 'You read restaurant paperwork into rows for the restaurant to check before it is loaded. You copy what is printed and never fill a gap with a guess, because these rows become the figures the restaurant is run on.',
    schema: shape(p.data.kind),
    maxTokens: 16000,
    effort: 'medium',
    timeoutMs: 90_000,
    messages: [{ role: 'user', content: [media, { type: 'text', text: prompt(p.data.kind) }] as never }],
  }, fetchImpl);
  if (!r.ok) {
    if (r.reason === 'auth') throw new InputError('The server’s ANTHROPIC_API_KEY was refused. An admin needs to replace it.');
    if (r.reason === 'busy') throw new InputError('The reader is busy. Try again in a minute.');
    if (r.reason === 'unreachable') throw new InputError('Couldn’t reach the reader. Try again in a minute.');
    if (r.reason === 'unreadable' || r.reason === 'declined') throw new InputError('Nothing readable came back. Try a straighter, closer photo of just the table.');
    throw new InputError(`The reader answered ${r.status ?? 'with an error'}. Try again, or type the rows in.`);
  }
  const call = r.data;
  if (!Array.isArray(call.rows)) throw new InputError('Nothing readable came back. Try a straighter, closer photo of just the table.');
  const kind = (PHOTO_KINDS as readonly string[]).includes(String(call.kind)) ? (call.kind as (typeof PHOTO_KINDS)[number]) : p.data.kind;
  if (!kind) throw new InputError('Couldn’t tell what kind of document this is. Pick the kind and try again.');
  const cols = kindColumns(kind).map((c: { k: string }) => c.k);
  // Keep only this kind's columns, as plain strings: the screen validates them like any upload.
  const given = Array.isArray(call.columns) ? call.columns.map(String) : [];
  const rows = call.rows.filter((row): row is unknown[] => Array.isArray(row)).slice(0, 500)
    .map((row) => Object.fromEntries(cols.map((k: string) => { const i = given.indexOf(k); const cell = i < 0 ? null : row[i]; return [k, cell == null ? '' : String(cell).slice(0, 120)]; })))
    .filter((row) => Object.values(row).some((x) => x !== ''));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'input.extracted', detail: { kind, rows: rows.length, pdf: isPdf } });
  return { kind, rows, columns: cols, notes: String(call.notes ?? '').slice(0, 400), name: p.data.name };
}
