// Everything the group owns, as a JSON download (owner only).
import { getDb } from '../../../server/db/client';
import { errorResponse, viewerFor } from '../../../server/session';
import { exportOrg } from '../../../server/team';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const data = await exportOrg(db, v);
    const name = `coversight-export-${data.org.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${data.exportedAt.slice(0, 10)}.json`;
    return new Response(JSON.stringify(data, null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
