// Sibling test file to env.test.ts — covers the new Gemini env vars
// and the paired validation required by the DX review (CEO obligation
// chain). The existing env.test.ts covers Supabase + Anthropic; we add
// Gemini-specific behavior here so the diff is readable.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'LLM_PROVIDER',
  'GOOGLE_GEMINI_CLIENT_ID',
  'GOOGLE_GEMINI_CLIENT_SECRET',
];

describe('env validation: Gemini paired keys', () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    // Set the bare minimum for assertEnv to not throw on missing
    // Supabase/Anthropic; we are only testing the Gemini pair logic.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    process.env.ANTHROPIC_API_KEY = 'sk';
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('accepts both GOOGLE_GEMINI_CLIENT_ID and SECRET set together', async () => {
    process.env.GOOGLE_GEMINI_CLIENT_ID = 'cid';
    process.env.GOOGLE_GEMINI_CLIENT_SECRET = 'csec';
    process.env.LLM_PROVIDER = 'gemini';
    const { assertEnv } = await import('@/lib/env');
    expect(() => assertEnv()).not.toThrow();
  });

  it('accepts both Gemini vars unset', async () => {
    delete process.env.GOOGLE_GEMINI_CLIENT_ID;
    delete process.env.GOOGLE_GEMINI_CLIENT_SECRET;
    const { assertEnv } = await import('@/lib/env');
    expect(() => assertEnv()).not.toThrow();
  });

  it('throws when only GOOGLE_GEMINI_CLIENT_ID is set', async () => {
    process.env.GOOGLE_GEMINI_CLIENT_ID = 'cid';
    delete process.env.GOOGLE_GEMINI_CLIENT_SECRET;
    const { assertEnv } = await import('@/lib/env');
    expect(() => assertEnv()).toThrow(/GOOGLE_GEMINI_CLIENT_ID.*SECRET|paired/);
  });

  it('throws when only GOOGLE_GEMINI_CLIENT_SECRET is set', async () => {
    delete process.env.GOOGLE_GEMINI_CLIENT_ID;
    process.env.GOOGLE_GEMINI_CLIENT_SECRET = 'csec';
    const { assertEnv } = await import('@/lib/env');
    expect(() => assertEnv()).toThrow(/GOOGLE_GEMINI_CLIENT_ID.*SECRET|paired/);
  });

  it('exposes LLM_PROVIDER, GOOGLE_GEMINI_CLIENT_ID, GOOGLE_GEMINI_CLIENT_SECRET on the returned env', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.GOOGLE_GEMINI_CLIENT_ID = 'cid';
    process.env.GOOGLE_GEMINI_CLIENT_SECRET = 'csec';
    const { assertEnv } = await import('@/lib/env');
    const env = assertEnv();
    expect(env.LLM_PROVIDER).toBe('gemini');
    expect(env.GOOGLE_GEMINI_CLIENT_ID).toBe('cid');
    expect(env.GOOGLE_GEMINI_CLIENT_SECRET).toBe('csec');
  });

  it('treats LLM_PROVIDER unset as an empty string (retained, no effect on resolution)', async () => {
    delete process.env.LLM_PROVIDER;
    const { assertEnv } = await import('@/lib/env');
    const env = assertEnv();
    // Retained for backwards compatibility only. Provider resolution is
    // now row > 'gemini' default (see lib/llm-provider and migration
    // 0008); nothing maps this value to a provider any more.
    expect(env.LLM_PROVIDER).toBe('');
  });
});
