// Linked sheets: list them, or keep a new one linked (read once now, then every morning).
import { getDb } from '../../../../server/db/client';
import { addLink, listLinks, pullLinks } from '../../../../server/links';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json({ links: await listLinks(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const row = await addLink(db, v, await req.json().catch(() => null));
    const pulled = await pullLinks(db, v.orgId, { only: row.id });
    return Response.json({ id: row.id, pulled, links: await listLinks(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}
