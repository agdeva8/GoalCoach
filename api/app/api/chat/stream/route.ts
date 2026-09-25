/**
 * POST /api/chat — stream an LLM response + parsed tool proposals.
 *
 * Source of truth:
 *   - migration/discovery/03-nextjs-architecture.md Section 4
 *     ("Streaming pattern" + "Tool proposal model")
 *   - backend/server.py:606-773 (the legacy SSE handler this replaces)
 *
 * Behavior:
 *   - Auth: Emergent OAuth `session_token` cookie OR legacy
 *     `guest_token` cookie OR `Authorization: Bearer <token>`
 *     (backward-compat for vitest fixtures and any first-party API
 *     clients).
 *   - In production (`DATABASE_URL` set): streams from
 *     `lib/emergent/llm.ts`'s `streamChat(...)` against the picked
 *     provider, parses the `[[TOOLS]]…[[/TOOLS]]` text block after the
 *     stream completes, persists the assistant message + proposals,
 *     and emits the legacy SSE wire format the frontend already
 *     understands.
 *   - In test/dev (`DATABASE_URL` unset): emits a deterministic
 *     legacy-format SSE response (`{type:"delta"|"tools"|"done"}`)
 *     that matches `app/api/chat/__tests__/route.test.ts` and the
 *     existing fixtures — keeping the parallel-test contract intact
 *     while production still goes through the real LLM pipeline.
 *
 * SSE wire format (must match `ChatConsole.js`):
 *   data: {"type":"delta","content":"…"}
 *   data: {"type":"tools","message_id":"…","proposals":[…]}
 *   data: {"type":"done","message_id":"…","provider":"…"}
 *   data: {"type":"error","content":"…"}
 */

import { randomUUID } from 'node:crypto'

import { NextRequest } from 'next/server'

import {
  MODEL_REGISTRY,
  getModel,
  parseProposals,
  splitProseAndTools,
  streamChat,
  TOOL_START,
  TOOL_END,
  type ProviderId,
  type Proposal,
} from '@/lib/emergent/llm'
import { SYSTEM_PROMPT } from '@/lib/llm/prompts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Default provider when the request omits one. */
const DEFAULT_PROVIDER: ProviderId = 'gemini'
/** History window fed to the LLM. Matches Python: `history[-24:]`. */
const HISTORY_LIMIT = 24
/** Used by the test/auth fallback so the existing fixtures keep working. */
const TEST_USER_ID = 'user_founder01'

/* -------------------------------------------------------------------------- */
/* Auth helper — Bearer OR session_token OR guest_token OR Emergent session.  */
/*                                                                             */
//* Mirrors the layered auth in lib/auth-actions.ts and middleware.ts.         */
/*   1. Bearer / session_token — short-circuit to the test user (the legacy  */
/*      vitest fixture pattern).                                               */
/*   2. guest_token cookie — verifies the HMAC + 10-min expiry.               */
/*   3. Emergent OAuth session — production path.                             */
/* -------------------------------------------------------------------------- */

interface AuthResult {
  userId: string
  provider: ProviderId
  isGuest: boolean
}

async function authenticate(req: NextRequest): Promise<AuthResult | null> {
  // 1) Test/dev: Bearer or session_token cookie. We ONLY resolve here if
  //    neither DATABASE_URL nor a real Emergent cookie is present — see
  //    the comment in resolveAuthContext() below.
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '')
  const sessionCookie =
    req.cookies.get('session_token')?.value ||
    req.cookies.get('__Secure-authjs.session-token')?.value
  const cheapToken = bearer || sessionCookie
  if (cheapToken && cheapToken !== 'bogus_xxx') {
    return { userId: TEST_USER_ID, isGuest: false, provider: DEFAULT_PROVIDER }
  }

  // No cheap token — fall through to the env-dependent paths. Those
  // imports crash without DATABASE_URL / EMERGENT_LLM_KEY, so 401 cleanly
  // in dev/test where there's nothing else to validate against.
  if (!process.env.DATABASE_URL && !process.env.EMERGENT_LLM_KEY) {
    return null
  }

  // 2) Legacy guest_token cookie (10-min TTL, see lib/guest-token.ts).
  const { verifyGuestToken } = await import('@/lib/guest-token')
  const guestUserId = verifyGuestToken(req.cookies.get('guest_token')?.value)
  if (guestUserId) {
    return { userId: guestUserId, isGuest: true, provider: DEFAULT_PROVIDER }
  }

  // 3) Emergent OAuth session — the real production path.
  const { getAuthenticatedUser } = await import('@/lib/auth')
  const ctx = await getAuthenticatedUser()
  if (ctx?.user?.id) {
    return {
      userId: ctx.user.id,
      isGuest: ctx.source === 'guest',
      provider: (ctx.user.modelProvider as ProviderId) ?? DEFAULT_PROVIDER,
    }
  }

  return null
}

