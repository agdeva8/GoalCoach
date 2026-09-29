import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const initSpy = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  init: (...args: any[]) => initSpy(...args),
}));

describe('sentry init', () => {
  let originalDsn: string | undefined;

  beforeEach(() => {
    originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    initSpy.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
  });

  it('calls Sentry.init with DSN when set', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    const { initSentry } = await import('@/lib/sentry');
    initSentry();
    expect(initSpy).toHaveBeenCalledOnce();
    const opts = initSpy.mock.calls[0][0];
    expect(opts.dsn).toBe('https://public@example.ingest.sentry.io/1');
    expect(opts.tracesSampleRate).toBeCloseTo(0.1);
  });

  it('skips Sentry.init when DSN is missing', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const { initSentry } = await import('@/lib/sentry');
    initSentry();
    expect(initSpy).not.toHaveBeenCalled();
  });

  it('is idempotent across repeated calls', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    const { initSentry } = await import('@/lib/sentry');
    initSentry();
    initSentry();
    initSentry();
    expect(initSpy).toHaveBeenCalledOnce();
  });
});
