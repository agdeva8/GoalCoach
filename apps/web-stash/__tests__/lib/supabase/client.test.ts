import { describe, it, expect, vi, beforeEach } from 'vitest';

// getBrowserSupabase reads process.env at module-import time, so each
// test must reset modules and re-import with the env it wants.
describe('getBrowserSupabase', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.resetModules();
  });

  it('returns a client using publishable key', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_X';
    const { getBrowserSupabase } = await import('@/lib/supabase/client');
    const supabase = getBrowserSupabase();
    expect(supabase).toBeDefined();
    expect(typeof supabase.auth.getUser).toBe('function');
  });

  it('falls back to legacy ANON_KEY when publishable is absent', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'old-anon-key';
    const { getBrowserSupabase } = await import('@/lib/supabase/client');
    const supabase = getBrowserSupabase();
    expect(supabase).toBeDefined();
    expect(typeof supabase.auth.getUser).toBe('function');
  });

  it('throws when URL is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_X';
    const { getBrowserSupabase } = await import('@/lib/supabase/client');
    expect(() => getBrowserSupabase()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('throws when both key vars are missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    const { getBrowserSupabase } = await import('@/lib/supabase/client');
    expect(() => getBrowserSupabase()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });
});
