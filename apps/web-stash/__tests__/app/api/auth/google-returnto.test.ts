import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSignInWithOAuth = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

import { GET } from '@/app/api/auth/google/route';
import { getServerSupabase } from '@/lib/supabase/server';

describe('GET /api/auth/google (returnTo)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
  });

  it('accepts ?returnTo=/chat%3Fhorizon%3Dweek and includes it in the OAuth redirectTo', async () => {
    let captured: any = null;
    mockSignInWithOAuth.mockImplementation((opts: any) => {
      captured = opts;
      return Promise.resolve({
        data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?...', _try: 'failed' },
        error: null,
      });
    });
    (getServerSupabase as any).mockResolvedValue({
      auth: { signInWithOAuth: mockSignInWithOAuth },
    });

    const req = new Request(
      'http://localhost/api/auth/google?returnTo=' +
        encodeURIComponent('/chat?horizon=week')
    );

    try {
      await GET(req);
    } catch (e: any) {
      if (!String(e?.message ?? '').includes('NEXT_REDIRECT')) throw e;
    }

    expect(captured).not.toBeNull();
    expect(captured.provider).toBe('google');
    // The OAuth redirectTo must include our callback URL AND echo back
    // the returnTo so the callback can route the user there post-auth.
    expect(captured.options.redirectTo).toContain('/api/auth/callback');
    expect(captured.options.redirectTo).toContain(
      'returnTo=' + encodeURIComponent('/chat?horizon=week')
    );
  });

  it('rejects absolute URL returnTo (open-redirect defense) - falls back to /', async () => {
    let captured: any = null;
    mockSignInWithOAuth.mockImplementation((opts: any) => {
      captured = opts;
      return Promise.resolve({
        data: { url: 'https://accounts.google.com/...' },
        error: null,
      });
    });
    (getServerSupabase as any).mockResolvedValue({
      auth: { signInWithOAuth: mockSignInWithOAuth },
    });

    const req = new Request(
      'http://localhost/api/auth/google?returnTo=' +
        encodeURIComponent('https://evil.example.com/phish')
    );

    try {
      await GET(req);
    } catch (e: any) {
      if (!String(e?.message ?? '').includes('NEXT_REDIRECT')) throw e;
    }

    expect(captured.options.redirectTo).toContain('/api/auth/callback');
    // returnTo is dropped (or not added) when sanitized back to '/'.
    // Either the param is absent, or it is exactly the literal '/'.
    const url = new URL(captured.options.redirectTo);
    const rt = url.searchParams.get('returnTo');
    expect(rt === null || rt === '/').toBe(true);
  });

  it('rejects protocol-relative URL returnTo (//evil) - falls back to /', async () => {
    let captured: any = null;
    mockSignInWithOAuth.mockImplementation((opts: any) => {
      captured = opts;
      return Promise.resolve({
        data: { url: 'https://accounts.google.com/...' },
        error: null,
      });
    });
    (getServerSupabase as any).mockResolvedValue({
      auth: { signInWithOAuth: mockSignInWithOAuth },
    });

    const req = new Request('http://localhost/api/auth/google?returnTo=' + encodeURIComponent('//evil.example.com'));

    try {
      await GET(req);
    } catch (e: any) {
      if (!String(e?.message ?? '').includes('NEXT_REDIRECT')) throw e;
    }

    const url = new URL(captured.options.redirectTo);
    const rt = url.searchParams.get('returnTo');
    expect(rt === null || rt === '/').toBe(true);
  });
});