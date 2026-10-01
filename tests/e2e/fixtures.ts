/**
 * Shared Playwright fixtures for Sutra e2e tests.
 *
 * - `api`    — an APIRequestContext pointed at E2E_API_URL (default 4000),
 *              already logged in as a fresh guest. Specs that need a clean
 *              unauthenticated context should use `makeApi()` from helpers.
 * - `guestPage` — a Chromium Page with the guest cookie applied so the UI
 *                  doesn't trip the sign-in modal. Uses E2E_BASE_URL (4001).
 *
 * Override the URLs via env: E2E_BASE_URL / E2E_API_URL. Set
 * E2E_NO_WEBSERVER=1 when running against an already-started dev server.
 */
import {
  test as base,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4001';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

export async function makeApi(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: API_URL });
}

export async function loginAsGuest(api: APIRequestContext): Promise<{
  userId: string;
  cookieHeader: string | null;
}> {
  const res = await api.post('/api/auth/guest', { data: {} });
  if (!res.ok()) {
    throw new Error(`guest login failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json().catch(() => ({}))) as {
    user?: { id?: string };
    id?: string;
  };
  const userId = body.user?.id ?? body.id ?? 'unknown';
  const setCookie = res.headers()['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie ?? null;
  return { userId, cookieHeader };
}

function parseCookie(header: string | null): { name: string; value: string } | null {
  if (!header) return null;
  const first = header.split(';')[0] ?? '';
  const eq = first.indexOf('=');
  if (eq < 0) return null;
  return { name: first.slice(0, eq), value: first.slice(eq + 1) };
}

export type Fixtures = {
  api: APIRequestContext;
  guestPage: Page;
};

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const ctx = await makeApi();
    await loginAsGuest(ctx);
    await use(ctx);
    await ctx.dispose();
  },

  guestPage: async ({ browser }, use) => {
    // Pre-mint a guest cookie via the API so the page has it before any UI load.
    const mint = await playwrightRequest.newContext({ baseURL: API_URL });
    const { cookieHeader } = await loginAsGuest(mint);
    const cookie = parseCookie(cookieHeader);
    await mint.dispose();

    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 800 },
    });
    if (cookie) {
      const host = new URL(API_URL).hostname;
      await ctx.addCookies([
        {
          name: cookie.name,
          value: cookie.value,
          domain: host,
          path: '/',
          httpOnly: cookie.name.startsWith('__Host-') || cookie.name === 'session',
          secure: API_URL.startsWith('https:'),
          sameSite: 'Lax',
        },
      ]);
    }
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
});

export { expect };