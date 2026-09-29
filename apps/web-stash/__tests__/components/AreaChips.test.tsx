import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AreaChips } from '@/components/AreaChips';

afterEach(() => cleanup());

it('renders 6 area chips with hash prefix', () => {
  render(<AreaChips onPick={vi.fn()} />);
  expect(screen.getAllByRole('button')).toHaveLength(6);
  expect(screen.getByText(/#career/i)).toBeInTheDocument();
});

it('clicking a chip calls onPick with a drafting prefix and the area key', () => {
  const onPick = vi.fn();
  render(<AreaChips onPick={onPick} />);
  fireEvent.click(screen.getByText(/#career/i));
  expect(onPick).toHaveBeenCalledWith({
    prefix: "I'm thinking about career:",
    key: 'career',
  });
});
