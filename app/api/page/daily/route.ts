// Daily detail for one room: GET the days (synced days are summarised on the
// way), POST days parsed from dropped Toast exports, DELETE those uploads.
import { getDb } from '../../../../server/db/client';
import { loadDaily, removeUploadedDays, saveUploadedDays } from '../../../../server/page/daily';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await loadDaily(db, v, new URL(req.url).searchParams.get('room')));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await saveUploadedDays(db, v, await req.json().catch(() => null)));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await removeUploadedDays(db, v, new URL(req.url).searchParams.get('room')));
  } catch (err) {
    return errorResponse(err);
  }
}
