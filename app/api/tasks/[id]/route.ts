// Tick a task off, reopen it, or cancel it.
import { getDb } from '../../../../server/db/client';
import { errorResponse, viewerFor } from '../../../../server/session';
import { listTasks, updateTask } from '../../../../server/tasks';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const { action } = ((await req.json().catch(() => ({}))) ?? {}) as { action?: unknown };
    const task = await updateTask(db, v, id, action);
    return Response.json({ task, tasks: await listTasks(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}
