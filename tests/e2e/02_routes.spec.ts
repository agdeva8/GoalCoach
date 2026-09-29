import { test, expect } from '@playwright/test';
import { applyCookiesToPage, captureStep, loginAsGuest, makeApi } from './helpers';

const ROUTES = ['/', '/coach', '/audit'] as const;

test.describe('navigation', () => {
  test('primary routes render without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await captureStep(page, `routes-${route.replace('/', 'root') || 'home'}`);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      expect(bodyText.length, `${route} should have rendered text`).toBeGreaterThan(0);
    }

    expect(consoleErrors, 'no console errors on primary routes').toEqual([]);
  });

  test('browser back/forward restores state', async ({ page }) => {
    await page.goto('/');
    await page.goto('/coach');
    await page.goto('/audit');

    await page.goBack();
    expect(page.url()).toContain('/coach');

    await page.goForward();
    expect(page.url()).toContain('/audit');
  });

  test('guest cookie auth unlocks protected UI', async ({ page, request }) => {
    const api = await makeApi();
    let session;
    try {
      session = await loginAsGuest(api);
    } finally {
      // keep api alive for cookie use; dispose in next step
    }
    if (!session) throw new Error('no session');

    await applyCookiesToPage(page, session);
    await page.goto('/audit');
    await captureStep(page, 'audit-as-guest');

    await api.dispose();
  });
});