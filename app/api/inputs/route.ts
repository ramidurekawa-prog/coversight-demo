// Save hand-entered rows (recipes, counts, invoices…) for one room and kind.
// The rows are checked again on the server with the screen's own rules.
import { after } from 'next/server';

import { thinkMise } from '../../../server/ai/mise';
import { getDb } from '../../../server/db/client';
import { commitChecked, scopedInputs } from '../../../server/page/inputs';
import { errorResponse, viewerFor } from '../../../server/session';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const result = await commitChecked(db, v, await req.json().catch(() => null));
    // New data: Mise re-reads the group once the reply has gone, so saving stays fast.
    after(() => thinkMise(db, v.orgId).catch(() => null));
    return Response.json({ ...result, ...(await scopedInputs(db, v)) });
  } catch (err) {
    return errorResponse(err);
  }
}
