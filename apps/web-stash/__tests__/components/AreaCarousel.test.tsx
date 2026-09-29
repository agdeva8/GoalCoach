import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AreaCarousel } from '@/components/AreaCarousel';

afterEach(() => cleanup());

describe('<AreaCarousel />', () => {
  it('renders the 6 area chips from getAreas()', () => {
    render(<AreaCarousel onConfirm={vi.fn()} />);
    const chips = screen.getAllByRole('button', { name: /add area/i });
    expect(chips).toHaveLength(6);
  });

  it('clicking a chip toggles its selected state (data-selected)', () => {
    render(<AreaCarousel onConfirm={vi.fn()} />);
    const career = screen.getByRole('button', { name: /add area career/i });
    expect(carrier_getDataSelected(career)).toBe('false');
    fireEvent.click(career);
    expect(carrier_getDataSelected(career)).toBe('true');
    fireEvent.click(career);
    expect(carrier_getDataSelected(career)).toBe('false');
  });

  it('Continue button calls onConfirm with the selected area keys', () => {
    const onConfirm = vi.fn();
    render(<AreaCarousel onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /add area career/i }));
    fireEvent.click(screen.getByRole('button', { name: /add area health/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onConfirm).toHaveBeenCalledWith(['career', 'health']);
  });

  it('Skip for now link calls onConfirm with an empty array', () => {
    const onConfirm = vi.fn();
    render(<AreaCarousel onConfirm={onConfirm} />);
    // Skip is rendered as <button type="button"> (the plan Step 3 shape), whose
    // implicit role is "button". A previous draft queried role "text"; that role
    // matches no HTML element here (an <a href> is a "link", and a role="text"
    // element only gets an accessible name via an explicit aria-label), so the
    // query could never resolve. Behavioral assertion is unchanged.
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(onConfirm).toHaveBeenCalledWith([]);
  });
});

function carrier_getDataSelected(el: HTMLElement): string {
  return el.getAttribute('data-selected') ?? 'false';
}
