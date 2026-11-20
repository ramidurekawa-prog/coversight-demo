// The one AI engine. Every AI feature in Coversight (Sous, the brief, photo
// reading, the crew's copilots) calls Claude through askClaude() and nowhere
// else, so the model, the key handling, the daily allowance and the failure
// words live in one place.
//
// It is a placeholder that switches on with a key: with no ANTHROPIC_API_KEY
// every caller gets { ok: false, reason: 'off' } and uses its built-in path,
// so the product works the same with the provider off or down. The key is
// read from the environment and never logged, returned or stored.
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import { auditLog, orgs } from '../db/schema';

/** The model every in-app AI call uses. */
export const AI_MODEL = 'claude-opus-5-5';

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

export type AiFailure = 'off' | 'auth' | 'busy' | 'unreachable' | 'declined' | 'unreadable' | 'error';
export type AiResult<T> = { ok: true; data: T } | { ok: false; reason: AiFailure; status?: number };

type AskRequest = {
  /** Who Claude is here and the rules it works under. Kept stable so it caches. */
  system: string;
  /** The turns so far, ending with the user's. */
  messages: Anthropic.Beta.BetaMessageParam[];
  /** The shape of the answer. Claude's reply is constrained to it. */
  schema: Record<string, unknown>;
  maxTokens?: number;
  /** How hard to think. Quick answers run at low; reading a document at medium. */
  effort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
};

/**
 * One question to Claude, answered as JSON in the given shape. Never throws:
 * a missing key, a refused key, a busy or unreachable provider and an
 * unreadable reply all come back as a reason the caller turns into its own
 * plain words or its built-in fallback.
 */
export async function askClaude<T>(req: AskRequest, fetchImpl?: typeof fetch): Promise<AiResult<T>> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, reason: 'off' };
  const client = new Anthropic({ apiKey: key, maxRetries: fetchImpl ? 0 : 1, timeout: req.timeoutMs ?? 45_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  try {
    const res = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: req.maxTokens ?? 4000,
      // If the model declines a request on policy grounds, the API retries it on its default fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: req.effort ?? 'low', format: { type: 'json_schema', schema: req.schema } },
      messages: req.messages,
    });
    if (res.stop_reason === 'refusal') return { ok: false, reason: 'declined' };
    const text = res.content.find((b) => b.type === 'text')?.text;
    if (!text || res.stop_reason === 'max_tokens') return { ok: false, reason: 'unreadable' };
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return { ok: false, reason: 'auth', status: err.status };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: 'busy', status: 429 };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, reason: 'unreachable' };
    if (err instanceof Anthropic.APIError) return { ok: false, reason: err.status === 529 ? 'busy' : 'error', status: err.status };
    return { ok: false, reason: 'error' };
  }
}

/** AI calls a group may make in 24 hours, by feature. A sample visitor gets a taste, a real group a working allowance. */
export const AI_DAILY = {
  ask: { sample: 20, real: 500, actions: ['sous.ask', 'agents.ask'] },
  brief: { sample: 12, real: 200, actions: ['sous.brief'] },
} as const;

/** True while this group still has allowance for the feature today. Counted from the audit log, so it needs no table of its own. */
export async function aiAllowance(db: Db, orgId: string, feature: keyof typeof AI_DAILY) {
  const spec = AI_DAILY[feature];
  const [org] = await db.select({ sample: orgs.sample }).from(orgs).where(eq(orgs.id, orgId));
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog)
    .where(and(eq(auditLog.orgId, orgId), inArray(auditLog.action, [...spec.actions]), gt(auditLog.at, new Date(Date.now() - 864e5)), sql`${auditLog.detail}->>'engine' = 'ai'`));
  return (used?.n ?? 0) < (org?.sample ? spec.sample : spec.real);
}
