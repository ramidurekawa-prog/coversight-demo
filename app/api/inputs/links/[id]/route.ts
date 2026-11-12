// One linked sheet: read it again now (POST), or unlink it (DELETE).
import { getDb } from '../../../../../server/db/client';
import { listLinks, pullLinks, removeLink } from '../../../../../server/links';
import { AuthError, errorResponse, viewerFor } from '../../../../../server/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const { id } = await ctx.params;
    const mine = (await listLinks(db, v.orgId, v.rooms)).find((l) => l.id === id);
    if (!mine) throw new AuthError(403, 'That link is not one of yours.');
    const pulled = await pullLinks(db, v.orgId, { only: id });
    return Response.json({ pulled, links: await listLinks(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const { id } = await ctx.params;
    await removeLink(db, v, id);
    return Response.json({ links: await listLinks(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}
