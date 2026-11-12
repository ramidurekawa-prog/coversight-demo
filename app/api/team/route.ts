// The Team screen: people and open invites.
import { getDb } from '../../../server/db/client';
import { errorResponse, viewerFor } from '../../../server/session';
import { listMembers } from '../../../server/team';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json({ ...(await listMembers(db, v)), role: v.role });
  } catch (err) {
    return errorResponse(err);
  }
}
