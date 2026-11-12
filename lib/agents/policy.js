/**
 * What an agent may do. Every agent asks for effects; nothing it returns
 * happens until authorize() says yes. A refusal is logged, never silent.
 *
 * Permission levels (lowest first):
 *   read             read facts, emit events
 *   propose          + open proposals for a person, send notifications
 *   draft            + draft plans and package drafts (still a person's call)
 *   load             + pull data from sources the owner connected (Toast, linked sheets)
 *   act-within-fence + the one write a fence allows: lower a lever's autonomy after a breach
 *   rules            deterministic rules, not an agent (the verification decision)
 *
 * Pure JS: the server, the browser preview and the tests share it.
 */

export const LEVELS = ['read', 'propose', 'draft', 'load', 'act-within-fence', 'rules'];

/** The eleven things no agent may do, ever. Each forbidden effect type maps to one. */
export const NEVER = [
  { id: 'book', text: 'Book a saving that hasn’t passed every gate of the verification rules', effects: ['verdict.set', 'window.book', 'packet.edit'] },
  { id: 'mapping', text: 'Confirm a material account mapping without a named person', effects: ['mapping.confirm'] },
  { id: 'writeback', text: 'Change a price, schedule, par, permission or menu in Toast, 7shifts or any other system', effects: ['writeback', 'task.create'] },
  { id: 'window', text: 'Start or stop a test: only a person’s approval starts one', effects: ['window.start', 'window.stop'] },
  { id: 'autonomy', text: 'Raise any lever’s autonomy, anywhere', effects: ['autonomy.raise', 'fence.edit'] },
  { id: 'input', text: 'Type in, edit or undo a person’s data (loading from a source the owner connected is not typing it in)', effects: ['input.commit', 'input.undo'] },
  { id: 'rate', text: 'Move a verified rate or a closed packet', effects: ['rate.edit'] },
  { id: 'mail', text: 'Send email or messages outside the notification outbox, or to a sample guest', effects: ['email.send', 'sms.send'] },
  { id: 'secret', text: 'Read, log or return a secret or credential', effects: ['secret.read'] },
  { id: 'tenant', text: 'Read or act on another group’s data', effects: ['org.cross'] },
  { id: 'delete', text: 'Delete anything: data, audit records, tests, proposals a person decided', effects: ['delete'] },
];

const FORBIDDEN = Object.fromEntries(NEVER.flatMap((n) => n.effects.map((e) => [e, n])));

/** Allowed effect types and the permission levels (or the one agent) they need. */
const ALLOWED = {
  emit: { levels: LEVELS },
  note: { levels: LEVELS },
  propose: { levels: ['propose', 'draft', 'load', 'act-within-fence'] },
  notify: { levels: ['propose', 'draft', 'act-within-fence'] },
  snapshot: { agents: ['detection'] },
  'job.sync': { agents: ['ingestion'] },
  'job.links': { agents: ['ingestion'] },
  'job.proof': { agents: ['measurement'] },
  'job.reverify': { agents: ['guardrail'] },
  'job.verifyTasks': { agents: ['evidence'] },
  'job.billingDraft': { agents: ['periodClose'] },
  'autonomy.lower': { agents: ['guardrail'] },
};

/**
 * @param {{ id: string, permission: string }} agent
 * @param {{ type: string, orgId?: string, to?: number, from?: number }} effect
 * @param {{ orgId: string }} ctx
 * @returns {{ ok: true } | { ok: false, rule: string, why: string }}
 */
export function authorize(agent, effect, ctx) {
  const t = effect?.type;
  if (!t) return { ok: false, rule: 'shape', why: 'An effect with no type.' };
  if (effect.orgId && ctx?.orgId && effect.orgId !== ctx.orgId) return { ok: false, rule: 'tenant', why: FORBIDDEN['org.cross'].text };
  if (FORBIDDEN[t]) return { ok: false, rule: FORBIDDEN[t].id, why: FORBIDDEN[t].text };
  if (agent.permission === 'rules' && t !== 'emit' && t !== 'note') return { ok: false, rule: 'rules', why: 'The verification rules decide; they don’t act.' };
  const a = ALLOWED[t];
  if (!a) return { ok: false, rule: 'unknown', why: `“${t}” isn’t something any agent may do.` };
  if (a.agents && !a.agents.includes(agent.id)) return { ok: false, rule: 'scope', why: `Only ${a.agents.join(' / ')} may ${t}.` };
  if (a.levels && !a.levels.includes(agent.permission)) return { ok: false, rule: 'level', why: `${agent.id} is ${agent.permission}; ${t} needs ${a.levels.join(' or ')}.` };
  if (t === 'autonomy.lower' && !(Number.isInteger(effect.to) && Number.isInteger(effect.from) && effect.to < effect.from && effect.to >= 0)) {
    return { ok: false, rule: 'autonomy', why: FORBIDDEN['autonomy.raise'].text };
  }
  return { ok: true };
}

/** Plain-language label for a permission level. */
export const LEVEL_LABEL = { read: 'Reads', propose: 'Proposes', draft: 'Drafts', load: 'Loads data', 'act-within-fence': 'Acts within a fence', rules: 'Rules only' };
