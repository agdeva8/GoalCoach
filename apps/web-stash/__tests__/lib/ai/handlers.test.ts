import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('createHandlers', () => {
  let supabase: any;
  let handlers: any;

  beforeEach(async () => {
    supabase = { from: vi.fn() };
    const mod = await import('@/lib/ai/handlers');
    handlers = mod.createHandlers(supabase, 'user-1');
  });

  it('list_goals returns goals array from supabase', async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'g1' }], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    supabase.from.mockReturnValue({ select });
    const result = await handlers.list_goals({});
    expect(result).toEqual([{ id: 'g1' }]);
    expect(supabase.from).toHaveBeenCalledWith('goals');
  });

  it('create_goal inserts with title + horizon + user_id', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'g2' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    supabase.from.mockReturnValue({ insert });
    await handlers.create_goal({ title: 'ship v1', horizon: 'week' });
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      title: 'ship v1',
      horizon: 'week',
    });
  });

  it('update_goal patches only provided fields + updated_at', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'g1', status: 'completed' }, error: null });
    const eq = vi.fn().mockReturnValue({ select: () => ({ single }) });
    const update = vi.fn().mockReturnValue({ eq });
    supabase.from.mockReturnValue({ update });
    await handlers.update_goal({ goal_id: 'g1', status: 'completed' });
    const call = update.mock.calls[0][0];
    expect(call.status).toBe('completed');
    expect(call.title).toBeUndefined();
    expect(call.updated_at).toBeDefined();
  });

  it('log_reflection defaults goal_id to null', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'r1' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    supabase.from.mockReturnValue({ insert });
    await handlers.log_reflection({ body: 'felt stuck', horizon: 'week' });
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      body: 'felt stuck',
      goal_id: null,
      horizon: 'week',
    });
  });

  it('search_threads filters by query (case-insensitive)', async () => {
    // getRecentThreads receives DB DESC, reverses to chronological ASC.
    // Mock returns DB DESC [t3, t2, t1] → reversed to [t1=oldest, t2, t3=newest]
    // After filter for "sleep": contents match in t3 and t1, in chronological order.
    const limit = vi.fn().mockResolvedValue({
      data: [
        { id: 't3', role: 'assistant', content: 'sounds like sleep again' },
        { id: 't2', role: 'user', content: 'i am tired' },
        { id: 't1', role: 'assistant', content: 'How does Sleep feel this week?' },
      ],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    supabase.from.mockReturnValue({ select });
    const result = await handlers.search_threads({ q: 'sleep' });
    // t1 and t3 match (case-insensitive "sleep"); chronological order preserved
    expect(result.map((r: any) => r.id)).toEqual(['t1', 't3']);
  });
});
