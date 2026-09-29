import { describe, it, expect, vi, beforeEach } from 'vitest';

const registerSpy = vi.fn();
vi.mock('@vercel/otel', () => ({
  registerOTel: (...args: any[]) => registerSpy(...args),
}));

describe('otel init', () => {
  beforeEach(() => {
    registerSpy.mockClear();
    vi.resetModules();
  });

  it('registers OTel with the goalcoach service name', async () => {
    const { registerOtel } = await import('@/lib/otel');
    registerOtel();
    expect(registerSpy).toHaveBeenCalledOnce();
    const opts = registerSpy.mock.calls[0][0];
    expect(opts.serviceName).toBe('goalcoach-web');
  });

  it('is idempotent across repeated calls', async () => {
    const { registerOtel } = await import('@/lib/otel');
    registerOtel();
    registerOtel();
    registerOtel();
    expect(registerSpy).toHaveBeenCalledOnce();
  });
});
