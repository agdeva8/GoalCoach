import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

describe('monthly reflection cron', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CRON_SECRET = 'test-secret';
  });

  function authed() {
    return { headers: { authorization: 'Bearer test-secret' } };
  }

  it('401 without bearer', async () => {
    const { GET } = await import('@/app/api/cron/monthly/route');
    const res = await GET(new Request('http://x/api/cron/monthly'));
    expect(res.status).toBe(401);
  });

  it('returns reflections older than 30 days with created_at', async () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const lt = vi.fn().mockResolvedValue({
      data: [
        { id: 'r1', body: 'old thought', created_at: fortyDaysAgo },
        { id: 'r2', body: 'another', created_at: fortyDaysAgo },
      ],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ lt });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };
    const { getServerSupabase } = await import('@/lib/supabase/server');
    vi.mocked(getServerSupabase).mockResolvedValue(supabase as any);

    const { GET } = await import('@/app/api/cron/monthly/route');
    const res = await GET(new Request('http://x/api/cron/monthly', authed() as any));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.reflections[0]).toMatchObject({
      id: 'r1',
      body: 'old thought',
      created_at: fortyDaysAgo,
    });
    expect(supabase.from).toHaveBeenCalledWith('reflections');
  });

  it('returns empty when no old reflections', async () => {
    const lt = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn().mockReturnValue({ lt });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };
    const { getServerSupabase } = await import('@/lib/supabase/server');
    vi.mocked(getServerSupabase).mockResolvedValue(supabase as any);

    const { GET } = await import('@/app/api/cron/monthly/route');
    const res = await GET(new Request('http://x/api/cron/monthly', authed() as any));
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.reflections).toEqual([]);
  });
});
