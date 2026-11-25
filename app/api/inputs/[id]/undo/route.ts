// Undo one entry: only the one a room holds now, in one of the viewer's rooms.
import { after } from 'next/server';

import { thinkMise } from '../../../../../server/ai/mise';
import { getDb } from '../../../../../server/db/client';
import { scopedInputs, undoChecked } from '../../../../../server/page/inputs';
import { errorResponse, viewerFor } from '../../../../../server/session';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const { id } = await ctx.params;
    await undoChecked(db, v, id);
    // New data: Mise re-reads the group once the reply has gone, so saving stays fast.
    after(() => thinkMise(db, v.orgId).catch(() => null));
    return Response.json(await scopedInputs(db, v));
  } catch (err) {
    return errorResponse(err);
  }
}
