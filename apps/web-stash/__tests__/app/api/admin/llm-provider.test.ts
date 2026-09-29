import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

import { POST } from '@/app/api/admin/llm-provider/route';
import { getServerSupabase } from '@/lib/supabase/server';

function makeSupabase(user: any) {
  return {
    auth: { getUser: mockGetUser.mockResolvedValue({ data: { user }, error: null }) },
    from: mockFrom.mockImplementation((t: string) => {
      if (t === 'users')
        return { update: mockUpdate.mockReturnValue({ eq: mockEq }) };
      throw new Error(`unexpected ${t}`);
    }),
  };
}

describe('POST /api/admin/llm-provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEq.mockResolvedValue({ data: null, error: null });
  });

  it('returns 401 when no user is authenticated', async () => {
    (getServerSupabase as any).mockResolvedValue(makeSupabase(null));

    const req = new Request('http://localhost/api/admin/llm-provider', {
      method: 'POST',
      body: JSON.stringify({ provider: 'gemini' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('flips users.llm_provider to gemini when authenticated', async () => {
    (getServerSupabase as any).mockResolvedValue(
      makeSupabase({ id: 'user-1', email: 'a@b.c' })
    );

    const req = new Request('http://localhost/api/admin/llm-provider', {
      method: 'POST',
      body: JSON.stringify({ provider: 'gemini' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({ llm_provider: 'gemini' });
    expect(mockEq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('flips users.llm_provider to anthropic when authenticated', async () => {
    (getServerSupabase as any).mockResolvedValue(
      makeSupabase({ id: 'user-1', email: 'a@b.c' })
    );

    const req = new Request('http://localhost/api/admin/llm-provider', {
      method: 'POST',
      body: JSON.stringify({ provider: 'anthropic' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({ llm_provider: 'anthropic' });
  });

  it('returns 400 for an unknown provider name', async () => {
    (getServerSupabase as any).mockResolvedValue(
      makeSupabase({ id: 'user-1', email: 'a@b.c' })
    );

    const req = new Request('http://localhost/api/admin/llm-provider', {
      method: 'POST',
      body: JSON.stringify({ provider: 'openai' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is malformed', async () => {
    (getServerSupabase as any).mockResolvedValue(
      makeSupabase({ id: 'user-1', email: 'a@b.c' })
    );

    const req = new Request('http://localhost/api/admin/llm-provider', {
      method: 'POST',
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
