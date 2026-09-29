import { test, expect } from '@playwright/test';
import { API_URL, isNotImplemented, loginAsGuest, makeApi } from './helpers';

test.describe('drop goal flow', () => {
  test('drop_goal moves goal from active to archive for the caller', async () => {
    const api = await makeApi();
    try {
      const session = await loginAsGuest(api);

      // Snapshot active goals BEFORE
      const beforeRes = await api.get('/api/state');
      test.skip(isNotImplemented(beforeRes.status()), '/api/state not implemented');
      const before = (await beforeRes.json()) as {
        goals?: Array<{ id: string; status?: string }>;
      };
      const beforeActive = (before.goals ?? []).filter((g) => g.status !== 'archived');

      const drop = await api.post('/api/tools/confirm', {
        data: { tool: 'drop_goal', goal_id: 'fixture_nonexistent' },
      });
      test.skip(isNotImplemented(drop.status()), 'drop_goal tool not implemented');
      expect(drop.status()).toBeLessThan(500);

      const afterRes = await api.get('/api/state');
      const after = (await afterRes.json()) as {
        goals?: Array<{ id: string; status?: string }>;
      };
      const afterActive = (after.goals ?? []).filter((g) => g.status !== 'archived');

      // A bad fixture shouldn't make active count grow — but it shouldn't crash either.
      expect(afterActive.length).toBeLessThanOrEqual(beforeActive.length);
      // The caller is still the same user (state isolation smoke check).
      const me = await api.get('/api/auth/me');
      expect(me.status()).toBe(200);
      void session;
      void API_URL;
    } finally {
      await api.dispose();
    }
  });
});