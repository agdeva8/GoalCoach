/**
 * Emergent LLM streaming client.
 *
 * Standalone module (no `server-only` guard) so it can be imported by
 * scripts like `scripts/smoke-model.ts` that run outside the Next.js
 * server context. Next.js API routes use `streamChat` re-exported from
 * `lib/emergent/llm.ts` instead.
 */

import { SYSTEM_PROMPT } from '@/lib/llm/prompts'

import { getModel } from './model-registry'

import type { ProviderId } from './model-registry'

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_PROXY_URL = 'https://integrations.emergentagent.com'

function resolveProxyUrl(): string {
  const fromEnv = process.env.INTEGRATION_PROXY_URL?.trim()
  return (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_PROXY_URL)
}

function resolveApiKey(): string {
  const k = process.env.EMERGENT_LLM_KEY
  if (!k || k.length === 0) {
    throw new Error(
      'EMERGENT_LLM_KEY is not set. Required for Emergent LLM calls.',
    )
  }
  if (!k.startsWith('sk-emergent-')) {
    throw new Error(
      'EMERGENT_LLM_KEY must start with "sk-emergent-". Direct provider keys are rejected by the Emergent proxy.',
    )
  }
  return k
}

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
/*                                                                             */
/* Streaming chat completion against the Emergent proxy. Parses OpenAI-style */
/* SSE and yields `StreamEvent`s. The route handler maps these onto the     */
/* legacy `{ type: "delta" | "tools" | "done" | "error" }` SSE shape the    */
/* frontend already understands.                                             */
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
 * Streaming chat completion against the Emergent LLM proxy.
 *
 * Returns an `AsyncIterable<StreamEvent>` the chat route consumes to
 * build the SSE response. Throws on non-2xx — the route maps to
 * `{ type: "error", content }`.
 *
 * @example
 *   for await (const ev of streamChat({ provider: 'gemini', system, messages, sessionId })) {
 *     if (ev.type === 'text_delta') enqueue(`data: ${JSON.stringify({ type: 'delta', content: ev.content })}\n\n`)
 *     else if (ev.type === 'stream_done') enqueue(`data: ${JSON.stringify({ type: 'done', ... })}\n\n`)
 *   }
 */
export async function* streamChat(args: StreamChatArgs): AsyncIterable<StreamEvent> {
  const entry = getModel(args.provider)
  const apiKey = resolveApiKey()
  const proxy = resolveProxyUrl()

  // The proxy prefixes `gemini/` automatically based on the provider
  // field — we just pass the bare model name (matches
  // `emergentintegrations._buildCompletionParams`).
  const model = args.model ?? entry.model

  const url = `${proxy.replace(/\/$/, '')}/llm/chat/completions`

  // Prepend the system message to the messages array. The Emergent
  // proxy expects a single `system` OR system-as-first-message; using
  // a first-message system keeps the wire identical to the Python
  // `LlmChat(system_message=…)` flow.
  const wireMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: args.system || SYSTEM_PROMPT },
    ...args.messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  const body = JSON.stringify({
    model,
    messages: wireMessages,
    stream: true,
  })

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream',
      // Optional X-Session-ID for server-side session pinning. The
      // `sessionId` here is the goalcoach user_id (not Emergent's).
      'X-Session-ID': args.sessionId,
    },
    body,
    signal: args.signal,
    cache: 'no-store',
  })

  if (!resp.ok) {
    let detail = ''
    try {
      detail = await resp.text()
    } catch {
      /* ignore */
    }
    throw new Error(
      `Emergent LLM ${resp.status} ${resp.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
    )
  }

  if (!resp.body) {
    throw new Error('Emergent LLM returned empty response body')
  }

  // Parse SSE: `data: <json>\n\n` separated chunks. Multi-line
  // payloads are unusual for chat completions; we keep the simple
  // line-by-line parser.
  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Split on the SSE event boundary (`\n\n`). Anything left in
      // `buffer` after the last split is partial — keep it for the
      // next read.
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)

        const lines = raw.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') {
            yield { type: 'stream_done', content: full }
            return
          }
          let parsed: unknown
          try {
            parsed = JSON.parse(payload)
          } catch {
            // Malformed chunk — skip rather than crash the connection.
            continue
          }
          const delta = extractDelta(parsed)
          if (delta !== null) {
            full += delta
            yield { type: 'text_delta', content: delta }
          }
        }
      }
    }

    // Stream ended without [DONE] — still emit what we accumulated.
    if (buffer.length > 0) {
      const trimmed = buffer.trim()
      if (trimmed.startsWith('data:') && trimmed.slice(5).trim() !== '[DONE]') {
        try {
          const parsed = JSON.parse(trimmed.slice(5).trim())
          const delta = extractDelta(parsed)
          if (delta !== null) {
            full += delta
            yield { type: 'text_delta', content: delta }
          }
        } catch {
          /* ignore */
        }
      }
    }
    yield { type: 'stream_done', content: full }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pull the assistant text fragment out of an OpenAI-style chat
 * completion chunk. Returns `null` when the chunk carries no
 * assistant content (e.g. a final chunk that only sets
 * `finish_reason`).
 */
function extractDelta(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const choices = obj.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first = choices[0]
  if (!first || typeof first !== 'object') return null
  const delta = (first as Record<string, unknown>).delta
  if (!delta || typeof delta !== 'object') return null
  const content = (delta as Record<string, unknown>).content
  return typeof content === 'string' && content.length > 0 ? content : null
}
