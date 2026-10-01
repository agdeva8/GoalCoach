import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getValidGeminiToken,
  clearInFlightRefresh,
  TokenError,
} from '../src/token-store';

// Tests cover the contract per plan task 7:
// - cache hit: returns the existing access token when not near expiry
// - refresh on near-expiry: posts to oauth2.googleapis.com/token
// - throws on no token present
// - throws when refresh_token is null
// - throws on non-2xx fetch
// - in-flight coalescing: 5 concurrent calls → 1 fetch

interface FakeRow {
  gemini_access_token: string | null;
  gemini_refresh_token: string | null;
  gemini_token_expiry: string | null;
}

function makeSupabase(row: FakeRow) {
  const from = vi.fn().mockImplementation((table: string) => {
    if (table !== 'users') throw new Error(`unexpected table ${table}`);
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    };
  });
  return { from } as any;
}

describe('getValidGeminiToken', () => {
  beforeEach(() => {
    clearInFlightRefresh();
    vi.restoreAllMocks();
    process.env.GOOGLE_GEMINI_CLIENT_ID = 'client-id-test';
    process.env.GOOGLE_GEMINI_CLIENT_SECRET = 'client-secret-test';
  });

  it('returns the cached access token when expiry is far enough away', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h
    const supabase = makeSupabase({
      gemini_access_token: 'cached-token',
      gemini_refresh_token: 'refresh-token',
      gemini_token_expiry: farFuture,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const token = await getValidGeminiToken(supabase, 'u1');
    expect(token).toBe('cached-token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refreshes when expiry is within 60s', async () => {
    const nearFuture = new Date(Date.now() + 30 * 1000).toISOString(); // 30s away
    const supabase = makeSupabase({
      gemini_access_token: 'old-token',
      gemini_refresh_token: 'refresh-token',
      gemini_token_expiry: nearFuture,
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'new-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const token = await getValidGeminiToken(supabase, 'u1');
    expect(token).toBe('new-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
  });

  it('throws TokenError when no access token is present', async () => {
    const supabase = makeSupabase({
      gemini_access_token: null,
      gemini_refresh_token: 'refresh-token',
      gemini_token_expiry: null,
    });

    await expect(getValidGeminiToken(supabase, 'u1')).rejects.toBeInstanceOf(TokenError);
    await expect(getValidGeminiToken(supabase, 'u1')).rejects.toThrow(/no_gemini_token/);
  });

  it('throws TokenError when refresh_token is null and refresh is needed', async () => {
    const nearFuture = new Date(Date.now() + 30 * 1000).toISOString();
    const supabase = makeSupabase({
      gemini_access_token: 'old-token',
      gemini_refresh_token: null,
      gemini_token_expiry: nearFuture,
    });

    await expect(getValidGeminiToken(supabase, 'u1')).rejects.toBeInstanceOf(TokenError);
    await expect(getValidGeminiToken(supabase, 'u1')).rejects.toThrow(/no_refresh_token/);
  });

  it('throws TokenError when refresh fetch returns non-2xx', async () => {
    const nearFuture = new Date(Date.now() + 30 * 1000).toISOString();
    const supabase = makeSupabase({
      gemini_access_token: 'old-token',
      gemini_refresh_token: 'refresh-token',
      gemini_token_expiry: nearFuture,
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );

    await expect(getValidGeminiToken(supabase, 'u1')).rejects.toBeInstanceOf(TokenError);
    await expect(getValidGeminiToken(supabase, 'u1')).rejects.toThrow(/refresh_failed/);
  });

  it('coalesces 5 concurrent refresh calls into 1 fetch', async () => {
    const nearFuture = new Date(Date.now() + 30 * 1000).toISOString();
    const supabase = makeSupabase({
      gemini_access_token: 'old-token',
      gemini_refresh_token: 'refresh-token',
      gemini_token_expiry: nearFuture,
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            // Small delay so concurrent callers pile up before the result.
            setTimeout(
              () =>
                resolve(
                  new Response(
                    JSON.stringify({ access_token: 'new-token', expires_in: 3600 }),
                    { status: 200 }
                  )
                ),
              10
            );
          })
      );

    const results = await Promise.all([
      getValidGeminiToken(supabase, 'u1'),
      getValidGeminiToken(supabase, 'u1'),
      getValidGeminiToken(supabase, 'u1'),
      getValidGeminiToken(supabase, 'u1'),
      getValidGeminiToken(supabase, 'u1'),
    ]);

    expect(results).toEqual([
      'new-token',
      'new-token',
      'new-token',
      'new-token',
      'new-token',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('persists refreshed token and new expiry back to the users row', async () => {
    const nearFuture = new Date(Date.now() + 30 * 1000).toISOString();
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const single = vi.fn().mockResolvedValue({
      data: {
        gemini_access_token: 'old-token',
        gemini_refresh_token: 'refresh-token',
        gemini_token_expiry: nearFuture,
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockImplementation((t: string) => {
      if (t === 'users') return { select, update };
      throw new Error(`unexpected ${t}`);
    });
    const supabase = { from } as any;

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'new-token', expires_in: 3600 }), {
        status: 200,
      })
    );

    await getValidGeminiToken(supabase, 'u1');

    expect(update).toHaveBeenCalledTimes(1);
    expect(updateEq).toHaveBeenCalledTimes(1);
    const updateArgs = update.mock.calls[0][0];
    expect(updateArgs.gemini_access_token).toBe('new-token');
    expect(typeof updateArgs.gemini_token_expiry).toBe('string');
    expect(updateEq).toHaveBeenCalledWith('id', 'u1');
  });
});
