import Anthropic from '@anthropic-ai/sdk';
import type { ClientDeps, ClientMessage, LLMClient, StreamEvent, ToolSpec } from './types';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
const MAX_TOKENS = 1024;

// Translates the Anthropic SDK's async-iterable event stream into the
// provider-agnostic StreamEvent shape used by the chat route. Mirrors
// the inline logic that used to live in apps/web/app/api/chat/route.ts
// before this package was extracted.
export function createAnthropicClient(deps: ClientDeps): LLMClient {
  if (!deps.anthropicApiKey) {
    throw new Error('anthropicApiKey is required for provider=anthropic');
  }
  const anthropic = new Anthropic({ apiKey: deps.anthropicApiKey });

  return {
    async *send(messages: ClientMessage[], tools: ToolSpec[]): AsyncIterable<StreamEvent> {
      // Tracks whether we've already streamed a real event. If a throw
      // happens AFTER we have streamed, it's almost certainly an SDK
      // iterator-cleanup error (the Anthropic `messages.stream` async
      // iterable can throw on `.return()` after `message_stop`), not a
      // request failure. Surfacing it as `error` produces a spurious red
      // "Internal error" alert under every successful chat reply (regression
      // caught by /qa 2026-09-23).
      let emittedAny = false;

      try {
        const stream = await anthropic.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          // No system prompt at this layer — the chat route owns context
          // assembly (goals, recent threads) and prepends its own system
          // text by appending to messages. Keeping the client dumb avoids
          // duplicating Sutra-specific prompt logic here.
          tools: tools as any,
          messages: messages as any,
        });

        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            (event as any).delta?.type === 'text_delta'
          ) {
            emittedAny = true;
            yield { type: 'text', text: (event as any).delta.text };
          } else if (
            event.type === 'content_block_start' &&
            (event as any).content_block?.type === 'tool_use'
          ) {
            emittedAny = true;
            const cb = (event as any).content_block;
            yield { type: 'tool_use', id: cb.id, name: cb.name, input: cb.input };
          }
        }
        yield { type: 'done' };
      } catch (_err) {
        // Cleanup-only error: we already streamed something to the user,
        // so reporting `error` would contradict the partial response.
        // Emit `done` so the chat route can persist the partial turn.
        if (emittedAny) {
          yield { type: 'done' };
          return;
        }
        // True request failure (no events streamed yet) — internal error
        // details must not leak to the client.
        yield { type: 'error', message: 'Internal error' };
      }
    },
  };
}
