import { describe, it, expect, vi } from 'vitest';
import type { Area } from '../src/types';

describe('getGoalsBucketedByStatus', () => {
  it('returns goals grouped into active/paused/completed buckets', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        { id: 'g1', status: 'active' },
        { id: 'g2', status: 'paused' },
        { id: 'g3', status: 'completed' },
        { id: 'g4', status: 'active' },
      ],
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };

    const { getGoalsBucketedByStatus } = await import('../src/queries');
    const result = await getGoalsBucketedByStatus(supabase as any, 'user-1');
    expect(result.active).toHaveLength(2);
    expect(result.paused).toHaveLength(1);
    expect(result.completed).toHaveLength(1);
  });

  it('returns empty buckets when no goals exist', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };

    const { getGoalsBucketedByStatus } = await import('../src/queries');
    const result = await getGoalsBucketedByStatus(supabase as any, 'user-1');
    expect(result).toEqual({ active: [], paused: [], completed: [] });
  });

  it('excludes abandoned goals from returned buckets', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ id: 'g1', status: 'abandoned' }],
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };

    const { getGoalsBucketedByStatus } = await import('../src/queries');
    const result = await getGoalsBucketedByStatus(supabase as any, 'user-1');
    expect(result.active).toHaveLength(0);
    expect(result.paused).toHaveLength(0);
    expect(result.completed).toHaveLength(0);
  });

  it('throws on supabase error', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: new Error('db down') });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };

    const { getGoalsBucketedByStatus } = await import('../src/queries');
    await expect(getGoalsBucketedByStatus(supabase as any, 'user-1')).rejects.toThrow('db down');
  });
});

describe('getAreas', () => {
  it('returns all 6 areas even when user has none in some', async () => {
    const { getAreas } = await import('../src/queries');
    const areas: Area[] = await getAreas();
    expect(areas).toHaveLength(6);
    expect(areas.map((a) => a.key)).toEqual([
      'career', 'health', 'relationships', 'finance', 'learning', 'fun',
    ]);
  });
});
