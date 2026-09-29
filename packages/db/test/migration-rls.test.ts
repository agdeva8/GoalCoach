import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/0001_init.sql'
);

const SCOPED_TABLES = ['users', 'goals', 'reflections', 'threads', 'feedback'];

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('migration: row level security', () => {
  it('enables RLS on every user-scoped table', () => {
    const sql = readMigration();
    for (const table of SCOPED_TABLES) {
      const pattern = new RegExp(
        `alter\\s+table\\s+${table}\\s+enable\\s+row\\s+level\\s+security`,
        'i'
      );
      expect(sql, `missing enable RLS on ${table}`).toMatch(pattern);
    }
  });

  it('defines a per-user policy on every user-scoped table', () => {
    const sql = readMigration();
    for (const table of SCOPED_TABLES) {
      // Each table needs at least one policy that scopes by auth.uid().
      // Match: create policy <name> on <table> ... auth.uid() = user_id
      const policyBlock = new RegExp(
        `create\\s+policy[\\s\\S]+on\\s+${table}[\\s\\S]+auth\\.uid\\(\\)\\s*=\\s*user_id`,
        'i'
      );
      expect(
        sql,
        `missing per-user policy on ${table}`
      ).toMatch(policyBlock);
    }
  });

  it('does not grant public schema access to anon role', () => {
    const sql = readMigration();
    // Belt-and-braces: even with RLS, granting ALL to anon would bypass.
    // We forbid any grant statement targeting `anon`.
    const grantToAnon = /grant[\s\S]+to\s+anon\b/i;
    expect(sql, 'unexpected GRANT to anon role').not.toMatch(grantToAnon);
  });
});
