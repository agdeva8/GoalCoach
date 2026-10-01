// Pins the end-to-end contract for the user's own Google OAuth access
// token reaching the Gemini API. The real chain is:
//
//   Google OAuth callback  ->  session.provider_token
//                          ->  auth/callback persists it to users.gemini_access_token
//                          ->  getValidGeminiToken() reads that row back
//                          ->  createGeminiClient() puts it in `Authorization: Bearer`
//
// The LLM client never reads `session.provider_token` directly — the DB row
// is the hand-off point. This file pins that hand-off: whatever token is
// persisted for the user is the token that goes out on the wire.
//
// Deliberately co-located with the system under test (packages/llm), not in
// apps/web/__tests__/env-gemini.test.ts (which is pure env validation).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGeminiClient } from '../src/client-gemini';
import { createLLMClient } from '../src/factory';
import { clearInFlightRefresh } from '../src/token-store';

const PERSISTED_TOKEN = 'ya29.test-token';

interface FakeRow {
  gemini_access_token: string | null;
  gemini_refresh_token: string | null;
  gemini_token_expiry: string | null;
}

function farFutureIso(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function nearFutureIso(): string {
  return new Date(Date.now() + 30 * 1000).toISOString();
}

// Mirrors the shape auth/callback writes and getValidGeminiToken reads:
// supabase.from('users').select(...).eq('id', userId).single()
function makeSupabase(row: FakeRow) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  const from = vi.fn().mockImplementation((t: string) => {
    if (t !== 'users') throw new Error(`unexpected table ${t}`);
    return { select, update };
  });
  return { client: { from } as any, from, select, eq, single, update, updateEq };
}

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

function sseText(text: string): Response {
  return sseResponse([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`]);
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

function authHeaderOf(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

describe('Gemini OAuth token flow: persisted token -> Authorization header', () => {
  beforeEach(() => {
    clearInFlightRefresh();
    vi.restoreAllMocks();
    process.env.GOOGLE_GEMINI_CLIENT_ID = 'client-id-test';
    process.env.GOOGLE_GEMINI_CLIENT_SECRET = 'client-secret-test';
  });

  afterEach(() => {
    clearInFlightRefresh();
    vi.restoreAllMocks();
  });

  it('sends the persisted access token as `Bearer <token>` to streamGenerateContent', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseText('hello'));

    // The row auth/callback would have written for this user.
    const { client: supabase } = makeSupabase({
      gemini_access_token: PERSISTED_TOKEN,
      gemini_refresh_token: null,
      gemini_token_expiry: farFutureIso(),
    });

    const client = createGeminiClient({
      provider: 'gemini',
      userId: 'u1',
      supabase,
    });

    await collect(client.send([{ role: 'user', content: 'hi' }], []));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(':streamGenerateContent?alt=sse');
    expect(authHeaderOf(init)).toBe(`Bearer ${PERSISTED_TOKEN}`);
  });

  it('carries the persisted token through createLLMClient(provider: "gemini")', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseText('hello'));

    const { client: supabase } = makeSupabase({
      gemini_access_token: PERSISTED_TOKEN,
      gemini_refresh_token: null,
      gemini_token_expiry: farFutureIso(),
    });

    // Factory dispatch: provider=gemini must reach the Gemini client, not
    // the Anthropic one. The bearer header is the observable proof.
    const client = createLLMClient({ provider: 'gemini', userId: 'u1', supabase });
    await collect(client.send([{ role: 'user', content: 'hi' }], []));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authHeaderOf(fetchMock.mock.calls[0][1])).toBe(`Bearer ${PERSISTED_TOKEN}`);
  });

  it('sends the refreshed access token (and persists it) when the stored token is near expiry', async () => {
    const REFRESHED = 'ya29.refreshed-token';
    const supabaseCalls = makeSupabase({
      gemini_access_token: 'ya29.stale-token',
      gemini_refresh_token: 'refresh-token',
      gemini_token_expiry: nearFutureIso(),
    });

    // Two outbound calls: first the Google token endpoint, then Gemini.
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: any) => {
        if (String(url) === 'https://oauth2.googleapis.com/token') {
          return new Response(
            JSON.stringify({ access_token: REFRESHED, expires_in: 3600 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return sseText('hello');
      });

    const client = createGeminiClient({
      provider: 'gemini',
      userId: 'u1',
      supabase: supabaseCalls.client,
    });
    await collect(client.send([{ role: 'user', content: 'hi' }], []));

    const geminiCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes('generativelanguage.googleapis.com')
    );
    expect(geminiCall).toBeDefined();
    expect(authHeaderOf(geminiCall![1])).toBe(`Bearer ${REFRESHED}`);

    // The refreshed token is written back, so the next request's cached
    // path sends the same token.
    expect(supabaseCalls.update).toHaveBeenCalledTimes(1);
    expect(supabaseCalls.update.mock.calls[0][0].gemini_access_token).toBe(REFRESHED);
    expect(supabaseCalls.updateEq).toHaveBeenCalledWith('id', 'u1');
  });

  it('makes no outbound request when no Gemini token is on file (fails closed)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const { client: supabase } = makeSupabase({
      gemini_access_token: null,
      gemini_refresh_token: null,
      gemini_token_expiry: null,
    });

    const client = createGeminiClient({
      provider: 'gemini',
      userId: 'u1',
      supabase,
    });

    const events = await collect(client.send([{ role: 'user', content: 'hi' }], []));

    expect(events).toEqual([{ type: 'error', message: 'Internal error' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
