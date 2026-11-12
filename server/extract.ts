// Lane 2, by photo: a picture or PDF of an invoice, a count sheet, a waste
// log or a delivery statement, read into rows by Claude. The rows are never
// committed from here: they go back to the Data inputs screen to be checked,
// previewed and committed like any upload. Runs only with ANTHROPIC_API_KEY;
// the key is never logged or returned.
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { kindColumns } from '../lib/data/sniff.js';
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

export const extractConfigured = () => !!process.env.ANTHROPIC_API_KEY;

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
Record the result with the record_rows tool.`;
}

const tool = (kind?: string) => ({
  name: 'record_rows',
  description: 'Record the rows read from the document.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: kind ? [kind] : [...PHOTO_KINDS] },
      rows: { type: 'array', maxItems: 500, items: { type: 'object', additionalProperties: { type: ['string', 'number', 'null'] } } },
      notes: { type: 'string', description: 'Anything unreadable or uncertain, in one or two short sentences.' },
    },
    required: ['kind', 'rows'],
  },
});

/** How many reads this group has used in the last 24 hours. */
async function usedToday(db: Db, orgId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, 'input.extracted'), gt(auditLog.at, new Date(Date.now() - 864e5))));
  return r?.n ?? 0;
}

export async function extractRows(db: Db, v: Pick<Viewer, 'orgId' | 'userId'>, raw: unknown, fetchImpl: typeof fetch = fetch) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new InputError('Reading photos needs ANTHROPIC_API_KEY on the server. Until it’s set, type the rows in or upload a spreadsheet.');
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
  let res: Response;
  try {
    res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 8000,
        tools: [tool(p.data.kind)],
        tool_choice: { type: 'tool', name: 'record_rows' },
        messages: [{ role: 'user', content: [media, { type: 'text', text: prompt(p.data.kind) }] }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new InputError('Couldn’t reach the reader. Try again in a minute.');
  }
  if (res.status === 401 || res.status === 403) throw new InputError('The server’s ANTHROPIC_API_KEY was refused. An admin needs to replace it.');
  if (res.status === 429 || res.status === 529) throw new InputError('The reader is busy. Try again in a minute.');
  if (!res.ok) throw new InputError(`The reader answered ${res.status}. Try again, or type the rows in.`);
  const out = (await res.json().catch(() => null)) as { content?: { type: string; name?: string; input?: { kind?: string; rows?: unknown[]; notes?: string } }[] } | null;
  const call = out?.content?.find((c) => c.type === 'tool_use' && c.name === 'record_rows')?.input;
  if (!call || !Array.isArray(call.rows)) throw new InputError('Nothing readable came back. Try a straighter, closer photo of just the table.');
  const kind = (PHOTO_KINDS as readonly string[]).includes(String(call.kind)) ? (call.kind as (typeof PHOTO_KINDS)[number]) : p.data.kind;
  if (!kind) throw new InputError('Couldn’t tell what kind of document this is. Pick the kind and try again.');
  const cols = kindColumns(kind).map((c: { k: string }) => c.k);
  // Keep only this kind's columns, as plain strings: the screen validates them like any upload.
  const rows = call.rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r)).slice(0, 500)
    .map((r) => Object.fromEntries(cols.map((k: string) => [k, r[k] == null ? '' : String(r[k]).slice(0, 120)])))
    .filter((r) => Object.values(r).some((x) => x !== ''));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'input.extracted', detail: { kind, rows: rows.length, pdf: isPdf } });
  return { kind, rows, columns: cols, notes: String(call.notes ?? '').slice(0, 400), name: p.data.name };
}
