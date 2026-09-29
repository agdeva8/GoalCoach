import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGeminiClient } from '../src/client-gemini';

function makeReadableStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

function sseResponse(chunks: string[]): Response {
  const bytes = chunks.map((c) => new TextEncoder().encode(c));
  return new Response(makeReadableStream(bytes), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe('createGeminiClient', () => {
  beforeEach(() => {
    process.env.GOOGLE_GEMINI_CLIENT_ID = 'cid';
    process.env.GOOGLE_GEMINI_CLIENT_SECRET = 'csec';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    vi.restoreAllMocks();
  });

  it('emits text events from a streamed Gemini response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"hello "}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"world"}]}}]}\n\n',
      ])
    );

    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  gemini_access_token: 'cached-token',
                  gemini_refresh_token: 'refresh-token',
                  gemini_token_expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
                },
                error: null,
              }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    };

    const client = createGeminiClient({
      provider: 'gemini',
      userId: 'u1',
      supabase,
    });

    const events = await collect(client.send([{ role: 'user', content: 'hi' }], []));
    expect(events).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
      { type: 'done' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT emit tool_use events in Phase 1 (tools are prompt instructions only)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"plain answer"}]}}]}\n\n',
      ])
    );

    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  gemini_access_token: 'cached-token',
                  gemini_refresh_token: 'refresh-token',
                  gemini_token_expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
                },
                error: null,
              }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    };

    const client = createGeminiClient({
      provider: 'gemini',
      userId: 'u1',
      supabase,
    });

    const events = await collect(
      client.send(
        [{ role: 'user', content: 'hi' }],
        [
          {
            name: 'list_goals',
            description: 'list goals',
            input_schema: { type: 'object' },
          },
        ]
      )
    );

    // No tool_use events. Only text + done.
    expect(events.some((e) => e.type === 'tool_use')).toBe(false);
  });

  it('converts tools to a systemInstruction prompt section', async () => {
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init!.body as string);
      return sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n',
      ]);
    });

    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  gemini_access_token: 'cached-token',
                  gemini_refresh_token: 'rt',
                  gemini_token_expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
                },
                error: null,
              }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    };

    const client = createGeminiClient({
      provider: 'gemini',
      userId: 'u1',
      supabase,
    });

    await collect(
      client.send(
        [{ role: 'user', content: 'hi' }],
        [
          {
            name: 'list_goals',
            description: 'list my goals',
            input_schema: { type: 'object' },
          },
        ]
      )
    );

    const systemText = JSON.stringify(capturedBody.systemInstruction);
    expect(systemText).toMatch(/list_goals/);
    expect(systemText).toMatch(/list my goals/);
  });

  it('parses multiple JSON objects in a single data: line', async () => {
    // Gemini sometimes packs multiple chunks into one data: line separated
    // by commas (rare but documented). The parser splits on `},{`.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]},{"candidates":[{"content":{"parts":[{"text":"b"}]}}]}\n\n',
      ])
    );

    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  gemini_access_token: 'cached-token',
                  gemini_refresh_token: 'rt',
                  gemini_token_expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
                },
                error: null,
              }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    };

    const client = createGeminiClient({
      provider: 'gemini',
      userId: 'u1',
      supabase,
    });

    const events = await collect(client.send([{ role: 'user', content: 'hi' }], []));
    const texts = events.filter((e) => e.type === 'text').map((e) => (e as any).text);
    expect(texts).toEqual(['a', 'b']);
  });

  it('reassembles mid-UTF-8 chunk boundaries', async () => {
    // The byte 'é' (0xC3 0xA9) split across two chunks. Decoder must
    // recover correctly thanks to stream: true.
    const part1 = new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"caf');
    const part2 = new TextEncoder().encode('é"}]}}]}\n\n');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(makeReadableStream([part1, part2]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  gemini_access_token: 'cached-token',
                  gemini_refresh_token: 'rt',
                  gemini_token_expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
                },
                error: null,
              }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    };

    const client = createGeminiClient({
      provider: 'gemini',
      userId: 'u1',
      supabase,
    });

    const events = await collect(client.send([{ role: 'user', content: 'hi' }], []));
    const text = events.find((e) => e.type === 'text') as any;
    expect(text.text).toBe('café');
  });

  it('emits an error event when fetch returns non-2xx with JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad request' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  gemini_access_token: 'cached-token',
                  gemini_refresh_token: 'rt',
                  gemini_token_expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
                },
                error: null,
              }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    };

    const client = createGeminiClient({
      provider: 'gemini',
      userId: 'u1',
      supabase,
    });

    const events = await collect(client.send([{ role: 'user', content: 'hi' }], []));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error' });
    expect((events[0] as any).message).toBe('Internal error');
  });

  it('falls back when token refresh fails: emits error event (caller decides what to do)', async () => {
    // Refresh fails because the user has no refresh token but the cached
    // access token is near expiry. Token-store throws, the client emits
    // an error event.
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  gemini_access_token: 'near-expiry-token',
                  gemini_refresh_token: null,
                  gemini_token_expiry: new Date(Date.now() + 30 * 1000).toISOString(),
                },
                error: null,
              }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    };

    const client = createGeminiClient({
      provider: 'gemini',
      userId: 'u1',
      supabase,
    });

    const events = await collect(client.send([{ role: 'user', content: 'hi' }], []));
    expect(events[0]).toMatchObject({ type: 'error' });
    expect((events[0] as any).message).toBe('Internal error');
  });
});
