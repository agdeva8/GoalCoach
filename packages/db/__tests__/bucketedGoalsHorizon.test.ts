import { describe, it, expect, vi } from 'vitest';
import type { Goal } from '../src/types';

describe('bucketGoalsByHorizon', () => {
  it('places each goal into its horizon bucket', async () => {
    const { bucketGoalsByHorizon } = await import('../src/queries');
    const goals: Goal[] = [
      { id: '1', user_id: 'u', title: 'a', horizon: 'week', status: 'active', created_at: '2026-09-22T00:00:00Z', updated_at: '2026-09-22T00:00:00Z' },
      { id: '2', user_id: 'u', title: 'b', horizon: 'month', status: 'active', created_at: '2026-09-22T00:00:00Z', updated_at: '2026-09-22T00:00:00Z' },
      { id: '3', user_id: 'u', title: 'c', horizon: 'week', status: 'paused', created_at: '2026-09-22T00:00:00Z', updated_at: '2026-09-22T00:00:00Z' },
      { id: '4', user_id: 'u', title: 'd', horizon: 'year', status: 'active', created_at: '2026-09-22T00:00:00Z', updated_at: '2026-09-22T00:00:00Z' },
    ];
    const result = bucketGoalsByHorizon(goals);
    expect(result.week).toHaveLength(2);
    expect(result.month).toHaveLength(1);
    expect(result.quarter).toHaveLength(0);
    expect(result.year).toHaveLength(1);
    expect(result['multi-year']).toHaveLength(0);
  });

  it('returns all five keys with empty arrays when given []', async () => {
    const { bucketGoalsByHorizon } = await import('../src/queries');
    const result = bucketGoalsByHorizon([]);
    expect(Object.keys(result).sort()).toEqual(['month', 'multi-year', 'quarter', 'week', 'year']);
    for (const k of Object.keys(result)) {
      expect(result[k as keyof typeof result]).toEqual([]);
    }
  });

  it('counts both active and paused goals in horizon buckets', async () => {
    const { bucketGoalsByHorizon } = await import('../src/queries');
    const goals: Goal[] = [
      { id: '1', user_id: 'u', title: 'a', horizon: 'quarter', status: 'active', created_at: '2026-09-22T00:00:00Z', updated_at: '2026-09-22T00:00:00Z' },
      { id: '2', user_id: 'u', title: 'b', horizon: 'quarter', status: 'paused', created_at: '2026-09-22T00:00:00Z', updated_at: '2026-09-22T00:00:00Z' },
      { id: '3', user_id: 'u', title: 'c', horizon: 'quarter', status: 'completed', created_at: '2026-09-22T00:00:00Z', updated_at: '2026-09-22T00:00:00Z' },
    ];
    const result = bucketGoalsByHorizon(goals);
    expect(result.quarter).toHaveLength(3);
  });
});
