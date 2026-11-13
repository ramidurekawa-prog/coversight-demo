// The weekly meeting for one room: the live meeting, the record and the actions
// (GET ?room=), and every change to them (POST { op }). The room's slot goes
// through /api/actions (`meeting.schedule`).
import { getDb } from '../../../../server/db/client';
import { ConflictError, discardMeeting, finalizeMeeting, loadMeeting, saveMeeting, startMeeting, updateAction } from '../../../../server/page/meeting';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

function fail(err: unknown) {
  if (err instanceof ConflictError) return Response.json({ error: err.message, detail: err.detail }, { status: 409 });
  return errorResponse(err);
}

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await loadMeeting(db, v, new URL(req.url).searchParams.get('room')));
  } catch (err) {
    return fail(err);
  }
}

const OPS = { start: startMeeting, save: saveMeeting, finalize: finalizeMeeting, discard: discardMeeting, action: updateAction } as const;

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    const body = (await req.json().catch(() => null)) as ({ op?: string } & Record<string, unknown>) | null;
    if (!body || typeof body.op !== 'string' || !(body.op in OPS)) return Response.json({ error: 'Unknown meeting operation.' }, { status: 400 });
    return Response.json(await OPS[body.op as keyof typeof OPS](db, v, body as never));
  } catch (err) {
    return fail(err);
  }
}
