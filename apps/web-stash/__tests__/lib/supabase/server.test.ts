import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => {},
  })),
}));

// We must re-import inside each test so module-level env reads happen
// after we've set the env. Top-level import would freeze the env at
// module-load time, before beforeEach can change it.
describe('getServerSupabase', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.resetModules();
  });

  it('returns a client bound to cookies using publishable key', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_X';
    const { getServerSupabase } = await import('@/lib/supabase/server');
    const supabase = await getServerSupabase();
    expect(supabase).toBeDefined();
    expect(typeof supabase.auth.getUser).toBe('function');
  });

  it('falls back to legacy ANON_KEY when publishable is absent', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'old-anon-key';
    const { getServerSupabase } = await import('@/lib/supabase/server');
    const supabase = await getServerSupabase();
    expect(supabase).toBeDefined();
    expect(typeof supabase.auth.getUser).toBe('function');
  });

  it('throws when neither URL nor key is set', async () => {
    const { getServerSupabase } = await import('@/lib/supabase/server');
    await expect(getServerSupabase()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
