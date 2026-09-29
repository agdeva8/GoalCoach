import { test, expect } from '@playwright/test';
import { API_URL, makeApi, authMe } from './helpers';

test.describe('smoke', () => {
  test('API root responds and UI renders', async ({ page, request }) => {
    const apiResp = await request.get(API_URL);
    expect(apiResp.status(), `API at ${API_URL} should respond`).toBeLessThan(500);

    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
  });

  test('guest login round-trips identity through /api/auth/me', async () => {
    const api = await makeApi();
    try {
      const login = await api.post('/api/auth/guest', { data: {} });
      expect(login.ok(), 'POST /api/auth/guest should succeed').toBeTruthy();

      const me = await authMe(api);
      expect(me.status, '/api/auth/me after guest login').toBe(200);
      const body = me.body as { user?: { id?: string }; id?: string };
      const id = body?.user?.id ?? body?.id;
      expect(id, '/api/auth/me should return an id').toBeTruthy();
    } finally {
      await api.dispose();
    }
  });
});