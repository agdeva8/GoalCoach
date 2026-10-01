import { createAnthropicClient } from './client-anthropic';
import { createGeminiClient } from './client-gemini';
import type { ClientDeps, LLMClient, Provider } from './types';

// Dispatch by provider. Throws on unknown names so misconfiguration fails
// loud at boot rather than silently selecting the wrong backend.
export function createLLMClient(deps: ClientDeps): LLMClient {
  const provider: Provider = deps.provider;
  switch (provider) {
    case 'anthropic':
      return createAnthropicClient(deps);
    case 'gemini':
      return createGeminiClient(deps);
    default: {
      const exhaustive: never = provider;
      throw new Error(`unknown provider: ${String(exhaustive)}`);
    }
  }
}
