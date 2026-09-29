import { describe, it, expect, vi } from 'vitest';

describe('queries', () => {
  it('getGoalsForUser returns goals array from supabase', async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'g1', title: 'x' }], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };

    const { getGoalsForUser } = await import('../src/queries');
    const result = await getGoalsForUser(supabase as any, 'user-1');
    expect(result).toEqual([{ id: 'g1', title: 'x' }]);
    expect(supabase.from).toHaveBeenCalledWith('goals');
  });

  it('insertGoal passes title and horizon', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'g2' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const supabase = { from: vi.fn().mockReturnValue({ insert }) };

    const { insertGoal } = await import('../src/queries');
    const result = await insertGoal(supabase as any, 'user-1', 'ship v1', 'week');
    expect(result).toEqual({ id: 'g2' });
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      title: 'ship v1',
      horizon: 'week',
    });
  });

  it('insertReflection allows null goal_id when not provided', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'r1' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const supabase = { from: vi.fn().mockReturnValue({ insert }) };

    const { insertReflection } = await import('../src/queries');
    await insertReflection(supabase as any, 'user-1', 'felt stuck', undefined, 'week');
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      body: 'felt stuck',
      goal_id: null,
      horizon: 'week',
    });
  });

  it('appendThread first calls ensureUserExists then inserts the thread', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 't1' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === 'users') return { upsert };
      return { insert };
    });
    const supabase = { from };

    const { appendThread } = await import('../src/queries');
    await appendThread(supabase as any, 'user-1', 'assistant', 'hi back', 'a@b.com', 'AB');
    expect(upsert).toHaveBeenCalledWith(
      { id: 'user-1', email: 'a@b.com', name: 'AB' },
      { onConflict: 'id', ignoreDuplicates: true }
    );
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      role: 'assistant',
      content: 'hi back',
    });
    // Order matters: ensureUserExists fires BEFORE the thread insert, so the
    // FK on threads.user_id can never see a missing public.users row.
    const upsertOrder = upsert.mock.invocationCallOrder[0]!;
    const insertOrder = insert.mock.invocationCallOrder[0]!;
    expect(upsertOrder).toBeLessThan(insertOrder);
  });

  it('ensureUserExists is silent on duplicate user rows (ignoreDuplicates)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) };

    const { ensureUserExists } = await import('../src/queries');
    await expect(
      ensureUserExists(supabase as any, 'user-1', 'a@b.com', 'AB')
    ).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledWith(
      { id: 'user-1', email: 'a@b.com', name: 'AB' },
      { onConflict: 'id', ignoreDuplicates: true }
    );
  });

  it('ensureUserExists throws when the upsert itself returns an error', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: new Error('rls denied') });
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) };

    const { ensureUserExists } = await import('../src/queries');
    await expect(
      ensureUserExists(supabase as any, 'user-1', 'a@b.com')
    ).rejects.toThrow('rls denied');
  });

  it('recordFeedback stores sentiment up/down', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'f1' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const supabase = { from: vi.fn().mockReturnValue({ insert }) };

    const { recordFeedback } = await import('../src/queries');
    await recordFeedback(supabase as any, 'user-1', 'm-1', 'up', 'great');
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      message_id: 'm-1',
      sentiment: 'up',
      comment: 'great',
    });
  });

  it('getRecentThreads returns chronological order (reverses DB DESC result)', async () => {
    // DB returns newest-first (DESC); we reverse to chronological for prompt context
    const limit = vi.fn().mockResolvedValue({
      data: [
        { id: 't3', content: 'newest' },
        { id: 't2', content: 'middle' },
        { id: 't1', content: 'oldest' },
      ],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };

    const { getRecentThreads } = await import('../src/queries');
    const result = await getRecentThreads(supabase as any, 'user-1', 10);
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result.map((r) => r.id)).toEqual(['t1', 't2', 't3']);
  });
});
