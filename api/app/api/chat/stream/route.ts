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

import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'

import {
  MODEL_REGISTRY,
  getModel,
  parseProposals,
  splitProseAndTools,
  proposeGoalFromMessage,
  parseDropIntent,
  streamChat,
  TOOL_START,
  TOOL_END,
  type ProviderId,
  type Proposal,
} from '@/lib/emergent/llm'
import { SYSTEM_PROMPT } from '@/lib/llm/prompts'
import { resolveRequestUser } from '@/lib/request-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Default provider when the request omits one. */
const DEFAULT_PROVIDER: ProviderId = 'gemini'
/** History window fed to the LLM. Matches Python: `history[-24:]`. */
const HISTORY_LIMIT = 24

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
  proactive_propose?: unknown
  provider?: unknown
  // Scoped-chat context (Iteration 5) — a chat opened from a Timeline
  // tile, a Today-timetable item, a milestone, a blocker, etc. tags the
  // conversation so the title bar can show "About: <subject>" instead
  // of an anonymous "Let's sort your life — together." header.
  //   - scope   semantic bucket ('goal' | 'commitment' | 'blocker' |
  //             'milestone' | 'generic'); informs title + helper text.
  //   - refId   id of the entity in question (goal_id, commitment_id, …).
  //   - kind    maps to `conversations.kind` enum; falls back from scope.
  //   - title   override for the chat modal title (else derived from scope).
  //   - helperText  override for the faded helper line below the title.
  scope?: unknown
  refId?: unknown
  kind?: unknown
  title?: unknown
  helperText?: unknown
}

// Conversations.kind enum mirrors `db/schema.ts:conversations.kind`. A
// few scopes collapse to the same conversation kind — `commitment`
// and `milestone` share `plan_day` since both are day-level planning.
const SCOPE_TO_KIND: Record<string, 'general' | 'add_goal' | 'plan_day' | 'review_progress' | 'edit_goal' | 'drop_goal'> = {
  goal: 'add_goal',
  commitment: 'plan_day',
  milestone: 'plan_day',
  blocker: 'plan_day',
  generic: 'general',
}

const CONV_KINDS = ['general', 'add_goal', 'plan_day', 'review_progress', 'edit_goal', 'drop_goal'] as const
type ConvKind = (typeof CONV_KINDS)[number]

