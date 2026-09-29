import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StaleDataBanner } from '@/components/StaleDataBanner';

afterEach(() => cleanup());

describe('StaleDataBanner', () => {
  it('renders the L2 banner copy and role=alert', () => {
    render(<StaleDataBanner minutesAgo={5} />);
    const alert = screen.getByRole('alert');
    // L2 copy, verbatim, with the em dash replaced by a period (voice rule §10).
    expect(alert).toHaveTextContent(/some data may be stale/i);
    expect(alert).toHaveAttribute('data-banner', 'card-stale');
  });

  it('renders the minutesAgo value in the message', () => {
    render(<StaleDataBanner minutesAgo={7} />);
    expect(screen.getByRole('alert')).toHaveTextContent('7m');
  });
});
