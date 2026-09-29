import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PlanCard } from '@/components/PlanCard';

afterEach(() => cleanup());

const baseGoal = {
  id: 'g1',
  user_id: 'u1',
  title: 'Ship phase 1',
  horizon: 'week' as const,
  status: 'active' as const,
  created_at: '2026-09-22T00:00:00Z',
  updated_at: '2026-09-22T00:00:00Z',
};

describe('PlanCard', () => {
  it('renders goal title', () => {
    render(<PlanCard goal={baseGoal} />);
    expect(screen.getByText('Ship phase 1')).toBeInTheDocument();
  });

  it('shows horizon badge', () => {
    render(<PlanCard goal={baseGoal} />);
    expect(screen.getByText('week')).toBeInTheDocument();
  });

  it('shows status pill', () => {
    render(<PlanCard goal={baseGoal} />);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders tooltip explaining the card', () => {
    render(<PlanCard goal={baseGoal} />);
    expect(screen.getByLabelText(/plan card explanation/i)).toBeInTheDocument();
    expect(screen.getByText(/plan card: goals and reflections/i)).toBeInTheDocument();
  });

  it('uses zero border-radius (sharp edges)', () => {
    const { container } = render(<PlanCard goal={baseGoal} />);
    const card = container.firstChild as HTMLElement;
    expect(getComputedStyle(card).borderRadius).toBe('0px');
  });
});
