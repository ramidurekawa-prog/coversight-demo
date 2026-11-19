// Staff, on the server: the same staffPage() the screen draws, for a room the
// viewer can see, with names and rankings for owners, admins and GMs only
// (other roles get the team-level read without anyone's name). The coach
// (POST /api/page/staff/coach) asks Claude to talk the read through in plain
// words when ANTHROPIC_API_KEY is set; without it, it returns the same read in
// Coversight's own words. Either way the figures are the ones computed here,
// never the model's: it is given the evidence and told not to add numbers.
import { z } from 'zod';

import { anonymize, evidenceLines, staffPage } from '../../lib/data/page/staff.js';
import type { Db } from '../db/client';
import { loadDataset } from '../dataset';
import { InputError } from '../org';
import { AuthError, type Viewer } from '../session';

type V = Pick<Viewer, 'orgId' | 'rooms' | 'role'>;
// The page model is plain JS; its shape is checked by tests/page-staff.test.*.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
/** Who may see names and rankings. */
export const SEES_NAMES = (role: string) => role === 'owner' || role === 'admin' || role === 'gm';
export const COACH_MODEL = () => process.env.ANTHROPIC_STAFF_MODEL || 'claude-opus-5-5';

async function pageFor(db: Db, v: V, roomId: unknown): Promise<Page> {
  if (typeof roomId !== 'string' || !roomId) throw new InputError('room is required');
  if (v.rooms && !v.rooms.includes(roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const loaded = await loadDataset(db, v.orgId, v.rooms);
  if (!loaded?.ds.rooms[roomId]) throw new InputError(`no room '${roomId}' in this group`);
  return staffPage(loaded.ds, roomId);
}

export async function staffSummary(db: Db, v: V, roomId: unknown) {
  const page = await pageFor(db, v, roomId);
  return SEES_NAMES(v.role) ? { view: page, names: true } : { view: anonymize(page), names: false };
}

/** Strip per-person POS rows from a dataset before it reaches a role that may not see them. */
export function redactStaff<T extends { rooms?: Record<string, Record<string, unknown>> }>(base: T, inputs: Record<string, Record<string, unknown>> | undefined, role: string) {
  if (SEES_NAMES(role)) return { base, inputs };
  const rooms = Object.fromEntries(Object.entries(base.rooms || {}).map(([id, r]) => { const { staffShifts: _drop, ...rest } = r; void _drop; return [id, rest]; }));
  const ins = Object.fromEntries(Object.entries(inputs || {}).map(([id, kinds]) => {
    const t = kinds.toast as { rows?: { toast?: Record<string, unknown> }[] } | undefined;
    if (!t?.rows?.[0]?.toast?.staffShifts) return [id, kinds];
    const { staffShifts: _s, ...toast } = t.rows[0].toast; void _s;
    return [id, { ...kinds, toast: { ...t, rows: [{ ...t.rows[0], toast }, ...t.rows.slice(1)] } }];
  }));
  return { base: { ...base, rooms }, inputs: ins };
}

const coachBody = z.object({ room: z.string().min(1).max(60), person: z.string().regex(/^[\w-]{1,60}$/).nullable().optional(), question: z.string().trim().max(300).optional() });

/** The coach's answer: { text, by: 'claude' | 'coversight', model? }. */
export async function staffCoach(db: Db, v: V, raw: unknown, fetchImpl: typeof fetch = fetch) {
  if (!SEES_NAMES(v.role)) throw new AuthError(403, 'Only an owner, admin or GM can ask about people.');
  const b = coachBody.safeParse(raw);
  if (!b.success) throw new InputError('Send a room, and optionally a person and a question.');
  const page = await pageFor(db, v, b.data.room);
  if (!page) throw new InputError('no such room');
  const person = b.data.person ? page.people.find((p: { id: string }) => p.id === b.data.person) : null;
  if (b.data.person && !person) throw new InputError('That person isn’t on this room’s team.');
  const fallback = fallbackText(page, person);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { text: fallback, by: 'coversight' as const };
  const facts = person
    ? [...evidenceLines(person, page.period), `Coversight's read: ${person.read.title}. ${person.read.line}`, ...person.read.why, ...person.read.alt.map((a: string) => `Could also explain it: ${a}`)]
    : [`Team of ${page.sellers.length} who sell, ${page.period.label}.`, ...Object.entries(page.team.counts).map(([k, n]) => `${k}: ${n}`), ...page.team.missing.map((m: { line: string }) => `Might be missing: ${m.line}`), ...page.team.overCorrect.map((m: { line: string }) => `Might be over-correcting: ${m.line}`), page.team.action ? `Top action: ${page.team.action.title}. ${page.team.action.line}` : ''];
  let res: Response;
  try {
    res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: COACH_MODEL(),
        max_tokens: 500,
        system: COACH_SYSTEM,
        messages: [{ role: 'user', content: `Facts from the restaurant's POS (use only these numbers):\n${facts.filter(Boolean).map((f) => `- ${f}`).join('\n')}\n\nManager's question: ${b.data.question || (person ? `What should I do about ${person.name}?` : 'What should I focus on with my team this week?')}` }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { text: fallback, by: 'coversight' as const };
  }
  if (!res.ok) return { text: fallback, by: 'coversight' as const };
  const out = (await res.json().catch(() => null)) as { content?: { type: string; text?: string }[] } | null;
  const text = out?.content?.filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  if (!text || /\b(fire|terminate|let (him|her|them) go|dismiss)\b/i.test(text)) return { text: fallback, by: 'coversight' as const };
  return { text: text.slice(0, 1500), by: 'claude' as const, model: COACH_MODEL() };
}

export const COACH_SYSTEM = [
  'You are Team Coach, part of Coversight, talking to a restaurant owner or GM about their team.',
  'Talk like a calm, experienced restaurant consultant: short, plain, warm, three to five sentences, no lists, no jargon.',
  'Use only the numbers in the facts. Never invent a figure, a reason or a detail about the person.',
  'Never say or suggest to fire, terminate or discipline anyone. The strongest you go is "worth a private conversation", and you say what else could explain the number.',
  'Judge only job performance in the POS. Never mention or guess age, gender, health, family or anything personal.',
  'If the facts say too few shifts, say it is too early to tell.',
  'End with one concrete next step the manager can do this week.',
].join(' ');

function fallbackText(page: Page, person: Page) {
  if (person) {
    const r = person.read;
    const parts = [`${r.title}. ${r.line}`, ...r.why.slice(0, 2), ...(r.alt[0] ? [`Before acting: ${r.alt[0]}`] : [])];
    if (r.kind === 'early') parts.push('Look again after a few more weeks of shifts.');
    return parts.join(' ');
  }
  const a = page.team.action;
  const m = page.team.missing[0], o = page.team.overCorrect[0];
  return [a ? `This week: ${a.title.replace(/\.$/, "")}. ${a.line}` : 'Nothing urgent this week.', m ? `You might be missing: ${m.line}` : '', o ? `Don’t over-correct: ${o.line}` : ''].filter(Boolean).join(' ');
}
