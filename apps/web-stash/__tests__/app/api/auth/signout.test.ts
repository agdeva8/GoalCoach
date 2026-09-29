import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSignOut = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => {},
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

import { POST } from '@/app/api/auth/signout/route';
import { getServerSupabase } from '@/lib/supabase/server';

describe('POST /api/auth/signout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls supabase.auth.signOut() and redirects to /', async () => {
    mockSignOut.mockResolvedValue({ error: null });
    (getServerSupabase as any).mockResolvedValue({
      auth: { signOut: mockSignOut },
    });

    const req = new Request('http://localhost/api/auth/signout', { method: 'POST' });
    const res = await POST(req);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    // 303 See Other so the browser issues a GET on the Location target
    // (POST + 302 is not safe across browsers; 303 is the canonical
    // "you POSTed, now GET this" status).
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('still redirects to / even if signOut errors (best-effort)', async () => {
    mockSignOut.mockRejectedValue(new Error('cookies-locked'));
    (getServerSupabase as any).mockResolvedValue({
      auth: { signOut: mockSignOut },
    });

    const req = new Request('http://localhost/api/auth/signout', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost/');
  });
});