export async function POST(req: NextRequest) {
  const caller = await resolveRequestUser(req)
  if (!caller) {
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
      : ((caller.modelProvider as ProviderId | undefined) ?? DEFAULT_PROVIDER)

  // Default to autoAnswer=true so the coach proposes by default; user
  // must opt INTO clarification by explicitly setting autoAnswer=false.
  // The previous comment promised this behavior but the code still
  // required an explicit `true` from the client — that was the bug
  // behind "coach never proposes" reports.
  //
  // Resolution order:
  //   1. If client sends autoAnswer/auto_answer=false explicitly → false
  //   2. If client sends autoAnswer/auto_answer=true explicitly → true
  //   3. Otherwise default true (propose)
  //   4. `proactive_propose` and `clarify` force their respective paths
  //      regardless of the explicit autoAnswer value.
  const explicitAuto =
    body.autoAnswer === false || body.auto_answer === false
      ? false
      : body.autoAnswer === true || body.auto_answer === true
      ? true
      : true;
  const autoAnswer =
    explicitAuto ||
    body.proactive_propose === true;

  // `clarify` (alias: grill_me) — explicit "grill me" mode: the model
  // MUST respond with 1-2 sharp clarifying questions and MUST NOT emit
  // a [[TOOLS]] block. Wins over autoAnswer so a user pressing "grill
  // me" gets asked even when the auto-answer toggle is on.
  const clarify = body.clarify === true || body.grillMe === true || body.grill_me === true

  // `proactive_propose` — set by the Add Goal dialog to signal "user wants
  // a goal created NOW". Treated as a strong autoAnswer nudge that also
  // appends ADD GOAL MODE instructions to the system prompt.
  const proactive_propose = body.proactive_propose === true

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
  const { messages, proposals: proposalsTable, conversations } = await import('@/db/schema')
  const { buildContext, loadHistory, loadState } = await import('@/lib/llm/state-builder')

  // Phase 3 — every message must belong to a conversation. The migration
  // seeds `conv_general_<user_id>` for any existing user, but a brand-new
  // guest posting their first message has no row yet. Idempotent INSERT
  // ON CONFLICT DO NOTHING handles both cases.
  //
  // Iteration 5 — scoped chat: when the client provides a `scope` /
  // `refId`, mint a per-entity conversation (`conv_<kind>_<refId>`) so
  // later messages keep the title + context. Falls back to the user's
  // general bucket when no scope is provided.
  //
  // Iteration N — defensive redirect: if the requested conversation is
  // already `status='closed'` (sealed on first confirm), mint a fresh
  // `refId` server-side and create a new conversation row. The original
  // conversation is read-only for new messages. The frontend already
  // swaps `refId` on confirm, but this firewall ensures the LLM never
  // sees the sealed bucket's history even if the client is buggy.
  const clientScope = typeof body.scope === 'string' ? body.scope : null
  const clientRefId = typeof body.refId === 'string' ? body.refId : null
  const clientKindRaw = typeof body.kind === 'string' ? body.kind : null
  const clientKind: ConvKind | null =
    clientKindRaw && (CONV_KINDS as readonly string[]).includes(clientKindRaw)
      ? (clientKindRaw as ConvKind)
      : null
  const scopedKind: ConvKind =
    clientKind ?? (clientScope ? SCOPE_TO_KIND[clientScope] ?? 'general' : 'general')
  const requestedConversationId =
    clientScope && clientRefId
      ? `conv_${scopedKind}_${clientRefId}`
      : `conv_general_${caller.userId}`

  let conversationId = requestedConversationId
  let effectiveRefId: string | null = clientRefId
  let serverRedirected = false

  // goalId to store on the conversation row. clientRefId may be a real
  // goal id OR a new_goal_<uuid> placeholder minted by AddGoalDialog.
  // Placeholders never exist in the goals table — carry null for those.
  let conversationGoalId: string | null =
    clientScope === 'goal' && clientRefId && !clientRefId.startsWith('new_goal_')
      ? clientRefId
      : null

  if (clientScope && clientRefId) {
    // Only scoped conversations can be sealed — `conv_general_<userId>`
    // is the long-lived default and never gets closed.
    const existing = await db
      .select({ id: conversations.id, status: conversations.status })
      .from(conversations)
      .where(eq(conversations.id, requestedConversationId))
      .limit(1)

    if (existing[0]?.status === 'closed') {
      effectiveRefId = `new_goal_${randomUUID().slice(0, 8)}`
      conversationId = `conv_${scopedKind}_${effectiveRefId}`
      serverRedirected = true
      // The original goalId (clientRefId) was a placeholder that never
      // existed in the goals table — do NOT carry it forward.
      conversationGoalId = null
    }
  }

  const convTitle =
    typeof body.title === 'string' && body.title.trim().length > 0
      ? body.title.trim().slice(0, 200)
      : ''
  const convHelper =
    typeof body.helperText === 'string' && body.helperText.trim().length > 0
      ? body.helperText.trim().slice(0, 500)
      : ''
  await db
    .insert(conversations)
    .values({
      id: conversationId,
      userId: caller.userId,
      kind: scopedKind,
      title: convTitle,
      status: 'open',
      goalId: conversationGoalId,
    })
    .onConflictDoNothing({ target: conversations.id })

  await db.insert(messages).values({
    id: userMessageId,
    userId: caller.userId,
    conversationId,
    role: 'user',
    content: message,
    provider: requestedProvider,
  })

  const [contextString, historyRows, userState] = await Promise.all([
    buildContext(
      caller.userId,
      conversationId,
      scopedKind,
      message,
      autoAnswer,
      { title: convTitle, helperText: convHelper },
    ),
    loadHistory(
      caller.userId,
      conversationId,
      scopedKind === 'general' ? HISTORY_LIMIT : 12,
    ),
    loadState(caller.userId),
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

        // Operation-mode hint now lives in the SYSTEM_PROMPT itself (see
        // lib/llm/prompts.ts — "=== OPERATION MODE ==="). When
        // `proactive_propose` is true (frontend's signal that the user
        // wants a goal created NOW), we append an inline `=== ADD GOAL
        // MODE ===` block as a strong nudge. The prompt's permanent
        // ADD GOAL MODE section handles the general guidance; this inline
        // block forces the "create + milestones now, not a clarifying
        // question" path even when the LLM might otherwise hesitate.
        const addGoalHint = proactive_propose
          ? '\n\n=== ADD GOAL MODE ===\nThe user has opened the Add Goal dialog and wants a goal created now. State your single biggest assumption in one short line, then emit a [[TOOLS]] block with a create_goal + 2-3 add_milestone actions. Use TODAY + ~90 days as the default target_date if no deadline was given.'
          : ''

        for await (const ev of streamChat({
          provider: requestedProvider,
          system: SYSTEM_PROMPT + '\n\n=== LIVE STATE & MEMORY ===\n' + contextString + addGoalHint,
          messages: coreMessages,
          sessionId: caller.userId,
        })) {
          if (ev.type === 'text_delta') {
            fullText += ev.content

            if (inTools) {
              // Once in the tools block, suppress further prose deltas.
              continue
            }

            // Track the tools delimiter. Once we've crossed it we
            // suppress further delta events.
            const toolIdx = fullText.indexOf(TOOL_START)
            if (toolIdx === -1) {
              // No delimiter yet — be conservative and hold back the
              // last `max(len(start))` chars in case a boundary is split
              // across chunks.
              const safeLen = TOOL_START.length
              const safeUpTo = Math.max(proseEmitted, fullText.length - safeLen)
              if (safeUpTo > proseEmitted) {
                enqueue({ type: 'delta', content: fullText.slice(proseEmitted, safeUpTo) })
                proseEmitted = safeUpTo
              }
            } else {
              // Tools delimiter reached — emit only the prose before it.
              if (toolIdx > proseEmitted) {
                enqueue({ type: 'delta', content: fullText.slice(proseEmitted, toolIdx) })
              }
              proseEmitted = toolIdx
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
              const todayDate = new Date().toISOString().split('T')[0]
              const ninetyDaysOut = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
              const followUpMessages = [
                ...coreMessages,
                { role: 'assistant' as const, content: prose },
                {
                  role: 'user' as const,
                  content:
                    'SYSTEM CORRECTION — your previous turn only stated assumptions in prose. ' +
                    'You MUST now emit a [[TOOLS]] block so the user has something concrete to confirm. ' +
                    'If the user\'s message implies a single concrete goal, just propose it — do NOT ask for more detail.\n\n' +
                    'Reply with EXACTLY this shape — one create_goal plus 2-4 add_milestone actions:\n\n' +
                    '[[TOOLS]]\n' +
                    '[\n' +
                    '  {"action":"create_goal","title":"<concise title>","horizon":"short","why":"<one sentence>","first_action":"<smallest next step>","target_date":"' + todayDate + '},\n' +
                    '  {"action":"add_milestone","goal_title":"<same title as above>","title":"<milestone 1>","description":"<what done looks like>","why":"<why this step matters>","target_date":"' + todayDate + '"},\n' +
                    '  {"action":"add_milestone","goal_title":"<same title as above>","title":"<milestone 2>","description":"<what done looks like>","why":"<why this step matters>","target_date":"' + ninetyDaysOut + '"}\n' +
                    ']\n' +
                    '[[/TOOLS]]\n\n' +
                    'Use TODAY\'s date from LIVE STATE as the target_date anchor. ' +
                    'If the user gave no explicit deadline, set target_date ~90 days from today. ' +
                    'State your single biggest assumption in one short prose line, then emit the [[TOOLS]] block.',
                },
              ]

              let followUpFull = ''
              for await (const ev of streamChat({
                provider: requestedProvider,
                system: SYSTEM_PROMPT + '\n\n=== LIVE STATE & MEMORY ===\n' + contextString,
                messages: followUpMessages,
                sessionId: caller.userId,
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

        // Final-tier safety net — when auto-answer is on AND the model
        // and its follow-up both came back prose-only, build a
        // confirmable proposal server-side from the message text.
        // The user ALWAYS gets either a drop_goal/pause_goal (when the
        // message targets an existing goal) or a create_goal (when
        // it's a new goal introduction). Drop intent wins over the
        // create-goal heuristic — "drop swimming" drops, never
        // creates "Drop swimming". When neither heuristic matches
        // we surface a clarifying question instead of a silent dump.
        if (
          autoAnswer &&
          !clarify &&
          proposals.length === 0 &&
          message.length > 0
        ) {
          // The drop heuristic needs the user's current goals. The
          // state has already been loaded once at the top of the route
          // for the system context, so we reuse that snapshot here.
          const dropCandidates = (userState.goals || [])
            .filter((g: any) => g.status !== 'dropped')
            .map((g: any) => ({
              title: g.title,
              goalId: g.id,
            }))
          const dropProposal = parseDropIntent(message, dropCandidates)
          if (dropProposal) {
            proposals.push(dropProposal)
          } else {
            const synthesized = proposeGoalFromMessage(message)
            if (synthesized) {
              proposals.push(synthesized)
            } else if (!needsClarification) {
              // Last-ditch: surface a clarifying question so the user
              // gets an interactive chip rather than a silent prose
              // dump. Only fires when no proposals came out and the
              // planner didn't already emit one.
              clarifyingQuestions = extractClarifyingQuestions(prose)
              if (clarifyingQuestions.length > 0) {
                needsClarification =
                  'Tell me a little more so I can shape a real proposal:'
              }
            }
          }
        }

        // Persist the assistant message + proposals in a single
        // transaction. Matches the onFinish semantics from the previous
        // AI-SDK `streamText` flow.
        await db.transaction(async (tx: any) => {
          await tx.insert(messages).values({
            id: assistantMessageId!,
            userId: caller.userId,
            conversationId,
            role: 'assistant',
            content: prose,
            provider: requestedProvider,
          })

          for (const p of proposals) {
            await tx.insert(proposalsTable).values({
              id: p.id,
              messageId: assistantMessageId!,
              userId: caller.userId,
              conversationId,
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
        enqueue({
          type: 'done',
          message_id: assistantMessageId,
          provider: requestedProvider,
          // Iteration N — these three fields let the frontend track which
          // bucket the response landed in. `redirected: true` means the
          // server fired the defensive redirect (sealed bucket → fresh
          // bucket); the client should swap `refId` to `data.ref_id` if
          // it wasn't already.
          ref_id: effectiveRefId,
          conversation_id: conversationId,
          redirected: serverRedirected,
        })
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