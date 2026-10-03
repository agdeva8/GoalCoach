/**
 * LLM streaming transport — AI SDK `streamText`.
 *
 * Rewritten from the hand-rolled SSE parser to the Vercel AI SDK. The public
 * interface (`streamChat` → AsyncIterable<StreamEvent>) is IDENTICAL to before,
 * so every consumer (the general chat SSE route, tests, smoke scripts) is
 * migrated to the AI SDK with zero call-site changes. The `[[TOOLS]]`
 * text-block protocol is preserved (we stream text, not native tool calls).
 *
 * Standalone module (no `server-only` guard) so it can be imported by
 * scripts like `scripts/smoke-model.ts` that run outside the Next.js
 * server context.
 *
 * MVP routing is unchanged: DeepSeek when `DEEPSEEK_API_KEY` is set,
 * otherwise the Emergent proxy (`resolveBackend()`).
 */

import { streamText } from 'ai'

import { SYSTEM_PROMPT } from '@/lib/llm/prompts'
import { sutraChatModel } from '@/lib/llm/client'

import type { ProviderId } from './model-registry'

/* Re-exported for backward compatibility (was defined here before the split). */
export { resolveBackend } from './backend'

/* -------------------------------------------------------------------------- */
/* Stream event types                                                         */
/* -------------------------------------------------------------------------- */

/** A piece of assistant text. Append to the UI as it arrives. */
export interface TextDelta {
  type: 'text_delta'
  content: string
}

/** Fired exactly once at the end of the stream. */
export interface StreamDone {
  type: 'stream_done'
  /** Full accumulated assistant text (post-stream). */
  content: string
}

export type StreamEvent = TextDelta | StreamDone

/* -------------------------------------------------------------------------- */
/* Messages — minimal shape compatible with OpenAI's chat completion API.    */
/* -------------------------------------------------------------------------- */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/* -------------------------------------------------------------------------- */
/* streamChat                                                                 */
/* -------------------------------------------------------------------------- */

export interface StreamChatArgs {
  provider: ProviderId
  /** Optional override; otherwise `MODEL_REGISTRY[provider].model`. */
  model?: string
  /** Full system prompt — typically `SYSTEM_PROMPT + '\n\n=== LIVE STATE & MEMORY ===\n' + context`. */
  system: string
  /** Conversation history (oldest first, excluding the just-persisted user message). */
  messages: ChatMessage[]
  /** `user_id` — sent as the Emergent `session_id` for server-side session pinning. */
  sessionId: string
  /** Optional abort signal so the route can stop on client disconnect. */
  signal?: AbortSignal
}

/**
 * Streaming chat completion via the AI SDK, normalized to Sutra's
 * `StreamEvent` shape.
 *
 * Throws on stream error so the chat route can map it to an SSE `error`.
 *
 * @example
 *   for await (const ev of streamChat({ provider: 'gemini', system, messages, sessionId })) {
 *     if (ev.type === 'text_delta') enqueue(`data: ${JSON.stringify({ type: 'delta', content: ev.content })}\n\n`)
 *     else if (ev.type === 'stream_done') enqueue(`data: ${JSON.stringify({ type: 'done', ... })}\n\n`)
 *   }
 */
export async function* streamChat(args: StreamChatArgs): AsyncIterable<StreamEvent> {
  const model = sutraChatModel({ provider: args.provider, model: args.model })

  const wireMessages = args.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  let full = ''
  let onErrorValue: unknown = null

  const result = streamText({
    model,
    system: args.system || SYSTEM_PROMPT,
    messages: wireMessages,
    abortSignal: args.signal,
    headers: { 'X-Session-ID': args.sessionId },
    onError: ({ error }) => {
      onErrorValue = error
    },
  })

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      full += part.text
      yield { type: 'text_delta', content: part.text }
    } else if (part.type === 'error') {
      throw part.error
    } else if (part.type === 'abort') {
      break
    }
  }

  if (onErrorValue) throw onErrorValue

  yield { type: 'stream_done', content: full }
}
