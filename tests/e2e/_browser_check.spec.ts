import { test, expect } from '@playwright/test';

const URL = process.env.E2E_BASE_URL ?? 'http://localhost:4001';

test('browser harness check @ desktop viewport', async ({ page }) => {
  const res = await page.goto(URL);
  expect(res?.status()).toBeLessThan(400);
  expect(await page.title()).toBeTruthy();
});

test('browser harness check @ mobile viewport', async ({ page }) => {
  const res = await page.goto(URL);
  expect(res?.status()).toBeLessThan(400);
});
