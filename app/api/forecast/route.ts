// Covercast for one room (GET ?room=&days=): covers and sales by day, week,
// service, hour and 15 minutes, with ranges, what each number rests on, and
// how accurate it has been on this room. Hand-entered signals go through
// /api/actions (`forecast.signals`).
import { getDb } from '../../../server/db/client';
import { loadForecast } from '../../../server/forecast';
import { errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const q = new URL(req.url).searchParams;
    const days = Math.max(1, Math.min(28, Number(q.get('days')) || 14));
    return Response.json(await loadForecast(db, v, q.get('room'), { days }));
  } catch (err) {
    return errorResponse(err);
  }
}