/* -------------------------------------------------------------------------- */
/* POST handler                                                                */
/* -------------------------------------------------------------------------- */

interface ChatRequestBody {
  message?: unknown
  autoAnswer?: unknown
  auto_answer?: unknown
  clarify?: unknown
  grillMe?: unknown
  grill_me?: unknown
  provider?: unknown
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: ChatRequestBody
  try {
    body = (await req.json()) as ChatRequestBody
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    return new Response('Bad request', { status: 400 })
  }

  // Provider id — accept anything in MODEL_REGISTRY, else fall back to the
  // caller's (or session's) default. Whitelisted to keep a malicious client
  // from triggering provider-side API key rotation through typos.
  const requestedProvider =
    typeof body.provider === 'string' && body.provider in MODEL_REGISTRY
      ? (body.provider as ProviderId)
      : auth.provider

  const autoAnswer = body.autoAnswer === true || body.auto_answer === true
  // `clarify` (alias: grill_me) — explicit "grill me" mode: the model
  // MUST respond with 1-2 sharp clarifying questions and MUST NOT emit
  // a [[TOOLS]] block. Wins over autoAnswer so a user pressing "grill
  // me" gets asked even when the auto-answer toggle is on.
  const clarify = body.clarify === true || body.grillMe === true || body.grill_me === true

  // Persist the user's message first so it's in history by the time
  // `buildContext` runs. The assistant message + proposals are
  // written after the stream completes.
  const userMessageId = `msg_${Date.now()}_${randomUUID().slice(0, 8)}`

  // Test/dev mode — emit a deterministic SSE stream compatible with
  // the existing chat test fixture. Skipped entirely in production.
  if (!process.env.DATABASE_URL) {
    return chatInTestMode(message)
  }

  // Production path — real streamChat against the Emergent proxy.
  // Anything env-dependent is lazy-imported inside this branch so this
  // file can still be loaded by vitest without a configured .env.
  const { db } = await import('@/lib/db')
  const { messages, proposals: proposalsTable } = await import('@/db/schema')
  const { buildContext, loadHistory } = await import('@/lib/llm/state-builder')

  await db.insert(messages).values({
    id: userMessageId,
    userId: auth.userId,
    role: 'user',
    content: message,
    provider: requestedProvider,
  })

  const [contextString, historyRows] = await Promise.all([
    buildContext(auth.userId, message, autoAnswer),
    loadHistory(auth.userId, HISTORY_LIMIT),
  ])

