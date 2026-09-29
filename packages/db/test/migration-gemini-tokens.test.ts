import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/0002_gemini_tokens.sql'
);

describe('migration 0002: gemini tokens + llm_provider', () => {
  it('migration file exists', () => {
    expect(existsSync(MIGRATION_PATH), '0002_gemini_tokens.sql is missing').toBe(true);
  });

  function sql(): string {
    return readFileSync(MIGRATION_PATH, 'utf8');
  }

  it('adds gemini_access_token text column to users', () => {
    expect(sql()).toMatch(
      /alter\s+table\s+users\s+add\s+column\s+gemini_access_token\s+text/i
    );
  });

  it('adds gemini_refresh_token text column to users', () => {
    expect(sql()).toMatch(
      /alter\s+table\s+users\s+add\s+column\s+gemini_refresh_token\s+text/i
    );
  });

  it('adds gemini_token_expiry timestamptz column to users', () => {
    expect(sql()).toMatch(
      /alter\s+table\s+users\s+add\s+column\s+gemini_token_expiry\s+timestamptz/i
    );
  });

  it('adds llm_provider text column with anthropic|gemini check constraint and anthropic default', () => {
    const s = sql();
    expect(s).toMatch(
      /alter\s+table\s+users\s+add\s+column\s+llm_provider\s+text/i
    );
    expect(s).toMatch(/llm_provider[\s\S]+check[\s\S]+anthropic[\s\S]+gemini/i);
    expect(s).toMatch(/llm_provider[\s\S]+default\s+'anthropic'/i);
  });
});
