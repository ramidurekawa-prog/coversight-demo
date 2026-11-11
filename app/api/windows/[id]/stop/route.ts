import { getDb } from '../../../../../server/db/client';
import { listWindows, stopWindow } from '../../../../../server/proof';
import { errorResponse, viewerFor } from '../../../../../server/session';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    await stopWindow(db, v, id);
    return Response.json({ windows: await listWindows(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}
