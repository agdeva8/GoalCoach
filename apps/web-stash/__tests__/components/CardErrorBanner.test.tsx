import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CardErrorBanner } from '@/components/CardErrorBanner';

afterEach(() => cleanup());

describe('CardErrorBanner', () => {
  it('renders retryable error with retry button', () => {
    const onRetry = vi.fn();
    render(<CardErrorBanner error={{ kind: 'retryable', message: 'Network blip' }} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/network blip/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('fires onRetry when retry button clicked', () => {
    const onRetry = vi.fn();
    render(<CardErrorBanner error={{ kind: 'retryable', message: 'oops' }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders fatal error without retry button', () => {
    render(<CardErrorBanner error={{ kind: 'fatal', message: 'Not authorized' }} onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/not authorized/i);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});
