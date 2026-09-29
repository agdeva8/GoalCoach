import { describe, it, expect, vi } from 'vitest';
import { createHandlers } from '@/lib/ai/handlers';

const userId = 'user-1';

function buildSupabaseMock() {
  const supabase: any = {
    from: vi.fn(),
  };
  return supabase;
}

function chainEq(supabase: any, terminal: any) {
  const eq = vi.fn().mockReturnValue({ order: vi.fn().mockReturnValue(terminal) });
  const select = vi.fn().mockReturnValue({ eq });
  supabase.from.mockReturnValue({ select });
}

describe('handler: list_goals', () => {
  it('returns goals for current user', async () => {
    const supabase = buildSupabaseMock();
    chainEq(supabase, {
      data: [{ id: 'g1', title: 'ship', status: 'active' }],
      error: null,
    });
    const handlers = createHandlers(supabase, userId);
    const result = await handlers.list_goals({});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g1');
    expect(supabase.from).toHaveBeenCalledWith('goals');
  });

  it('throws on supabase error', async () => {
    const supabase = buildSupabaseMock();
    chainEq(supabase, { data: null, error: new Error('boom') });
    const handlers = createHandlers(supabase, userId);
    await expect(handlers.list_goals({})).rejects.toThrow('boom');
  });
});

describe('handler: create_goal', () => {
  it('inserts goal with user_id, title, horizon and returns row', async () => {
    const supabase = buildSupabaseMock();
    const single = vi.fn().mockResolvedValue({ data: { id: 'g2' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    supabase.from.mockReturnValue({ insert });
    const handlers = createHandlers(supabase, userId);
    const result = await handlers.create_goal({ title: 'learn rust', horizon: 'month' });
    expect(insert).toHaveBeenCalledWith({
      user_id: userId,
      title: 'learn rust',
      horizon: 'month',
    });
    expect(result.id).toBe('g2');
  });
});

describe('handler: update_goal', () => {
  it('updates only provided fields, sets updated_at', async () => {
    const supabase = buildSupabaseMock();
    const single = vi.fn().mockResolvedValue({ data: { id: 'g1' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    supabase.from.mockReturnValue({ update });
    const handlers = createHandlers(supabase, userId);
    await handlers.update_goal({ goal_id: 'g1', status: 'completed' });
    const patch = update.mock.calls[0][0];
    expect(patch.status).toBe('completed');
    expect(patch.title).toBeUndefined();
    expect(typeof patch.updated_at).toBe('string');
    expect(eq).toHaveBeenCalledWith('id', 'g1');
  });

  it('returns row when update succeeds', async () => {
    const supabase = buildSupabaseMock();
    const single = vi.fn().mockResolvedValue({ data: { id: 'g9' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    supabase.from.mockReturnValue({ update });
    const handlers = createHandlers(supabase, userId);
    const r = await handlers.update_goal({ goal_id: 'g9', title: 'renamed' });
    expect(r.id).toBe('g9');
  });
});

describe('handler: log_reflection', () => {
  it('inserts reflection with body and optional goal_id/horizon', async () => {
    const supabase = buildSupabaseMock();
    const single = vi.fn().mockResolvedValue({ data: { id: 'r1' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    supabase.from.mockReturnValue({ insert });
    const handlers = createHandlers(supabase, userId);
    const r = await handlers.log_reflection({
      body: 'tired today',
      goal_id: 'g1',
      horizon: 'week',
    });
    expect(insert).toHaveBeenCalledWith({
      user_id: userId,
      body: 'tired today',
      goal_id: 'g1',
      horizon: 'week',
    });
    expect(r.id).toBe('r1');
  });

  it('passes null for missing goal_id and horizon', async () => {
    const supabase = buildSupabaseMock();
    const single = vi.fn().mockResolvedValue({ data: { id: 'r2' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    supabase.from.mockReturnValue({ insert });
    const handlers = createHandlers(supabase, userId);
    await handlers.log_reflection({ body: 'general note' });
    expect(insert).toHaveBeenCalledWith({
      user_id: userId,
      body: 'general note',
      goal_id: null,
      horizon: null,
    });
  });
});

describe('handler: search_threads', () => {
  it('filters recent threads by case-insensitive substring match', async () => {
    const supabase = buildSupabaseMock();
    const order = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        data: [
          { id: 't1', content: 'Hello World', created_at: '2026-09-22T00:00:00Z' },
          { id: 't2', content: 'goodbye world', created_at: '2026-09-22T00:01:00Z' },
          { id: 't3', content: 'unrelated', created_at: '2026-09-22T00:02:00Z' },
        ],
        error: null,
      }),
    });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    supabase.from.mockReturnValue({ select });
    const handlers = createHandlers(supabase, userId);
    const r = await handlers.search_threads({ q: 'world' });
    expect(r).toHaveLength(2);
    expect(r.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('clamps limit to default 20 when not provided', async () => {
    const supabase = buildSupabaseMock();
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    supabase.from.mockReturnValue({ select });
    const handlers = createHandlers(supabase, userId);
    await handlers.search_threads({ q: 'anything' });
    expect(limit).toHaveBeenCalledWith(20);
  });
});
