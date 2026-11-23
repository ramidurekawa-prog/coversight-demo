// All rooms: the viewer's portfolio view, computed on the server the same way the page does.
import { getDb } from '../../../../server/db/client';
import { portfolioFor } from '../../../../server/page/portfolio';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

const PERIODS = new Set(['week', '4w']);
const COMPARISONS = new Set(['own', 'ly', 'budget']);

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const q = new URL(req.url).searchParams;
    const period = q.get('period') ?? 'week', comparison = q.get('comparison') ?? 'own';
    if (!PERIODS.has(period) || !COMPARISONS.has(comparison)) return Response.json({ error: 'period must be week or 4w; comparison own, ly or budget.' }, { status: 400 });
    const got = await portfolioFor(db, v, { period: period as 'week' | '4w', comparison: comparison as 'own' | 'ly' | 'budget' });
    if (!got) return Response.json({ error: 'Organization not found.' }, { status: 404 });
    return Response.json(got);
  } catch (err) {
    return errorResponse(err);
  }
}
