import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureMessage = vi.fn();
const setTag = vi.fn();
const setExtra = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  captureMessage: (...args: any[]) => captureMessage(...args),
  withScope: (fn: any) =>
    fn({
      setTag: (...args: any[]) => setTag(...args),
      setExtra: (...args: any[]) => setExtra(...args),
    }),
}));

describe('sentry: llm_provider_selected', () => {
  beforeEach(() => {
    captureMessage.mockClear();
    setTag.mockClear();
    setExtra.mockClear();
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
  });

  it('emits llm_provider_selected with provider tag', async () => {
    const { reportProviderSelected } = await import('@/lib/sentry');
    reportProviderSelected('gemini');
    expect(captureMessage).toHaveBeenCalledOnce();
    expect(captureMessage.mock.calls[0][0]).toBe('llm_provider_selected');
    const tagNames = setTag.mock.calls.map((c) => c[0]);
    expect(tagNames).toContain('llm_provider');
    const tagValues = Object.fromEntries(setTag.mock.calls);
    expect(tagValues.llm_provider).toBe('gemini');
  });

  it('does not include any token-shaped string in the event payload', async () => {
    const { reportProviderSelected, redactToken } = await import('@/lib/sentry');
    const sensitive = 'ya29.a0AfH6SMBx-secret-access-token';
    const safe = redactToken(sensitive);
    expect(safe).not.toContain(sensitive);
    expect(safe).toMatch(/\[REDACTED\]/);

    reportProviderSelected('anthropic');
    const allSerialized = JSON.stringify({
      tags: setTag.mock.calls,
      extras: setExtra.mock.calls,
      message: captureMessage.mock.calls[0]?.[0],
    });
    expect(allSerialized).not.toContain(sensitive);
  });
});

describe('sentry: token_refresh_failed', () => {
  beforeEach(() => {
    captureMessage.mockClear();
    setTag.mockClear();
    setExtra.mockClear();
  });

  it('emits token_refresh_failed with userId and httpStatus tags only', async () => {
    const { reportTokenRefreshFailed } = await import('@/lib/sentry');
    reportTokenRefreshFailed({
      userId: 'u1',
      httpStatus: 400,
      code: 'refresh_failed',
    });
    expect(captureMessage).toHaveBeenCalledOnce();
    expect(captureMessage.mock.calls[0][0]).toBe('token_refresh_failed');
    const tagMap = Object.fromEntries(setTag.mock.calls);
    expect(tagMap.userId).toBe('u1');
    expect(tagMap.httpStatus).toBe('400');
    expect(tagMap.code).toBe('refresh_failed');
  });

  it('strips accessToken and refreshToken from the payload even if mistakenly included', async () => {
    const { reportTokenRefreshFailed } = await import('@/lib/sentry');
    reportTokenRefreshFailed({
      userId: 'u1',
      httpStatus: 400,
      code: 'refresh_failed',
      accessToken: 'secret-token-xyz',
      refreshToken: 'secret-refresh-xyz',
    } as any);
    const allSerialized = JSON.stringify({
      tags: setTag.mock.calls,
      extras: setExtra.mock.calls,
      message: captureMessage.mock.calls[0]?.[0],
    });
    expect(allSerialized).not.toContain('secret-token-xyz');
    expect(allSerialized).not.toContain('secret-refresh-xyz');
  });
});

describe('sentry: redactToken helper', () => {
  it('replaces the input with a placeholder', async () => {
    const { redactToken } = await import('@/lib/sentry');
    expect(redactToken('whatever')).toBe('[REDACTED]');
    expect(redactToken('')).toBe('[REDACTED]');
    expect(redactToken(undefined)).toBe('[REDACTED]');
  });
});
