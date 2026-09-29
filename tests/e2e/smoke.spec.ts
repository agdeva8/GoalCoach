import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Capture every console error / page error / failed network request so a single
 * failing spec can surface the same diagnostics the main browser-testing agent
 * would report by hand. This is the project's "browser-based testing is not
 * complete without these signals" floor.
 */
async function attachDiagnostics(page: Page, label: string) {
  const consoleErrors: { location: string; text: string }[] = [];
  const pageErrors: { message: string; stack?: string }[] = [];
  const failedRequests: { method: string; url: string; failure: string }[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      consoleErrors.push({
        location: msg.location().url,
        text: msg.text(),
      });
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push({ message: err.message, stack: err.stack });
  });
  page.on('requestfailed', (req) => {
    failedRequests.push({
      method: req.method(),
      url: req.url(),
      failure: req.failure()?.errorText ?? 'unknown',
    });
  });

  return {
    label,
    async snapshot() {
      return { consoleErrors, pageErrors, failedRequests };
    },
  };
}

test.describe('smoke — landing page (signed out)', () => {
  test('home renders the sign-in gate without console errors', async ({ page }) => {
    const diag = await attachDiagnostics(page, 'home-signed-out');

    const response = await page.goto('/');
    expect(response, 'GET / should return a response').not.toBeNull();
    expect(response!.status(), 'GET / should be 2xx or 3xx').toBeLessThan(400);

    await expect(
      page.getByRole('heading', { name: /think through your goals/i }),
    ).toBeVisible({ timeout: 10_000 });

    const signIn = page.getByTestId('sign-in-link');
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute('href', /\/api\/auth\/google/);

    const snap = await diag.snapshot();
    expect(
      snap.pageErrors,
      `pageerror during load: ${JSON.stringify(snap.pageErrors)}`,
    ).toEqual([]);
    expect(
      snap.consoleErrors,
      `console.error during load: ${snap.consoleErrors.map((e) => e.text).join(' | ')}`,
    ).toEqual([]);
  });

  test('home responds within SLA', async ({ page }) => {
    const t0 = Date.now();
    const resp = await page.goto('/', { waitUntil: 'domcontentloaded' });
    const ms = Date.now() - t0;

    expect(resp, 'expected a response from /').not.toBeNull();
    expect(resp!.status(), 'GET / should not 5xx').toBeLessThan(500);
    expect(ms, `cold load took ${ms}ms; expected < 5000`).toBeLessThan(5_000);
  });
});

test.describe('smoke — auth API surface reachable', () => {
  test('GET /api/auth/me returns 401 (or 200 with empty user) when signed out', async ({ request }) => {
    const resp = await request.get('/api/auth/me');
    expect(resp.status(), '/api/auth/me must be reachable').toBeLessThan(500);
    // Either 401 (no session) or 200 with null/empty user is acceptable.
    const body = await resp.json().catch(() => ({}));
    if (resp.status() === 200) {
      expect(body, '200 must have shape { user: null | object }').toHaveProperty('user');
    }
  });

  test('GET /api/auth/google returns a redirect or 4xx, never 5xx', async ({ request }) => {
    const resp = await request.get('/api/auth/google', { maxRedirects: 0 });
    // We only care that it's not a server crash.
    expect(resp.status()).toBeLessThan(500);
  });
});