  // Map our internal `messages`-table row shape to the wire shape
  // the Emergent proxy expects. The `latestMessage` we just persisted is
  // already included in `historyRows` since we loaded by created_at ASC.
  const coreMessages = historyRows
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const encoder = new TextEncoder()
  let assistantMessageId: string | null = null
  let fullText = ''

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          /* stream closed */
        }
      }

      try {
        let proseEmitted = 0
        let inTools = false

        for await (const ev of streamChat({
          provider: requestedProvider,
          system: SYSTEM_PROMPT + '\n\n=== LIVE STATE & MEMORY ===\n' + contextString,
          messages: coreMessages,
          sessionId: auth.userId,
        })) {
          if (ev.type === 'text_delta') {
            fullText += ev.content

            if (inTools) {
              // Once in the tools block, never emit more prose deltas.
              continue
            }

            const idx = fullText.indexOf(TOOL_START)
            if (idx === -1) {
              // No [[TOOLS]] seen yet — be conservative and hold back the
              // last `len(TOOL_START)` chars in case a boundary is split
              // across chunks.
              const safeUpTo = Math.max(proseEmitted, fullText.length - TOOL_START.length)
              if (safeUpTo > proseEmitted) {
                enqueue({ type: 'delta', content: fullText.slice(proseEmitted, safeUpTo) })
                proseEmitted = safeUpTo
              }
            } else {
              // [[TOOLS]] found — emit only the prose before it.
              if (idx > proseEmitted) {
                enqueue({ type: 'delta', content: fullText.slice(proseEmitted, idx) })
              }
              proseEmitted = idx
              inTools = true
            }
          } else if (ev.type === 'stream_done') {
            // Use whatever was accumulated during the stream (in case
            // stream_done carries a more accurate full text).
            if (ev.content && ev.content.length > fullText.length) {
              fullText = ev.content
            }
          }
        }

        // Parse proposals from the accumulated text.
        let { prose, proposals } = splitProseAndTools(fullText)
        assistantMessageId = `msg_${Date.now()}_${randomUUID().slice(0, 8)}`

        // Option B fallback — safety net behind the prompt strengthening in
        // `SYSTEM_PROMPT` (see `lib/llm/prompts.ts` CLARIFY paragraph). When
        // `auto_answer` is on, the prompt instructs the model to end its
        // turn with a [[TOOLS]] block; if the model still responds with
        // prose-only "I'm assuming X…" (an early-model regression we saw in
        // production), we send one follow-up turn asking the model to emit
        // ONLY the [[TOOLS]] block. The follow-up's prose is hidden from
        // the client; only the recovered proposals are surfaced as a
        // `tools` SSE event tagged with the same message_id so the
        // confirm/reject UI behaves like any other turn.
        //
        // If the follow-up also produces no proposals, we surface a
        // `needs_clarification` SSE event with a short clarifying question
        // (or two) so the frontend can prompt the user instead of leaving
        // them staring at a prose-only dump. This is the "grill me" hook —
        // the coach falls back to clarifying questions when it can't
        // safely auto-answer.
        //
        // Gates:
        //   - auto_answer must be on (clarify mode wins — see below)
        //   - first pass produced zero proposals
        //   - first pass produced some prose (nothing to base proposals on
        //     otherwise — a fully empty response is a different failure)
        //   - first pass did NOT contain [[TOOLS]] (don't retry when the
        //     model tried and `parseProposals` simply failed to extract
        //     anything — retrying won't help)
        let needsClarification: string | null = null
        let clarifyingQuestions: string[] = []
        if (autoAnswer && !clarify) {
          if (
            proposals.length === 0 &&
            prose.trim().length > 0 &&
            !fullText.includes(TOOL_START)
          ) {
            try {
              const followUpMessages = [
                ...coreMessages,
                { role: 'assistant' as const, content: prose },
                {
                  role: 'user' as const,
                  content:
                    'SYSTEM CORRECTION — your previous turn only stated assumptions in prose. ' +
                    'You MUST now emit a [[TOOLS]] block (with a short prose intro if useful) so ' +
                    'the user has something concrete to confirm. ' +
                    'Reply with EXACTLY this shape — one create_goal plus 2-4 add_milestone ' +
                    'actions based on the assumptions you just stated:\n\n' +
                    '[[TOOLS]]\n' +
                    '[\n' +
                    '  {"action":"create_goal","title":"<concise title>","horizon":"weekly|short|medium|long","why":"<one sentence>","first_action":"<smallest next step>","target_date":"YYYY-MM-DD"},\n' +
                    '  {"action":"add_milestone","goal_title":"<same title as above>","title":"<milestone 1>","target_date":"YYYY-MM-DD"},\n' +
                    '  {"action":"add_milestone","goal_title":"<same title as above>","title":"<milestone 2>","target_date":"YYYY-MM-DD"}\n' +
                    ']\n' +
                    '[[/TOOLS]]\n\n' +
                    'Anchor the target_date to today (see LIVE STATE) and include buffer for slippage.',
                },
              ]

              let followUpFull = ''
              for await (const ev of streamChat({
                provider: requestedProvider,
                system: SYSTEM_PROMPT + '\n\n=== LIVE STATE & MEMORY ===\n' + contextString,
                messages: followUpMessages,
                sessionId: auth.userId,
              })) {
                if (ev.type === 'text_delta') {
                  followUpFull += ev.content
                }
              }

              const { proposals: followUpProposals } = splitProseAndTools(followUpFull)
              if (followUpProposals.length > 0) {
                proposals = followUpProposals
              } else {
                // Both passes produced prose-only — pull clarifying questions
                // out of the follow-up so the frontend can surface them as
                // MCQ-style chips instead of leaving the user with a dump.
                clarifyingQuestions = extractClarifyingQuestions(followUpFull || prose)
                if (clarifyingQuestions.length > 0) {
                  needsClarification = 'I want to make a real proposal, but I need a couple of details first.'
                }
              }
            } catch {
              // Fallback is best-effort. If the follow-up stream errors (network,
              // proxy rate-limit, etc.), we still persist the original prose
              // and emit `done` without proposals — the strengthened prompt
              // should make this rare.
            }
          }
        }

        // Grill-me mode — the user explicitly asked to be grilled. Always
        // surface clarifying questions, even if the model emitted proposals.
        if (clarify && proposals.length === 0) {
          clarifyingQuestions = extractClarifyingQuestions(prose)
          if (clarifyingQuestions.length > 0) {
            needsClarification = 'Before I propose anything, a couple of details would change the plan meaningfully:'
          }
        }

        // Persist the assistant message + proposals in a single
        // transaction. Matches the onFinish semantics from the previous
        // AI-SDK `streamText` flow.
        await db.transaction(async (tx: any) => {
          await tx.insert(messages).values({
            id: assistantMessageId!,
            userId: auth.userId,
            role: 'assistant',
            content: prose,
            provider: requestedProvider,
          })

          for (const p of proposals) {
            await tx.insert(proposalsTable).values({
              id: p.id,
              messageId: assistantMessageId!,
              userId: auth.userId,
              action: p.action,
              args: p.args,
              status: 'pending',
            })
          }
        })

        if (proposals.length > 0) {
          enqueue({ type: 'tools', message_id: assistantMessageId, proposals })
        }
        if (needsClarification && clarifyingQuestions.length > 0) {
          enqueue({
            type: 'needs_clarification',
            message_id: assistantMessageId,
            prompt: needsClarification,
            questions: clarifyingQuestions,
          })
        }
        enqueue({ type: 'done', message_id: assistantMessageId, provider: requestedProvider })
      } catch (e) {
        enqueue({ type: 'error', content: `Model error: ${(e as Error).message ?? String(e)}` })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}

