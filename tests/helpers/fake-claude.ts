// A stand-in for the Claude API as the shared AI engine (server/ai/claude.ts)
// calls it: records each request and answers with the given JSON as the
// model's structured reply, or with an error status.
export function fakeClaude(reply: unknown | ((body: Record<string, any>) => unknown), status = 200) {
  const calls: { url: string; body: Record<string, any>; headers: Headers }[] = [];
  const f = (async (url: string | URL, init: { body: string; headers: HeadersInit }) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body, headers: new Headers(init.headers) });
    if (status !== 200) return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'no' } }), { status, headers: { 'content-type': 'application/json' } });
    const data = typeof reply === 'function' ? (reply as (b: Record<string, any>) => unknown)(body) : reply;
    return new Response(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
