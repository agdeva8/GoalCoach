/**
 * Integration test for the table-level GRANT bug that was making
 * /api/chat return 500.
 *
 * What this test does:
 *   1. Spins up a transaction against a real Postgres with the
 *      Supabase auth schema and the project's migrations applied.
 *   2. Sets the `request.jwt.claims` to simulate an authenticated
 *      request from a known user (this is what PostgREST does when
 *      it forwards the user's JWT).
 *   3. Calls appendThread() and getRecentThreads() — the same
 *      functions /api/chat uses — and confirms the rows round-trip.
 *
 * Without the GRANTs in 0003_grants.sql, the INSERT/SELECT in
 * step 3 returns `permission denied for table threads` (42501).
 * With the GRANTs, it succeeds.
 *
 * Skipped if POSTGRES_URL is not set. Set it to a Supabase-shaped
 * Postgres (auth schema + project migrations applied) to run.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';

const PG_URL = process.env.POSTGRES_URL;

const describeIf = PG_URL ? describe : describe.skip;

describeIf('RLS integration: appendThread + getRecentThreads', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const otherUserId = '22222222-2222-2222-2222-222222222222';
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: PG_URL });
    await client.connect();

    // Seed two users in auth.users (RLS reads auth.uid() from here)
    await client.query(
      `insert into auth.users (id, email) values
        ($1, 'rls-test@sutra.local'),
        ($2, 'rls-other@sutra.local')
       on conflict (id) do nothing`,
      [userId, otherUserId]
    );
    // Seed matching public.users rows so users_self RLS allows it
    await client.query(
      `insert into public.users (id, email) values
        ($1, 'rls-test@sutra.local'),
        ($2, 'rls-other@sutra.local')
       on conflict (id) do nothing`,
      [userId, otherUserId]
    );
    // Clear any prior test rows
    await client.query(`delete from public.threads where user_id in ($1, $2)`, [userId, otherUserId]);
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  async function asUser(uid: string, fn: () => Promise<void>) {
    await client.query('begin');
    try {
      // PostgREST sets `request.jwt.claims` to the full JWT JSON AND
      // `request.jwt.claim.sub` to the sub claim specifically. Supabase's
      // auth.uid() reads the singular form. Set both so we don't depend
      // on which PostgREST version is running.
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ]);
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
      // SET ROLE so GRANT/RLS checks fire — superuser bypasses both.
      await client.query(`set local role authenticated`);
      await fn();
    } finally {
      await client.query('rollback');
    }
  }

  it('authenticated user can appendThread (insert into threads)', async () => {
    const { appendThread } = await import('../src/queries');
    // Build a supabase client from this pg client so we can call appendThread
    const { appendThreadViaPg } = await import('./helpers/supabase-from-pg');
    await asUser(userId, async () => {
      const row = await appendThreadViaPg(client, appendThread, userId, 'user', 'hello world');
      expect(row.user_id).toBe(userId);
      expect(row.role).toBe('user');
      expect(row.content).toBe('hello world');
    });
  });

  it('authenticated user can read back getRecentThreads (select from threads)', async () => {
    const { getRecentThreads } = await import('../src/queries');
    const { getRecentThreadsViaPg } = await import('./helpers/supabase-from-pg');
    // Seed a row as the user
    await client.query(
      `insert into public.threads (user_id, role, content) values ($1, 'assistant', 'reply text')`,
      [userId]
    );
    await asUser(userId, async () => {
      const rows = await getRecentThreadsViaPg(client, getRecentThreads, userId, 10);
      const mine = rows.filter((r) => r.user_id === userId);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.some((r) => r.content === 'reply text')).toBe(true);
    });
  });

  it("RLS denies another user's threads (auth.uid() filter)", async () => {
    const { getRecentThreads } = await import('../src/queries');
    const { getRecentThreadsViaPg } = await import('./helpers/supabase-from-pg');
    // otherUser has their own row
    await client.query(
      `insert into public.threads (user_id, role, content) values ($1, 'user', 'private to other')`,
      [otherUserId]
    );
    // Reading as user 1 — should NOT see user 2's row
    await asUser(userId, async () => {
      const rows = await getRecentThreadsViaPg(client, getRecentThreads, userId, 100);
      expect(rows.some((r) => r.user_id === otherUserId)).toBe(false);
    });
  });
});
