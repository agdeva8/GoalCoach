import { defineConfig, devices } from '@playwright/test';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:4001';

export default defineConfig({
  // Real e2e specs live under tests/e2e (alongside helpers.ts).
  // The other './e2e/' would collide if anyone forgets to clean up.
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test_reports/e2e-results.json' }],
    ['html', { outputFolder: 'test_reports/e2e-html', open: 'never' }],
  ],
  outputDir: 'test_reports/e2e-artifacts',
  use: {
    baseURL: FRONTEND,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 800 } },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } },
    },
  ],
  expect: {
    timeout: 5_000,
  },
});