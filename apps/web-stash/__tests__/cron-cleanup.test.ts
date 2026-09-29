import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

describe('cleanup cron', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CRON_SECRET = 'test-secret';
  });

  function authed() {
    return { headers: { authorization: 'Bearer test-secret' } };
  }

  it('401 without bearer', async () => {
    const { GET } = await import('@/app/api/cron/cleanup/route');
    const res = await GET(new Request('http://x/api/cron/cleanup'));
    expect(res.status).toBe(401);
  });

  it('401 when CRON_SECRET missing', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import('@/app/api/cron/cleanup/route');
    const res = await GET(new Request('http://x/api/cron/cleanup'));
    expect(res.status).toBe(401);
  });

  it('calls cleanup_expired_rows rpc and returns ok', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { rpc };
    const { getServerSupabase } = await import('@/lib/supabase/server');
    vi.mocked(getServerSupabase).mockResolvedValue(supabase as any);

    const { GET } = await import('@/app/api/cron/cleanup/route');
    const res = await GET(new Request('http://x/api/cron/cleanup', authed() as any));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('cleanup_expired_rows');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 500 when rpc errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const supabase = { rpc };
    const { getServerSupabase } = await import('@/lib/supabase/server');
    vi.mocked(getServerSupabase).mockResolvedValue(supabase as any);

    const { GET } = await import('@/app/api/cron/cleanup/route');
    const res = await GET(new Request('http://x/api/cron/cleanup', authed() as any));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });
});
