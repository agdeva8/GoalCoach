import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MagicLinkModal } from '@/components/MagicLinkModal';

afterEach(() => cleanup());

describe('MagicLinkModal (deferred v1.1)', () => {
  it('renders email input and submit button', () => {
    render(<MagicLinkModal open onSubmit={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send link/i })).toBeInTheDocument();
  });

  it('calls onSubmit with email when form submitted', () => {
    const onSubmit = vi.fn();
    render(<MagicLinkModal open onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: /send link/i }));
    expect(onSubmit).toHaveBeenCalledWith('a@b.co');
  });

  it('calls onClose when cancel clicked', () => {
    const onClose = vi.fn();
    render(<MagicLinkModal open onSubmit={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<MagicLinkModal open={false} onSubmit={() => {}} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
