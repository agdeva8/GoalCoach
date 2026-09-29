import { describe, it, expect } from 'vitest';
import { shouldWarnExpiry } from '@/lib/session-expiry';

describe('shouldWarnExpiry', () => {
  it('warns when less than 4h remain', () => {
    const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    expect(shouldWarnExpiry(future)).toBe(true);
  });
  it('does not warn when more than 4h remain', () => {
    const future = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
    expect(shouldWarnExpiry(future)).toBe(false);
  });
  it('warns when already expired', () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    expect(shouldWarnExpiry(past)).toBe(true);
  });
  it('does not warn when null', () => {
    expect(shouldWarnExpiry(null)).toBe(false);
  });
  it('does not warn when undefined', () => {
    expect(shouldWarnExpiry(undefined)).toBe(false);
  });
  it('does not warn when invalid date string', () => {
    expect(shouldWarnExpiry('not-a-date')).toBe(false);
  });
});
