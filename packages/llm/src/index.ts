// Server-only boundary. Any client-component import of @goalcoach/llm will
// fail at build time with a clear error from the `server-only` package.
// Runtime tokens (Anthropic API key, Gemini OAuth tokens) must never reach
// the browser bundle.
import 'server-only';

export type {
  StreamEvent,
  Provider,
  LLMClient,
  ClientDeps,
  ClientMessage,
  ToolSpec,
} from './types';
export { createLLMClient } from './factory';
