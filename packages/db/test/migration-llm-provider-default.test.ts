import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Pins the DB-state contract for Drift D1 ("Gemini only"): the users
// table's llm_provider column must default to 'gemini', and users who
// already have Gemini tokens must be backfilled off the old 'anthropic'
// default. Migration 0002 shipped `default 'anthropic'`, and Postgres
// applied that default to every row inserted without an explicit value
// (and backfilled existing rows at ADD COLUMN time), so without this
// migration the row-level check in resolveProvider outranks the
// application fallback and the flip is unreachable in production.
//
// This test reads the migration source rather than a live database: it
// pins the contract so a future contributor can't silently revert the
// default and re-break D1. Live-apply verification lives in the
// integration suites (test/rls-integration.test.ts).
const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/0008_llm_provider_gemini_default.sql'
);

// Whitespace-insensitive so reformatting the SQL doesn't break the pin.
function sql(): string {
  return readFileSync(MIGRATION_PATH, 'utf8').replace(/\s+/g, ' ');
}

describe('migration 0008: llm_provider defaults to gemini', () => {
  it('migration file exists', () => {
    expect(
      existsSync(MIGRATION_PATH),
      '0008_llm_provider_gemini_default.sql is missing'
    ).toBe(true);
  });

  it("flips the users.llm_provider column default to 'gemini'", () => {
    expect(sql()).toMatch(
      /alter table users alter column llm_provider set default 'gemini'/i
    );
  });

  it('backfills users that already hold Gemini tokens off the anthropic default', () => {
    expect(sql()).toMatch(
      /update users set llm_provider = 'gemini' where llm_provider = 'anthropic' and gemini_access_token is not null/i
    );
  });

  it('does not drop the anthropic|gemini check constraint', () => {
    // The backfill + default flip must leave the constraint from 0002
    // intact - both values stay legal (admin override, token fallback).
    expect(sql()).not.toMatch(/drop constraint/i);
  });
});
