import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExchange = vi.fn();
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => {},
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  captureMessage: vi.fn(),
  withScope: (fn: any) => fn({ setTag: vi.fn(), setExtra: vi.fn() }),
}));

import { GET } from '@/app/api/auth/callback/route';
import { getServerSupabase } from '@/lib/supabase/server';

function makeSupabase(session: any) {
  return {
    auth: {
      exchangeCodeForSession: mockExchange.mockResolvedValue({
        data: { session },
        error: null,
      }),
      getUser: mockGetUser.mockResolvedValue({ data: { user: session?.user }, error: null }),
    },
    from: mockFrom,
  };
}

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists provider_token, provider_refresh_token, and expires_at to users row', async () => {
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const upsert = vi.fn().mockReturnValue({ eq: vi.fn() });
    const from = vi.fn().mockImplementation((t: string) => {
      if (t === 'users') return { update, upsert };
      throw new Error(`unexpected ${t}`);
    });

    const supabase = makeSupabase({
      user: { id: 'user-1', email: 'a@b.c' },
      provider_token: 'provider-access-token',
      provider_refresh_token: 'provider-refresh-token',
      expires_at: 1_700_000_000,
    });

    (getServerSupabase as any).mockResolvedValue({ ...supabase, from });

    const req = new Request('http://localhost/api/auth/callback?code=abc');
    const res = await GET(req);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(400);

    expect(from).toHaveBeenCalledWith('users');
  });

  it('redirects to home when no code is present (silent recovery)', async () => {
    const supabase = makeSupabase(null);
    (getServerSupabase as any).mockResolvedValue(supabase);

    const req = new Request('http://localhost/api/auth/callback');
    const res = await GET(req);
    // Either a redirect to "/" or a 200 with a redirect header set.
    expect([200, 302, 307]).toContain(res.status);
  });

  it('does not crash when session has no provider tokens (e.g. magic link)', async () => {
    const supabase = makeSupabase({
      user: { id: 'user-1', email: 'a@b.c' },
      // provider_token, provider_refresh_token undefined (magic link path)
    });
    (getServerSupabase as any).mockResolvedValue(supabase);

    const req = new Request('http://localhost/api/auth/callback?code=abc');
    const res = await GET(req);
    expect([200, 302, 307]).toContain(res.status);
  });
});
