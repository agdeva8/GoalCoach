import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

describe('weekly goal-check cron', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CRON_SECRET = 'test-secret';
  });

  function authed() {
    return { headers: { authorization: 'Bearer test-secret' } };
  }

  function unauth() {
    return { headers: {} as Record<string, string> };
  }

  it('401 without bearer', async () => {
    const { GET } = await import('@/app/api/cron/weekly/route');
    const res = await GET(new Request('http://x/api/cron/weekly'));
    expect(res.status).toBe(401);
  });

  it('401 when CRON_SECRET missing', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import('@/app/api/cron/weekly/route');
    const res = await GET(new Request('http://x/api/cron/weekly'));
    expect(res.status).toBe(401);
  });

  it('returns list of stale goals with updated_at', async () => {
    const sevenDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const lt = vi.fn().mockResolvedValue({
      data: [
        { id: 'stale-1', updated_at: sevenDaysAgo, title: 'old goal' },
        { id: 'stale-2', updated_at: sevenDaysAgo, title: 'another' },
      ],
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ lt });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };
    const { getServerSupabase } = await import('@/lib/supabase/server');
    vi.mocked(getServerSupabase).mockResolvedValue(supabase as any);

    const { GET } = await import('@/app/api/cron/weekly/route');
    const res = await GET(new Request('http://x/api/cron/weekly', authed() as any));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.stale[0]).toMatchObject({
      id: 'stale-1',
      title: 'old goal',
      updated_at: sevenDaysAgo,
    });
  });

  it('filters to active status only', async () => {
    const lt = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ lt });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };
    const { getServerSupabase } = await import('@/lib/supabase/server');
    vi.mocked(getServerSupabase).mockResolvedValue(supabase as any);

    const { GET } = await import('@/app/api/cron/weekly/route');
    await GET(new Request('http://x/api/cron/weekly', authed() as any));

    expect(eq).toHaveBeenCalledWith('status', 'active');
  });
});
