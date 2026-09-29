import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PlansByHorizon } from '@/components/PlansByHorizon';
import type { Goal, Horizon } from '@goalcoach/db';

afterEach(() => cleanup());

function goal(id: string, horizon: Horizon, title: string): Goal {
  return {
    id,
    user_id: 'u1',
    title,
    horizon,
    status: 'active',
    created_at: '2026-09-22T00:00:00Z',
    updated_at: '2026-09-22T00:00:00Z',
  };
}

describe('PlansByHorizon', () => {
  it('renders a per-horizon empty state when goals exist only in week', () => {
    const { container } = render(
      <PlansByHorizon goals={[goal('g1', 'week', 'Ship phase 1')]} />
    );

    // Five horizon sections are always rendered, in week -> multi-year order.
    expect(container.querySelectorAll('section')).toHaveLength(5);

    // Exactly one PlanCard: the single week goal.
    expect(container.querySelectorAll('[data-card-type="goal"]')).toHaveLength(1);

    // The other four horizons show an empty state.
    const empties = container.querySelectorAll('[data-empty-horizon]');
    expect(empties).toHaveLength(4);
    expect(
      Array.from(empties).map((el) => el.getAttribute('data-empty-horizon')).sort()
    ).toEqual(['month', 'multi-year', 'quarter', 'year']);
  });

  it('renders no empty states when every horizon has a goal', () => {
    const { container } = render(
      <PlansByHorizon
        goals={[
          goal('g1', 'week', 'Week goal'),
          goal('g2', 'month', 'Month goal'),
          goal('g3', 'quarter', 'Quarter goal'),
          goal('g4', 'year', 'Year goal'),
          goal('g5', 'multi-year', 'Multi-year goal'),
        ]}
      />
    );

    expect(container.querySelectorAll('section')).toHaveLength(5);
    expect(container.querySelectorAll('[data-empty-horizon]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-card-type="goal"]')).toHaveLength(5);
  });
});
