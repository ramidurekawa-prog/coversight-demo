// Service: tonight live from Toast for one room (paced against recent weeks).
import { getDb } from '../../../../server/db/client';
import { liveService } from '../../../../server/page/service';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const roomId = new URL(req.url).searchParams.get('roomId');
    return Response.json(await liveService(db, v, roomId));
  } catch (err) {
    return errorResponse(err);
  }
}
