import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExchange = vi.fn();

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

describe('GET /api/auth/callback (returnTo)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to returnTo on successful exchange', async () => {
    mockExchange.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'a@b.c' } } },
      error: null,
    });
    (getServerSupabase as any).mockResolvedValue({
      auth: { exchangeCodeForSession: mockExchange },
      from: vi.fn(),
    });

    const req = new Request(
      'http://localhost/api/auth/callback?code=abc&returnTo=' +
        encodeURIComponent('/chat?horizon=week')
    );
    const res = await GET(req);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toBe(
      'http://localhost/chat?horizon=week'
    );
  });

  it('falls back to / when returnTo is missing', async () => {
    mockExchange.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'a@b.c' } } },
      error: null,
    });
    (getServerSupabase as any).mockResolvedValue({
      auth: { exchangeCodeForSession: mockExchange },
      from: vi.fn(),
    });

    const req = new Request('http://localhost/api/auth/callback?code=abc');
    const res = await GET(req);
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('rejects absolute URL returnTo (open-redirect defense)', async () => {
    mockExchange.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'a@b.c' } } },
      error: null,
    });
    (getServerSupabase as any).mockResolvedValue({
      auth: { exchangeCodeForSession: mockExchange },
      from: vi.fn(),
    });

    const req = new Request(
      'http://localhost/api/auth/callback?code=abc&returnTo=' +
        encodeURIComponent('https://evil.example.com/phish')
    );
    const res = await GET(req);
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('rejects protocol-relative URL returnTo (//evil)', async () => {
    mockExchange.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'a@b.c' } } },
      error: null,
    });
    (getServerSupabase as any).mockResolvedValue({
      auth: { exchangeCodeForSession: mockExchange },
      from: vi.fn(),
    });

    const req = new Request(
      'http://localhost/api/auth/callback?code=abc&returnTo=' +
        encodeURIComponent('//evil.example.com')
    );
    const res = await GET(req);
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('redirects to returnTo even when no code is present', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { exchangeCodeForSession: mockExchange },
      from: vi.fn(),
    });
    const req = new Request(
      'http://localhost/api/auth/callback?returnTo=' +
        encodeURIComponent('/chat?horizon=month')
    );
    const res = await GET(req);
    expect(res.headers.get('location')).toBe('http://localhost/chat?horizon=month');
  });
});
