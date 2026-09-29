import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('env validation', () => {
  let saved: Record<string, string | undefined> = {};
  const KEYS = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'ANTHROPIC_API_KEY',
    'NEXT_PUBLIC_SENTRY_DSN',
  ];

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('throws if any required env var is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    // NEXT_PUBLIC_SENTRY_DSN intentionally omitted (optional)
    const { assertEnv } = await import('@/lib/env');
    expect(() => assertEnv()).not.toThrow();
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    process.env.ANTHROPIC_API_KEY = 'sk';
    const { assertEnv } = await import('@/lib/env');
    expect(() => assertEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('throws when ANTHROPIC_API_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    const { assertEnv } = await import('@/lib/env');
    expect(() => assertEnv()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('returns parsed env when valid', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://pub@sentry.io/1';
    const { assertEnv } = await import('@/lib/env');
    const env = assertEnv();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://x.supabase.co');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBe('https://pub@sentry.io/1');
  });

  it('accepts new publishable/secret key names', async () => {
    // New Supabase convention (2024+): sb_publishable_/sb_secret_ instead
    // of anon/service_role. assertEnv() must accept either pair.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_x';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { assertEnv } = await import('@/lib/env');
    const env = assertEnv();
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('sb_publishable_x');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('sb_secret_x');
  });

  it('prefers publishable over anon when both set', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'old-anon';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'new-pub';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'old-svc';
    process.env.SUPABASE_SECRET_KEY = 'new-sec';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { assertEnv } = await import('@/lib/env');
    const env = assertEnv();
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('new-pub');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('new-sec');
  });
});
