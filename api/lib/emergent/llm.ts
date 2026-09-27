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
  // Split with a high limit so we always get the chunk AFTER the first
  // TOOL_START at index [1]. `split(sep, 1)` would cap the result array
  // at one element and break this — pre-existing latent bug.
  let tail = full.split(TOOL_START, 2)[1] ?? ''
  tail = tail.split(TOOL_END, 2)[0].trim()
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

    // Phase 1 — drop-verb guard. The structured-proposal parser is the
    // last gatekeeper before a write reaches the executor. Earlier we
    // saw the LLM emit `create_goal` with title `Drop "Get healthier"`,
    // which produced a meta-goal instead of dropping the real one.
    // Reject at parse time: any `create_goal` whose title begins with a
    // drop/pause/delete verb is silently dropped. The deterministic
    // fallback in chat/stream/route.ts already calls `parseDropIntent`
    // first, so the user still gets the correct drop proposal.
    if (action === 'create_goal') {
      const title = (rest as Record<string, unknown> | undefined)?.title
      if (typeof title === 'string' && looksLikeDropIntent(title)) {
        continue
      }
    }

    out.push({
      id: newPropId(),
      action,
      args: (rest ?? {}) as Record<string, unknown>,
      status: 'pending',
    })
  }
  return out
}

/**
 * Returns true when `text` begins with a drop/pause/delete verb (case-
 * insensitive, ignoring leading punctuation/whitespace). Used by the
 * parser guard to reject meta-goals whose title encodes an intent that
 * the proposal's `action` field doesn't match. Exported for unit tests
 * (see `__tests__/parse-proposals.test.ts`).
 */
export function looksLikeDropIntent(text: unknown): boolean {
  if (typeof text !== 'string') return false
  const t = text.trim().toLowerCase()
  return /^(drop|delete|remove|pause|stop|trash|archive|abandon|kill)\b/.test(t)
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
    prose = full.split(TOOL_START, 2)[0].trim()
  } else {
    prose = full.trim()
  }
  return { prose, proposals }
}

/* -------------------------------------------------------------------------- */
/* Deterministic propose-from-text helper                                      */
/*                                                                             */
/// When auto-answer is on and the model + the followup both fail to emit
// any [[TOOLS]] block, the chat route falls through to this helper to
// produce ONE `create_goal` proposal derived directly from the user's
// message. This is the "hard pass" behind the LLM's "soft pass" — the
// user is always offered a confirmable proposal when they express a
// goal in plain text, even if the model goes off-script.
//                                                                             */
/* Why this lives here (not in the chat route):                                */
/*   - Reusable for any future endpoint that needs to surface a goal            */
/*     proposal without an LLM pass (e.g. a future "Add goal" quick-action       */
/*     that bypasses the chat).                                                 */
/*   - Keeps `chat/stream/route.ts` focused on SSE plumbing.                    */
/*   - Pure: no IO, easy to unit-test.                                         */
/*                                                                             */
/* Heuristics (intentionally conservative — false negatives are better than    */
/* false positives here; a bad proposal in front of the user is worse than     */
/* asking a clarifying question, which the chat route already does):            */
/*   1. The user's message must strongly look like a goal-introduction       */
/*      ("i want to learn X", "i'd like to ship Y", "my goal is to Z",      */
/*      "set up a goal to W", or starts with verbs like learn/build/start).   */
/*   2. Length window so we don't fire on a 4-word "yes" or an essay.         */
/*   3. Title comes from the noun phrase after the leading verb, normalized  */
/*      to sentence case, capped at 80 chars.                                  */
/*   4. Horizon picked from a few temporal keywords; default `short`.         */
/*   5. Target date picked from "in N days/weeks/months/years" or             */
/*      "by <month|year>"; otherwise today + 90 days.                         */
/* -------------------------------------------------------------------------- */

