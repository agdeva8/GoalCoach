/**
 * Browser-driven accessibility check using axe-core.
 *
 * Boots real Chromium, navigates to the landing page, runs the axe
 * WCAG 2.1 AA scan, and fails on any serious/critical violation.
 *
 * Run: pnpm test:e2e:a11y
 * Requires the dev servers on the canonical ports (4000/4001).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const URL = process.env.E2E_BASE_URL ?? 'http://localhost:4001';

test.describe('accessibility @ desktop viewport', () => {
  test('landing page passes axe WCAG 2.1 AA', async ({ page }) => {
    await page.goto(URL);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    if (blocking.length) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(blocking, null, 2));
    }
    expect(blocking, 'no serious/critical a11y violations on landing').toEqual([]);
  });
});