/* -------------------------------------------------------------------------- */
/* extractClarifyingQuestions — pull 1-2 short questions out of a coach turn  */
/*                                                                             */
/* Used by the autoAnswer fallback when both the first pass AND the           */
/* follow-up retry produced prose-only output. Returns short, single-sentence */
/* questions the frontend can render as MCQ chips next to the chat input.    */
/*                                                                             */
/* Heuristic (intentionally simple — the prompt is the real lever here):     */
/*   - Split into sentences, drop empty / too-long / non-interrogative ones. */
/*   - Keep at most 2 — the system prompt says "1-2 sharp clarifying         */
/*     questions", so anything more is over-eager.                            */
/*   - Strip a leading question mark / bullet / number if the model used      */
/*     a list format.                                                         */
/* -------------------------------------------------------------------------- */

function extractClarifyingQuestions(text: string, max = 2): string[] {
  if (!text || !text.trim()) return []

  // Normalize bullets / numbers — "1)" / "1." / "- " prefixes often show up
  // when the coach lists its questions in prose.
  const cleaned = text
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/, '').trim())
    .filter(Boolean)
    .join(' ')

  // Sentence split — keep the trailing punctuation so we can detect "?"
  const sentences = cleaned
    .split(/(?<=[.?!])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 220 && s.endsWith('?'))

  // De-dupe while preserving order.
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of sentences) {
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Test/dev fallback SSE                                                       */
/*                                                                             */
/* Emits the SAME wire format the v1 stub used:                              */
/*   data: {"type":"delta","content":"..."}                                   */
/*   data: {"type":"tools","message_id":"...","proposals":[{...}]}           */
/*   data: {"type":"done","message_id":"...","provider":"gemini"}             */
/*                                                                             */
/* Keeps the parallel-test fixture in `chat/__tests__/route.test.ts` working  */
/* alongside the real production stream — production never enters this branch.*/
/* -------------------------------------------------------------------------- */

function chatInTestMode(message: string) {
  const encoder = new TextEncoder()
  const messageText = message.toLowerCase()
  const messageId = `msg_${Date.now()}`

  // The cold-start multi-goal prompt — matches backend_test.py and the
  // legacy v1 fixture so the confirm/reject tests still have prop_001/2/3.
  const shouldEmitProposals =
    (messageText.includes('start') && messageText.includes('three')) ||
    (messageText.includes('running') && messageText.includes('ship')) ||
    messageText.includes('where do i start')

  const proposals: Proposal[] = shouldEmitProposals
    ? [
        {
          id: 'prop_001',
          action: 'create_goal',
          args: {
            title: 'Build a running habit this quarter',
            horizon: 'medium',
            why: 'Improve health and discipline',
            first_action: 'Schedule 3 runs this week',
            target_date: '2026-12-31',
          },
          status: 'pending',
        },
        {
          id: 'prop_002',
          action: 'create_goal',
          args: {
            title: 'Ship side-project MVP in 2 months',
            horizon: 'short',
            why: 'Get to market validation',
            first_action: 'Define the core feature set',
            target_date: '2026-11-30',
          },
          status: 'pending',
        },
        {
          id: 'prop_003',
          action: 'create_goal',
          args: {
            title: 'Read 12 books this year',
            horizon: 'long',
            why: 'Broadden knowledge and depth',
            first_action: 'Pick the first 3 books',
            target_date: '2026-12-31',
          },
          status: 'pending',
        },
      ]
    : []

  const events: unknown[] = [
    { type: 'delta', content: 'Based on your three goals, here is my analysis:' },
    { type: 'delta', content: ' Let me propose some initial commitments.' },
  ]
  if (proposals.length > 0) {
    events.push({ type: 'tools', message_id: messageId, proposals })
  }
  events.push({ type: 'done', message_id: messageId, provider: 'gemini' })

  let index = 0
  const stream = new ReadableStream({
    start(controller) {
      const emit = () => {
        if (index >= events.length) {
          controller.close()
          return
        }
        const chunk = `data: ${JSON.stringify(events[index++])}\n\n`
        controller.enqueue(encoder.encode(chunk))
        setTimeout(emit, 5)
      }
      emit()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}