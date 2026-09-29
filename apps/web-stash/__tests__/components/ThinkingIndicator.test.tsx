import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { ThinkingIndicator } from '@/components/ThinkingIndicator';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ThinkingIndicator', () => {
  it('silent under 2s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T12:00:00Z'));
    render(<ThinkingIndicator startedAt={Date.now()} persona="alex" />);
    expect(screen.queryByText(/alex/i)).not.toBeInTheDocument();
  });

  it('shows persona-aware text between 2-4s', () => {
    vi.useFakeTimers();
    const start = new Date('2026-09-22T12:00:00Z').getTime();
    vi.setSystemTime(start);
    render(<ThinkingIndicator startedAt={start} persona="alex" />);
    act(() => {
      vi.setSystemTime(start + 2500);
      vi.advanceTimersByTime(2500);
    });
    expect(screen.getByText(/alex/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
  });

  it('shows cancel button after 4s', () => {
    vi.useFakeTimers();
    const start = new Date('2026-09-22T12:00:00Z').getTime();
    vi.setSystemTime(start);
    render(<ThinkingIndicator startedAt={start} persona="alex" onCancel={() => {}} />);
    act(() => {
      vi.setSystemTime(start + 5000);
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('calls onCancel when stop clicked', () => {
    vi.useFakeTimers();
    const start = new Date('2026-09-22T12:00:00Z').getTime();
    vi.setSystemTime(start);
    const onCancel = vi.fn();
    render(<ThinkingIndicator startedAt={start} persona="alex" onCancel={onCancel} />);
    act(() => {
      vi.setSystemTime(start + 5000);
      vi.advanceTimersByTime(5000);
    });
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
