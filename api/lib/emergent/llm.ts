/**
 * Emergent LLM REST client + tool-call text-block parser.
 *
 * Source of truth:
 *   - backend/server.py:606-773 (the SSE handler we are replacing)
 *   - migration/discovery/03-nextjs-architecture.md Section 4
 *
 * Endpoint discovery (the wheel isn't on PyPI; the source on jsDelivr
 * is the canonical reference):
 *
 *   POST  {INTEGRATION_PROXY_URL}/llm/chat/completions
 *        Headers: Authorization: Bearer sk-emergent-…
 *                 Content-Type: application/json
 *        Body:   OpenAI-compatible chat.completion.create params
 *                { model, messages, stream: true }
 *
 *   - `INTEGRATION_PROXY_URL` defaults to
 *     `https://integrations.emergentagent.com`.
 *   - Model strings: gemini uses `gemini/<model>` (e.g. `gemini/gemini-3-flash-preview`);
 *     openai / anthropic use the bare model name (e.g. `claude-sonnet-4-6`).
 *   - `EMERGENT_LLM_KEY` must start with `sk-emergent-` (the proxy rejects
 *     raw provider keys).
 *
 * Streaming shape — OpenAI-style SSE:
 *
 *   data: {"id":"…","choices":[{"delta":{"content":"…"}}]}
 *   data: {"id":"…","choices":[{"delta":{}], "finish_reason":"stop"}]}
 *   data: [DONE]
 *
 * We re-emit `TextDelta` events that the chat route transforms into
 * the legacy `data: {"type":"delta",...}` SSE shape the frontend
 * already understands.
 *
 * ----------------------------------------------------------------------
 * Tool-call protocol — `[[TOOLS]]…[[/TOOLS]]` text block (legacy)
 * ----------------------------------------------------------------------
 * The system prompt instructs the model to emit a JSON array of
 * proposal objects inside a fenced block. We port the Python
 * `parse_proposals` (server.py:566-594) verbatim so model behavior
 * stays byte-for-byte compatible with the legacy FastAPI surface.
 */

import 'server-only'

import type { ProviderId, ModelEntry, EmergentProvider } from './model-registry'
import { MODEL_REGISTRY, MODEL_OPTIONS, getModel } from './model-registry'

/* -------------------------------------------------------------------------- */
/* Provider model table — re-exported from model-registry.ts                 */
/* -------------------------------------------------------------------------- */

export type { ProviderId, ModelEntry, EmergentProvider }
export { MODEL_REGISTRY, MODEL_OPTIONS, getModel }

/* -------------------------------------------------------------------------- */
/* streamChat — re-exported from stream-chat.ts (has server-only guard)       */
/* -------------------------------------------------------------------------- */

export {
  streamChat,
  type TextDelta,
  type StreamDone,
  type StreamEvent,
  type ChatMessage,
  type StreamChatArgs,
} from './stream-chat'

/* -------------------------------------------------------------------------- */
/* Tool-call text-block parser — port of backend/server.py:566-594.          */
/* -------------------------------------------------------------------------- */

/**
 * Text-block markers the system prompt instructs the model to emit.
 * Match Python `TOOL_START = "[[TOOLS]]"` / `TOOL_END = "[[/TOOLS]]"`.
 */
export const TOOL_START = '[[TOOLS]]'
export const TOOL_END = '[[/TOOLS]]'

/**
 * One tool-call proposal extracted from a model response.
 *
 * Shape mirrors what `applyProposal` in `lib/proposal-executor.ts`
 * expects: `{ id, action, args, status }`. The `id` is assigned
 * server-side by `parseProposals` so the client never has to think
 * about it.
 */
export interface Proposal {
  id: string
  action: string
  args: Record<string, unknown>
  status: 'pending' | 'confirmed' | 'rejected'
  /** Result line, set after the user confirms via `/api/tools/confirm`. */
  result?: string | null
}

/**
 * Parse the `[[TOOLS]]…[[/TOOLS]]` block out of a full assistant
 * response and turn it into a list of `Proposal`s.
 *
 * 1. Splits on `TOOL_START` / `TOOL_END` to isolate the JSON array.
 * 2. Tries `json.loads` directly; if that fails (model may have
 *    wrapped in prose), falls back to the first `[` … last `]`.
 * 3. Wraps a single-object dict in an array.
 * 5. Assigns a fresh `prop_<hex12>` id and a `pending` status to
 *    each proposal; everything else from the JSON object becomes
 *    `args` (dropping `id`/`action`/`status`/`result`).
 *
 * Verbatim port of `parse_proposals` from `backend/server.py:566-594`
 * so the model output stays byte-for-byte compatible.
 */
export function parseProposals(full: string): Proposal[] {
  if (!full.includes(TOOL_START)) return []
  let tail = full.split(TOOL_START, 1)[1] ?? ''
  tail = tail.split(TOOL_END, 1)[0].trim()
  if (!tail) return []

  let data: unknown = null
  try {
    data = JSON.parse(tail)
  } catch {
    // The model may have wrapped the array in prose. Pull the first
    // `[` and the last `]` and try again.
    const start = tail.indexOf('[')
    const end = tail.lastIndexOf(']')
    if (start !== -1 && end !== -1 && end > start) {
      try {
        data = JSON.parse(tail.slice(start, end + 1))
      } catch {
        data = null
      }
    }
  }
  if (data === null || data === undefined) return []

  const arr = Array.isArray(data) ? data : [data]
  const out: Proposal[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const action = obj.action
    if (typeof action !== 'string' || action.length === 0) continue

    const { id: _id, action: _a, status: _s, result: _r, ...rest } = obj
    out.push({
      id: newPropId(),
      action,
      args: (rest ?? {}) as Record<string, unknown>,
      status: 'pending',
    })
  }
  return out
}

function newPropId(): string {
  // Same shape as `backend/server.py:54` `new_id("prop")` — uses
  // crypto.randomUUID (Node 19+).
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `prop_${hex}`
}

/**
 * Split an assistant turn into the prose-before-tools and the
 * tool-block. Mirrors the Python `prose = full.split(TOOL_START,
 * 1)[0].strip() if in_tools else full.strip()` (server.py:685).
 */
export function splitProseAndTools(full: string): {
  prose: string
  proposals: Proposal[]
} {
  const proposals = parseProposals(full)
  let prose: string
  if (full.includes(TOOL_START)) {
    prose = full.split(TOOL_START, 1)[0].trim()
  } else {
    prose = full.trim()
  }
  return { prose, proposals }
}