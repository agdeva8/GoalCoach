import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FeedbackButtons } from '@/components/FeedbackButtons';

afterEach(() => cleanup());

describe('FeedbackButtons', () => {
  it('renders up and down buttons', () => {
    render(<FeedbackButtons messageId="m1" onFeedback={() => {}} />);
    expect(screen.getByRole('button', { name: 'Helpful' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not helpful' })).toBeInTheDocument();
  });

  it('calls onFeedback with "up" when up clicked', () => {
    const onFeedback = vi.fn();
    render(<FeedbackButtons messageId="m1" onFeedback={onFeedback} />);
    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    expect(onFeedback).toHaveBeenCalledWith('up');
  });

  it('calls onFeedback with "down" when down clicked', () => {
    const onFeedback = vi.fn();
    render(<FeedbackButtons messageId="m1" onFeedback={onFeedback} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not helpful' }));
    expect(onFeedback).toHaveBeenCalledWith('down');
  });

  it('marks the selected sentiment visually after click', () => {
    render(<FeedbackButtons messageId="m1" onFeedback={() => {}} />);
    const up = screen.getByRole('button', { name: 'Helpful' });
    fireEvent.click(up);
    expect(up).toHaveAttribute('aria-pressed', 'true');
  });

  it('allows switching sentiment', () => {
    render(<FeedbackButtons messageId="m1" onFeedback={() => {}} />);
    const up = screen.getByRole('button', { name: 'Helpful' });
    const down = screen.getByRole('button', { name: 'Not helpful' });
    fireEvent.click(up);
    fireEvent.click(down);
    expect(up).toHaveAttribute('aria-pressed', 'false');
    expect(down).toHaveAttribute('aria-pressed', 'true');
  });
});
