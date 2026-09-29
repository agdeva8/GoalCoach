import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSignInWithOAuth = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

import { GET } from '@/app/api/auth/google/route';
import { getServerSupabase } from '@/lib/supabase/server';

describe('GET /api/auth/google', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
  });

  it('requests the Gemini scope alongside openid/email/profile', async () => {
    let captured: any = null;
    mockSignInWithOAuth.mockImplementation((opts: any) => {
      captured = opts;
      return Promise.resolve({
        data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?...' },
        error: null,
      });
    });
    (getServerSupabase as any).mockResolvedValue({
      auth: { signInWithOAuth: mockSignInWithOAuth },
    });

    // Next.js redirect() throws NEXT_REDIRECT; swallow it so we can
    // assert on the captured OAuth options.
    try {
      await GET(new Request('http://localhost/api/auth/google'));
    } catch (e: any) {
      if (!String(e?.message ?? '').includes('NEXT_REDIRECT')) throw e;
    }

    expect(captured.provider).toBe('google');
    expect(captured.options.scopes).toContain('openid');
    expect(captured.options.scopes).toContain('email');
    expect(captured.options.scopes).toContain('profile');
    // Google publishes these two scopes for OAuth access to the Generative
    // Language API. cloud-platform is the broad GCP scope; retriever covers
    // the semantic-retrieval half. Together they let the user's access
    // token call streamGenerateContent on behalf of that user.
    expect(captured.options.scopes).toContain(
      'https://www.googleapis.com/auth/cloud-platform'
    );
    expect(captured.options.scopes).toContain(
      'https://www.googleapis.com/auth/generative-language.retriever'
    );
  });

  it('throws when signInWithOAuth returns an error', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: null,
      error: new Error('oauth-failed'),
    });
    (getServerSupabase as any).mockResolvedValue({
      auth: { signInWithOAuth: mockSignInWithOAuth },
    });

    await expect(GET(new Request('http://localhost/api/auth/google'))).rejects.toThrow();
  });
});
