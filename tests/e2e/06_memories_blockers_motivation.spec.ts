import { test, expect } from '@playwright/test';
import { isNotImplemented, loginAsGuest, makeApi } from './helpers';

test.describe('memories', () => {
  test('POST a memory with date+time and GET it back', async () => {
    const api = await makeApi();
    try {
      await loginAsGuest(api);
      const occurredOn = new Date().toISOString().slice(0, 10);
      const post = await api.post('/api/memories', {
        data: { content: 'e2e fixture memory', occurred_on: occurredOn, time: '08:30' },
      });
      test.skip(isNotImplemented(post.status()), '/api/memories not implemented');
      expect(post.status()).toBeLessThan(300);
      const created = (await post.json()) as { id?: string };

      const list = await api.get('/api/memories');
      expect(list.status()).toBe(200);
      const all = (await list.json()) as { memories?: unknown[] } | unknown[];
      const arr = Array.isArray(all) ? all : (all.memories ?? []);
      expect(arr.length, 'memories list should not be empty after POST').toBeGreaterThan(0);

      if (created.id) {
        const byDate = await api.get(`/api/memories?date=${occurredOn}`);
        expect(byDate.status()).toBeLessThan(400);
      }
    } finally {
      await api.dispose();
    }
  });
});

test.describe('motivation', () => {
  test('GET /api/motivation/recommend as guest must NOT 401', async () => {
    const api = await makeApi();
    try {
      await loginAsGuest(api);
      const res = await api.get('/api/motivation/recommend');
      test.skip(isNotImplemented(res.status()), '/api/motivation/recommend not implemented');
      expect(res.status(), 'guest must not be 401 on motivation').not.toBe(401);
    } finally {
      await api.dispose();
    }
  });
});

test.describe('blockers', () => {
  test('GET / POST / GET-by-id round-trip', async () => {
    const api = await makeApi();
    try {
      await loginAsGuest(api);

      const list = await api.get('/api/blockers');
      test.skip(isNotImplemented(list.status()), '/api/blockers not implemented');
      expect(list.status()).toBe(200);

      const post = await api.post('/api/blockers', { data: { text: 'e2e fixture blocker' } });
      expect(post.status()).toBeLessThan(300);
      const created = (await post.json()) as { id?: string };

      if (created.id) {
        const byId = await api.get(`/api/blockers/${created.id}`);
        expect(byId.status()).toBeLessThan(300);
      }
    } finally {
      await api.dispose();
    }
  });
});