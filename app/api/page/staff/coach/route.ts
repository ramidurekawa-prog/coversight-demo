// Team Coach: POST /api/page/staff/coach { room, person?, question? } → { text, by }.
// Claude talks the computed read through when ANTHROPIC_API_KEY is set; otherwise Coversight's own words.
import { getDb } from '../../../../../server/db/client';
import { staffCoach } from '../../../../../server/page/staff';
import { errorResponse, viewerFor } from '../../../../../server/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await staffCoach(db, v, await req.json().catch(() => null)));
  } catch (err) {
    return errorResponse(err);
  }
}
