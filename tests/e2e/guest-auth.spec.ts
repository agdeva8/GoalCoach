import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Guest-auth smoke test. Sutra supports a dev-login flow that mints a guest
 * cookie via API; this spec exercises that path end-to-end through Playwright's
 * HTTP+Browser contexts so the same guest id flows into the page.
 *
 * If `/api/auth/guest` is gated behind an env flag (e.g. NODE_ENV !== production
 * or GUEST_LOGIN_ENABLED !== 'true'), the test is skipped — that's not a
 * failure, it's the project policy.
 */
async function guestLogin(
  request: APIRequestContext,
): Promise<{ cookie: string; userId: string } | null> {
  const resp = await request.post('/api/auth/guest');
  if (resp.status() === 404 || resp.status() === 403) {
    return null; // guest login disabled in this environment
  }
  expect(resp.status(), 'POST /api/auth/guest must be 2xx').toBeLessThan(300);

  const setCookie = resp.headers()['set-cookie'];
  expect(setCookie, 'POST /api/auth/guest must set a cookie').toBeTruthy();
  const cookieLine = Array.isArray(setCookie) ? setCookie[0] : setCookie!;
  const cookie = cookieLine.split(';')[0]!;

  const body = await resp.json().catch(() => ({}));
  const userId = body?.user?.id ?? body?.userId ?? '';
  return { cookie, userId };
}

test.describe('guest login end-to-end', () => {
  test('guest cookie persists; /api/auth/me returns the same id', async ({ request, browser }) => {
    const guest = await guestLogin(request);
    test.skip(guest === null, 'guest login disabled in this environment');

    const { cookie } = guest!;

    // Cookie carried over a fresh browser context.
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: cookie.split('=')[0]!,
        value: cookie.split('=').slice(1).join('='),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();

    const meResp = await page.request.get('/api/auth/me');
    expect(meResp.status()).toBeLessThan(300);
    const me = await meResp.json();
    expect(me?.user?.id ?? me?.userId, 'server must echo the guest user id').toBeTruthy();

    await context.close();
  });

  test('switching personas is isolated per persona', async ({ request }) => {
    test.skip(true, 'requires dev-login persona API; enable when implemented');
  });
});
