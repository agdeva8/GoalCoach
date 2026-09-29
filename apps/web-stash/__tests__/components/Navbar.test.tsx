import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

import { Navbar } from '@/components/Navbar';
import { getServerSupabase } from '@/lib/supabase/server';

describe('Navbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders brand link to home', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const element = await Navbar();
    render(element);
    expect(screen.getByTestId('navbar-brand')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('navbar-brand')).toHaveTextContent('GoalCoach');
  });

  it('shows Sign in with Google link when unauthenticated', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const element = await Navbar();
    render(element);
    const link = screen.getByTestId('navbar-signin');
    expect(link).toHaveTextContent(/Sign in with Google/);
    expect(link).toHaveAttribute('href', '/api/auth/google?returnTo=/');
  });

  it('shows email and Sign out button when authenticated', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({
        data: { user: { id: 'u1', email: 'founder@example.com' } },
        error: null,
      })},
    });
    const element = await Navbar();
    render(element);
    expect(screen.getByTestId('navbar-email')).toHaveTextContent('founder@example.com');
    const button = screen.getByTestId('navbar-signout');
    expect(button).toHaveTextContent(/Sign out/);
    expect(button.closest('form')).toHaveAttribute('action', '/api/auth/signout');
    expect(button.closest('form')).toHaveAttribute('method', 'post');
  });

  it('renders unauthenticated nav gracefully when server supabase throws', async () => {
    (getServerSupabase as any).mockRejectedValue(new Error('missing env'));
    const element = await Navbar();
    render(element);
    expect(screen.getByTestId('navbar-signin')).toBeTruthy();
    expect(screen.queryByTestId('navbar-signout')).toBeNull();
  });
});
