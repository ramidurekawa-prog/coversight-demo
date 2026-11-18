// Service: approve tonight's one cut. Checked again here (tonight, one per
// night, inside the fences, still what the page showed), then a task on Today.
import { getDb } from '../../../../../server/db/client';
import { approveCut } from '../../../../../server/page/service';
import { errorResponse, viewerFor } from '../../../../../server/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });
    return Response.json(await approveCut(db, v, body));
  } catch (err) {
    return errorResponse(err);
  }
}
