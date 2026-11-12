// The activity feed on System: the org's audit log in plain words, newest first.
import { and, desc, eq } from 'drizzle-orm';

import type { Db } from './db/client';
import { auditLog, users } from './db/schema';
import type { Viewer } from './session';

const WORDS: Record<string, string> = {
  'input.committed': 'entered data', 'input.undone': 'undid an entry', 'input.reset': 'reset every hand-entered row',
  'window.started': 'started a test', 'window.stopped': 'stopped a test', 'window.verified': 'test verified', 'window.rejected': 'test not proven', 'window.reversed': 'verified result reversed',
  'task.created': 'approved a change', 'task.done': 'made an approved change', 'task.verified': 'change confirmed in Toast', 'task.mismatch': 'change not showing in Toast', 'task.reopen': 'reopened a task', 'task.cancel': 'cancelled a task',
  'invite.created': 'created an invite', 'invite.accepted': 'joined the group', 'invite.revoked': 'revoked an invite', 'member.updated': 'changed someone’s role', 'member.removed': 'removed someone',
  'org.created': 'created the group', 'org.exported': 'downloaded the group’s data', 'invoice.finalized': 'finalized an invoice', 'email.drafted': 'drafted an email',
};

export async function activity(db: Db, v: Pick<Viewer, 'orgId' | 'rooms'>, limit = 40) {
  const rows = await db.select({ action: auditLog.action, detail: auditLog.detail, at: auditLog.at, who: users.name, guest: users.isAnonymous })
    .from(auditLog).leftJoin(users, eq(users.id, auditLog.userId)).where(and(eq(auditLog.orgId, v.orgId))).orderBy(desc(auditLog.at)).limit(limit * 2);
  return rows
    .filter((r) => { const room = (r.detail as { roomId?: string })?.roomId; return !v.rooms || !room || v.rooms.includes(room); })
    .slice(0, limit)
    .map((r) => {
      const d = r.detail as { summary?: string; roomId?: string };
      const what = r.action.startsWith('action.') ? `decided: ${d.summary || r.action.slice(7)}` : WORDS[r.action] ?? r.action;
      return { at: r.at, who: r.who ? (r.guest ? 'You (guest)' : r.who) : 'Coversight', what, room: d.roomId || null };
    });
}
