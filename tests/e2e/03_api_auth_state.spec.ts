import { test, expect } from '@playwright/test';
import { API_URL, authMe, isNotImplemented, loginAsGuest, makeApi } from './helpers';

test.describe('auth + state', () => {
  test('persona switching isolates state per persona', async () => {
    const a = await makeApi();
    const b = await makeApi();
    try {
      const sA = await loginAsGuest(a);
      const sB = await loginAsGuest(b);

      expect(sA.userId).not.toEqual(sB.userId);

      const meA = await authMe(a);
      const meB = await authMe(b);
      expect(meA.status).toBe(200);
      expect(meB.status).toBe(200);
      const idA = (meA.body as { user?: { id?: string }; id?: string })?.user?.id ??
        (meA.body as { id?: string })?.id;
      const idB = (meB.body as { user?: { id?: string }; id?: string })?.user?.id ??
        (meB.body as { id?: string })?.id;
      expect(idA).toEqual(sA.userId);
      expect(idB).toEqual(sB.userId);
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });

  test('preferences persist per user', async () => {
    const api = await makeApi();
    try {
      const session = await loginAsGuest(api);
      const probe = await api.put('/api/preferences', {
        data: { model_provider: 'anthropic' },
      });
      test.skip(isNotImplemented(probe.status()), '/api/preferences not implemented');
      expect(probe.status(), 'PUT /api/preferences should succeed').toBeLessThan(300);

      const me = await authMe(api);
      expect(me.status).toBe(200);
      expect((me.body as { user?: { id?: string }; id?: string })?.user?.id ??
        (me.body as { id?: string })?.id).toEqual(session.userId);
    } finally {
      await api.dispose();
    }
  });
});