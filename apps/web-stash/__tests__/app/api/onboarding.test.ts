import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

vi.mock('@goalcoach/db', async () => {
  const actual = await vi.importActual<any>('@goalcoach/db');
  return { ...actual, setUserAreaPreferences: vi.fn() };
});

import { POST } from '@/app/api/onboarding/route';
import { getServerSupabase } from '@/lib/supabase/server';
import { setUserAreaPreferences } from '@goalcoach/db';

describe('POST /api/onboarding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when the user is not authenticated', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const req = new Request('http://localhost/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ areas: ['career'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('persists the given area keys via setUserAreaPreferences', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    });
    const req = new Request('http://localhost/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ areas: ['career', 'health'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(setUserAreaPreferences).toHaveBeenCalledWith(expect.anything(), 'u1', ['career', 'health']);
  });

  it('allows an empty array (skip path)', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    });
    const req = new Request('http://localhost/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ areas: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(setUserAreaPreferences).toHaveBeenCalledWith(expect.anything(), 'u1', []);
  });

  it('returns 400 when the body is not valid JSON', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    });
    const req = new Request('http://localhost/api/onboarding', {
      method: 'POST',
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('drops unknown area keys before persisting (Review Focus 4: idempotency)', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    });
    const req = new Request('http://localhost/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ areas: ['career', 'martial-arts'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(setUserAreaPreferences).toHaveBeenCalledWith(expect.anything(), 'u1', ['career']);
  });
});
