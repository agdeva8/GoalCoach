import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Migration 0003: GRANT table-level privileges so RLS policies can be
// evaluated. Without these GRANTs, PostgREST returns 42501
// "permission denied for table X" before RLS even gets a look — even for
// the authenticated role with a valid JWT. The hint in that error
// ("Grant the required privileges ... TO authenticated") is the symptom.
const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/0003_grants.sql'
);

const SCOPED_TABLES = ['users', 'goals', 'reflections', 'threads', 'feedback'];

describe('migration 0003: table-level grants', () => {
  it('migration file exists', () => {
    expect(existsSync(MIGRATION_PATH), '0003_grants.sql is missing — see /api/chat 500 in dev log').toBe(true);
  });

  function sql(): string {
    return readFileSync(MIGRATION_PATH, 'utf8');
  }

  it('grants SELECT, INSERT, UPDATE, DELETE to authenticated on every user-scoped table', () => {
    const s = sql();
    for (const table of SCOPED_TABLES) {
      const pattern = new RegExp(
        `grant\\s+select,\\s*insert,\\s*update,\\s*delete\\s+on\\s+(public\\.)?${table}\\s+to\\s+authenticated`,
        'i'
      );
      expect(s, `missing grant to authenticated on ${table}`).toMatch(pattern);
    }
  });

  it('grants USAGE on public schema to authenticated and anon', () => {
    const s = sql();
    // USAGE on the schema is needed before any table grant takes effect
    expect(s).toMatch(/grant\s+usage\s+on\s+schema\s+public\s+to\s+authenticated/i);
    expect(s).toMatch(/grant\s+usage\s+on\s+schema\s+public\s+to\s+anon/i);
  });

  it('grants ALL to service_role on every user-scoped table', () => {
    const s = sql();
    for (const table of SCOPED_TABLES) {
      const pattern = new RegExp(
        `grant\\s+all\\s+on\\s+(public\\.)?${table}\\s+to\\s+service_role`,
        'i'
      );
      expect(s, `missing grant to service_role on ${table}`).toMatch(pattern);
    }
  });
});
