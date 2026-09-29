import { describe, it, expect, vi } from 'vitest';
import { isLowQualityResponse } from '@/lib/quality';

describe('isLowQualityResponse', () => {
  it('flags short responses (<40 chars)', () => {
    expect(isLowQualityResponse('Sure.')).toBe(true);
    expect(isLowQualityResponse('OK')).toBe(true);
  });

  it('flags generic "as an ai" responses', () => {
    expect(isLowQualityResponse('As an AI, I cannot help with that request.')).toBe(true);
  });

  it('flags "i am an ai" variant', () => {
    expect(isLowQualityResponse("I'm an AI assistant and don't have personal opinions.")).toBe(true);
  });

  it('flags dismissive "i cannot help"', () => {
    expect(isLowQualityResponse("I cannot help with that. Please rephrase your question.")).toBe(true);
  });

  it('passes substantive response', () => {
    expect(
      isLowQualityResponse(
        'You said you want to ship phase 1 by Friday. The smallest thing you could finish today is the auth middleware.'
      )
    ).toBe(false);
  });

  it('trims whitespace before checking length', () => {
    expect(isLowQualityResponse('   short   ')).toBe(true);
  });
});
