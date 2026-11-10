// The System screen: job status for the signed-in org, and "Run now" for owners and admins.
import { getDb } from '../../../server/db/client';
import { JOBS, jobStatus, runJob, type JobName } from '../../../server/jobs';
import { AuthError, errorResponse, viewerFor } from '../../../server/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    return Response.json(await jobStatus(db, v.orgId, v.rooms));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const v = await viewerFor(req.headers, db);
    if (v.role === 'gm') throw new AuthError(403, 'Only an owner or admin can run jobs.');
    const { job } = ((await req.json().catch(() => ({}))) ?? {}) as { job?: string };
    if (!job || !(job in JOBS) || job === 'cleanup') return Response.json({ error: 'Pick detection, proof or reverify.' }, { status: 400 });
    const [result] = await runJob(db, job as JobName, { orgId: v.orgId, trigger: 'manual' });
    return Response.json({ result, status: await jobStatus(db, v.orgId, v.rooms) });
  } catch (err) {
    return errorResponse(err);
  }
}
