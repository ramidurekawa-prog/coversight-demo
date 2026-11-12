// Fetch a Google Sheets or Dropbox share link once, for review on the Data inputs screen.
import { getDb } from '../../../../server/db/client';
import { route } from '../../../../lib/data/sniff.js';
import { fetchLink } from '../../../../server/links';
import { errorResponse, viewerFor } from '../../../../server/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    await viewerFor(req.headers, getDb());
    const { url } = ((await req.json().catch(() => ({}))) ?? {}) as { url?: string };
    const f = await fetchLink(String(url ?? ''));
    // Recognised here, so only tables (not the raw file) go back to the browser.
    const r = route([{ name: f.name, bytes: f.bytes, type: f.type }]);
    const out = JSON.stringify({ name: f.name, ...r, media: r.media.map(({ bytes: _b, ...m }) => m) });
    if (out.length > 4_000_000) return Response.json({ error: 'That file is too big to review in the browser. Download it and drop it on Data inputs instead.' }, { status: 413 });
    return new Response(out, { headers: { 'content-type': 'application/json' } });
  } catch (err) {
    return errorResponse(err);
  }
}
