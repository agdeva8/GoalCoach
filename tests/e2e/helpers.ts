import { APIRequestContext, request as playwrightRequest, Page } from '@playwright/test';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

export type GuestSession = {
  api: APIRequestContext;
  userId: string;
  cookies: { name: string; value: string }[];
};

export async function makeApi(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: API_URL });
}

export async function loginAsGuest(api: APIRequestContext): Promise<GuestSession> {
  const res = await api.post('/api/auth/guest', { data: {} });
  if (!res.ok()) {
    throw new Error(`guest login failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { user?: { id?: string }; id?: string };
  const userId = body.user?.id ?? body.id ?? 'unknown';
  const state = await api.storageState();
  const cookies = state.cookies.map((c) => ({ name: c.name, value: c.value }));
  return { api, userId, cookies };
}

export async function applyCookiesToPage(page: Page, session: GuestSession): Promise<void> {
  const url = new URL(API_URL);
  await page.context().addCookies(
    session.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: url.hostname,
      path: '/',
      httpOnly: c.name.startsWith('__Host-') || c.name === 'session' || c.name === 'token',
      secure: url.protocol === 'https:',
      sameSite: 'Lax' as const,
    })),
  );
}

export async function authMe(api: APIRequestContext): Promise<{ status: number; body: unknown }> {
  const res = await api.get('/api/auth/me');
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status(), body };
}

export async function captureStep(page: Page, name: string): Promise<string> {
  const dir = 'tests/e2e/screenshots';
  const path = `${dir}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}

/**
 * SKIP when the API returns a clear "not implemented" signal — 404, 405, or 501.
 * Otherwise the test fails loudly so we never silently regress.
 */
export function isNotImplemented(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}