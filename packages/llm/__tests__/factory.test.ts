import { describe, it, expect, vi } from 'vitest';
import { createLLMClient } from '../src/factory';

describe('createLLMClient factory', () => {
  const mockSupabase = {} as any;
  const deps = {
    userId: 'user-1',
    supabase: mockSupabase,
    anthropicApiKey: 'sk-test',
  };

  it('returns a client with a send() method for provider=anthropic', () => {
    const client = createLLMClient({ provider: 'anthropic', ...deps });
    expect(client).toBeDefined();
    expect(typeof client.send).toBe('function');
  });

  it('returns a client with a send() method for provider=gemini', () => {
    const client = createLLMClient({ provider: 'gemini', ...deps });
    expect(client.send).toBeDefined();
    expect(typeof client.send).toBe('function');
  });

  it('throws on an unknown provider name', () => {
    expect(() =>
      createLLMClient({
        // @ts-expect-error - intentional bad input
        provider: 'openai',
        ...deps,
      })
    ).toThrow(/unknown provider/i);
  });
});
