// Guided write-back tasks: list, or create one when a change is approved.
import { getDb } from '../../../server/db/client';
import { errorResponse, viewerFor } from '../../../server/session';
import { createTask, listTasks } from '../../../server/tasks';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json({ tasks: await listTasks(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const task = await createTask(db, v, await req.json().catch(() => null));
    return Response.json({ task, tasks: await listTasks(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}