const GOAL_INTRO_PATTERNS: RegExp[] = [
  /^(?:i\s+(?:want|wanna|would\s+like|need|'d\s+like)\s+to)\s+(.+?)\.?$/i,
  /^(?:my\s+goal\s+is\s+to)\s+(.+?)\.?$/i,
  /^(?:let(?:'s|s)\s+(?:set\s+up\s+a?\s*goal\s+to|add\s+a?\s*goal\s+to))\s+(.+?)\.?$/i,
  /^(?:i\s+want)\s+(.+?)\.?$/i,
  /^(?:i'm\s+going\s+to)\s+(.+?)\.?$/i,
  /^(?:i\s+plan\s+to)\s+(.+?)\.?$/i,
  /^(?:i'?d\s+like\s+to)\s+(.+?)\.?$/i,
]

const GOAL_VERB_STARTERS: RegExp[] = [
  /^(learn|build|ship|launch|start|finish|complete|set\s+up|pick\s+up|get\s+better\s+at|get\s+into|write|read|run|study|practice|train|exercise|lose|gain|reach|hit|complete)\s+(.+?)\.?$/i,
]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoPlusDays(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

function isoEndOfYear(year: number): string {
  return `${year}-12-31`
}

function isoEndOfMonth(year: number, month0: number): string {
  // month0 is 0-indexed; day 0 of the next month == last day of this one.
  return new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10)
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
}

/**
 * Pull a target_date out of the user's message. Conservative: returns
 * null when nothing parses cleanly so the caller can fall back to its
 * default anchor.
 */
function extractTargetDate(text: string): string | null {
  const lower = text.toLowerCase()

  // "by <month>" or "by <month> <year>"
  const byMonth = lower.match(/\bby\s+(?:end\s+of\s+)?([a-z]+)(?:\s+(\d{4}))?\b/)
  if (byMonth) {
    const monthName = byMonth[1]
    const year = byMonth[2] ? Number(byMonth[2]) : new Date().getUTCFullYear()
    const month0 = MONTHS[monthName]
    if (typeof month0 === 'number') return isoEndOfMonth(year, month0)
  }

  // "by <year>"
  const byYear = lower.match(/\bby\s+(\d{4})\b/)
  if (byYear) {
    const y = Number(byYear[1])
    if (y >= new Date().getUTCFullYear() && y <= new Date().getUTCFullYear() + 10) {
      return isoEndOfYear(y)
    }
  }

  // "in 90 days" / "in 12 weeks" / "in 6 months" / "in 2 years"
  const inN = lower.match(/\bin\s+(\d+)\s+(day|week|month|year)s?\b/)
  if (inN) {
    const n = Number(inN[1])
    const unit = inN[2]
    if (unit === 'day') return isoPlusDays(Math.max(1, Math.min(n, 365 * 5)))
    if (unit === 'week') return isoPlusDays(Math.max(7, Math.min(n * 7, 365 * 5)))
    if (unit === 'month') return isoPlusDays(Math.max(30, Math.min(n * 30, 365 * 10)))
    if (unit === 'year') return isoPlusDays(Math.max(365, Math.min(n * 365, 365 * 10)))
  }

  // "this quarter" / "this month" / "this year" / "next month"
  if (/\bthis\s+quarter\b/.test(lower)) {
    const d = new Date()
    const q = Math.floor(d.getUTCMonth() / 3)
    return isoEndOfMonth(d.getUTCFullYear(), q * 3 + 2)
  }
  if (/\bnext\s+quarter\b/.test(lower)) {
    const d = new Date()
    const q = Math.floor(d.getUTCMonth() / 3) + 1
    const yr = d.getUTCFullYear() + (q >= 4 ? 1 : 0)
    return isoEndOfMonth(yr, ((q % 4) * 3) + 2)
  }
  if (/\bthis\s+month\b/.test(lower)) {
    const d = new Date()
    return isoEndOfMonth(d.getUTCFullYear(), d.getUTCMonth())
  }
  if (/\bnext\s+month\b/.test(lower)) {
    const d = new Date()
    return isoEndOfMonth(d.getUTCFullYear(), d.getUTCMonth() + 1)
  }
  if (/\bthis\s+year\b/.test(lower)) {
    return isoEndOfYear(new Date().getUTCFullYear())
  }

  return null
}

function sentenceCase(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ')
  if (t.length === 0) return t
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function pickHorizon(text: string): 'weekly' | 'short' | 'medium' | 'long' {
  const lower = text.toLowerCase()
  if (/\b(this|next)\s+week\b/.test(lower) || /\bweekly\b/.test(lower)) return 'weekly'
  if (/\bin\s+(\d+)\s+day\b/.test(lower) && Number(RegExp.$1) <= 14) return 'weekly'
  if (/\bthis\s+month\b/.test(lower) || /\bin\s+1\s+month\b/.test(lower)) return 'short'
  if (/\bthis\s+quarter\b/.test(lower)) return 'medium'
  if (/\bthis\s+year\b/.test(lower) || /\bin\s+1\s+year\b/.test(lower)) return 'long'
  return 'short'
}

/**
 * Build a single `create_goal` proposal from a plain-text user
 * message. Returns null when the message doesn't look like a goal
 * introduction — in which case the chat route keeps the prose-only
 * response and surfaces a `needs_clarification` event so the user
 * gets either a confirmable proposal OR an explicit question, never
 * a silent dead-end.
 *
 * The proposal is shaped to match the system prompt's required JSON
 * (create_goal fields). The executor accepts both `first_action` and
 * `next_action`, so we populate the natural one.
 */
export function proposeGoalFromMessage(messageText: string): Proposal | null {
  const raw = (messageText ?? '').trim()
  if (raw.length < 6 || raw.length > 280) return null

  // Pull the body after a leading goal phrase. Try the long
  // phrases first ("i want to learn X", "my goal is to X") so the
  // captured body doesn't include the verb phrase twice.
  let body: string | null = null
  for (const re of GOAL_INTRO_PATTERNS) {
    const m = raw.match(re)
    if (m && m[1] && m[1].trim().length >= 3) {
      body = m[1].trim()
      break
    }
  }
  if (body === null) {
    for (const re of GOAL_VERB_STARTERS) {
      const m = raw.match(re)
      if (m && m[2] && m[2].trim().length >= 3) {
        // e.g. "learn X" → body = "X" (drop the verb)
        body = m[2].trim()
        break
      }
      if (m && m[1] && m[1].trim().length >= 6) {
        // e.g. "set up X" → body = full after the verb (no m[2])
        body = raw.trim()
        break
      }
    }
  }
  if (body === null) return null
  body = body.replace(/[.?!]+$/g, '').trim()
  if (body.length < 3) return null

  // Capture any trailing time phrase ("by December", "in 6 months")
  // BEFORE we strip it from the title. We keep `body` as the title and
  // extract the date from the raw text.
  const target = extractTargetDate(raw) ?? isoPlusDays(90)
  const horizon = pickHorizon(raw)

  // Drop obviously boilerplate trailing phrase so "i want to learn
  // swimming by december" → "Learn swimming", not "Learn swimming by
  // december" (the date lives on the timeline, not the title).
  const titleSource = body
    .replace(/\b(?:by|in|within|next|this)\b[^.]*$/i, '')
    .replace(/\b(?:by|in|within)\s+[a-z]+\b.*$/i, '')
    .replace(/\b\d{4}\b.*$/i, '')
    .trim() || body
  const title = sentenceCase(titleSource).slice(0, 80).replace(/[.!]+$/, '')

  // First action: a minimal, sensible starter — the smallest commitment
  // a person can make toward the title. Kept short so the user can
  // refine it inline.
  const firstAction = `Decide the smallest next step toward "${title}".`

  return {
    id: newPropId(),
    action: 'create_goal',
    args: {
      title,
      horizon,
      // The system prompt's `why` field. Without it the goal row
      // shows up with an empty why line in the dashboard.
      why: `What the user said they want to focus on.`,
      first_action: firstAction,
      target_date: target,
    },
    status: 'pending',
  }
}

/* -------------------------------------------------------------------------- */
/* Drop/pause-intent detector                                                  */
/*                                                                             */
/* Reads the same user message and returns ONE `drop_goal` (or `pause_goal`) */
/* proposal when the message clearly targets an existing goal. The chat route   */
/* prefers this output over `proposeGoalFromMessage` so "drop swimming"        */
/* drops the swimming goal rather than creating one titled "Drop swimming".   */
/*                                                                             */
/* Trigger vocabulary: drop, pause, stop, delete, remove, cancel, kill,         */
/* forget, scratch, ditch + "no longer doing", "not doing anymore", etc.     */
/*                                                                             */
/* Resolution rules (in order):                                                */
/*   1. Quoted title (e.g. "drop \"learn swimming\"")  — exact match.         */
/*   2. Trailing noun phrase (e.g. "drop swimming", "pause the MVP").         */
/*      - First try exact case-insensitive title match against `goals`.       */
/*      - Then ≥6-char substring match (same convention as                     */
/*        `resolveGoalRef` — never "Runn" → "Running").                       */
/*        If no substring match, but the message still clearly names an        */
/*        active goal, fall back to the longest goal title that appears in   */
/*        the message (a softer "best effort" so the user gets ONE             */
/*        confirmable proposal instead of a silent dead-end).                 */
/*                                                                             */
/* Returns null when nothing matches — the chat route then falls through to   */
/* the create-goal fallback (or stays silent).                                */
/* -------------------------------------------------------------------------- */

const DROP_VERBS = [
  'drop', 'pause', 'stop', 'delete', 'remove', 'cancel', 'kill',
  'forget', 'scratch', 'ditch', 'abandon', 'shelve', 'shut down',
] as const

const DROP_PHRASES = [
  'no longer doing', 'not doing', 'no longer want',
  'no longer want to', 'stop tracking', 'drop tracking',
  'drop the goal', 'drop that goal', 'drop this goal',
  'get rid of', 'let go of', 'put on hold',
] as const

interface DropCandidate {
  title: string
  goalId?: string
}

function findGoalByReference(
  needle: string,
  goals: DropCandidate[],
): DropCandidate | null {
  const n = needle.trim().toLowerCase()
  if (!n) return null
  const exact = goals.find((g) => g.title.trim().toLowerCase() === n)
  if (exact) return exact
  if (n.length >= 6) {
    const partial = goals.find((g) =>
      g.title.trim().toLowerCase().includes(n),
    )
    if (partial) return partial
  }
  return null
}

export function parseDropIntent(
  messageText: string,
  goals: DropCandidate[],
): Proposal | null {
  const raw = (messageText ?? '').trim()
  if (raw.length < 3 || raw.length > 280) return null
  const lower = raw.toLowerCase()
  if (!goals || goals.length === 0) return null

  // 1) Phrase-style intent first — "no longer doing X" / "stop tracking X".
  for (const phrase of DROP_PHRASES) {
    if (lower.includes(phrase)) {
      const after = lower.split(phrase, 2)[1] || ''
      const tail =
        after
          .replace(/^(?:the|a|an|my|this|that)\s+/i, '')
          .replace(/[.?!]+$/g, '')
          .trim() || raw.replace(new RegExp(phrase, 'i'), '').trim()
      const hit = findGoalByReference(tail, goals)
        || findGoalByReference(raw, goals)
        || bestEffortGoal(raw, goals)
      if (hit) return buildDropProposal(raw, hit, phrase)
    }
  }

  // 2) Verb-led intent — "drop X", "pause the X", "stop tracking X".
  //    Split on the verb and pick the longest trailing noun phrase.
  let matchedVerb: string | null = null
  let matchedIdx = -1
  for (const verb of DROP_VERBS) {
    const re = new RegExp(`\\b${verb}\\b`, 'i')
    const m = re.exec(lower)
    if (m && (matchedVerb === null || m.index < matchedIdx || matchedIdx < 0)) {
      matchedVerb = verb
      matchedIdx = m.index
    }
  }
  if (matchedVerb === null) return null
  const idx = matchedIdx
  const after = raw
    .slice(idx + matchedVerb.length)
    .replace(/^\s*(?:the|a|an|my|this|that|up\s+with|tracking|on)\s+/i, '')
    .replace(/[.?!]+$/g, '')
    .trim()

  // Try a quoted title first, then the tail, then best-effort on the
  // full raw text.
  const quoted = after.match(/^["'`„"«»‹›]([^"'`„"«»‹›]{2,80})["'`„"«»‹›]/)
  let target: DropCandidate | null = null
  if (quoted) {
    target = findGoalByReference(quoted[1], goals)
  }
  if (!target) target = findGoalByReference(after, goals)
  if (!target) target = findGoalByReference(raw, goals)
  if (!target) target = bestEffortGoal(raw, goals)

  if (!target) return null
  return buildDropProposal(raw, target, matchedVerb)
}

/**
 * Soft fallback — pick the goal whose title appears in the user
 * message as the largest substring match. Used only when the message
 * clearly references a drop/pause verb but doesn't name the target
 * precisely (e.g. "drop it" with multiple goals → returns the first
 * active goal; "drop the side project" → returns the goal titled
 * "Ship side-project MVP"). The point is to surface ONE confirmable
 * proposal so the user is never left looking at a silent chat.
 */
function bestEffortGoal(
  raw: string,
  goals: DropCandidate[],
): DropCandidate | null {
  const lower = raw.toLowerCase()
  // Prefer the longest title that appears at all.
  const sorted = [...goals].sort((a, b) => b.title.length - a.title.length)
  for (const g of sorted) {
    if (g.title.trim().length >= 4 && lower.includes(g.title.trim().toLowerCase())) {
      return g
    }
  }
  // Last-ditch: if the user said "drop it" / "pause that" with no
  // explicit name, and there's only one active goal, return it.
  if (/^(?:drop|pause|stop|delete|remove|cancel|kill|forget|scratch|ditch|abandon|shelve|shut down)\s+(?:it|that|this|everything|all)(?:\s+[a-z]+)?\.?$/i.test(raw)) {
    return goals[0] ?? null
  }
  return null
}

function buildDropProposal(
  raw: string,
  target: DropCandidate,
  matchedVia: string,
): Proposal {
  const lower = raw.toLowerCase()
  const action: 'drop_goal' | 'pause_goal' = lower.includes('pause') ||
    lower.includes('hold')
    ? 'pause_goal'
    : 'drop_goal'
  const verb = action === 'drop_goal' ? 'Drop' : 'Pause'
  return {
    id: newPropId(),
    action,
    args: {
      ...(target.goalId ? { goal_id: target.goalId } : {}),
      goal_title: target.title,
      reason: `Detected via "${matchedVia}" in the user's message.`,
    },
    status: 'pending',
  }
}
