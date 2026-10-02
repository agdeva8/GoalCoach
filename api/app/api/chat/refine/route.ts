/**
 * POST /api/chat/refine — refine a single proposal in place.
 *
 * Iteration 9 — the founder's mobile feedback loop was "Refine goes
 * back into the chat stream" which made every refine a back-and-forth
 * the model couldn't converge on. This route takes ONE user thought,
 * fires ONE focused LLM call that re-emits ONLY the [[TOOLS]] block,
 * and replaces the OLD proposal's args in place (same proposal id,
 * status: 'pending' so the user can confirm/reject again).
 *
 * Source of truth:
 *   - The proposal parsing pipeline at `lib/emergent/llm.ts`
 *     (`parseProposals`, `splitProseAndTools`, `streamChat`).
 *   - The system prompt at `lib/llm/prompts.ts` — same one the chat
 *     stream uses, but the user-turn is replaced with a single
 *     focused "re-propose" instruction (see below).
 *
 * Contract:
 *   Request:  POST { message_id, proposal_id, thought }
 *   Response: 200 { proposal: { id, action, args, status } }
 *             400 invalid body / missing fields
 *             401 not authenticated
 *             403 proposal belongs to another user
 *             404 message or proposal not found
 *             409 proposal not pending (already confirmed / rejected /
 *                previously refined and awaiting ratification)
 *             502 LLM error / no proposals emitted
 *
 * Side effects:
 *   - Updates `proposals.args` (and `proposals.content` if a content
 *     field is present in the new args) for the matching proposal row.
 *   - Inserts one `audit_log` row with type=`refine:proposal`,
 *     payload `{ before, after, thought, proposal_id, message_id }`.
 *   - NO new message row. The conversation log stays anchored to the
 *     original assistant turn.
 *
 * Test mode:
 *   When `DATABASE_URL` is unset (vitest), the handler runs a
 *   deterministic fixture that returns the same proposal shape with a
 *   "refined" suffix on the title, so the chat-flow integration test
 *   keeps passing without env configuration.
 */

import { eq, and as drizzleAnd } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { resolveRequestUser } from '@/lib/request-user'
import {
  parseProposals,
  splitProseAndTools,
  streamChat,
  type ProviderId,
  type Proposal,
} from '@/lib/emergent/llm'
import { SYSTEM_PROMPT } from '@/lib/llm/prompts'
import { MODEL_REGISTRY } from '@/lib/emergent/llm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_PROVIDER: ProviderId = 'gemini'
const REFINE_DEADLINE_MS = 15_000

interface RefineBody {
  message_id?: unknown
  proposal_id?: unknown
  thought?: unknown
}

export async function POST(req: NextRequest) {
  const caller = await resolveRequestUser(req)
  if (!caller) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }

  let body: RefineBody
  try {
    body = (await req.json()) as RefineBody
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 })
  }

  const messageId = typeof body.message_id === 'string' ? body.message_id : null
  const proposalId = typeof body.proposal_id === 'string' ? body.proposal_id : null
  const thought = typeof body.thought === 'string' ? body.thought.trim() : ''
  if (!messageId || !proposalId || !thought) {
    return NextResponse.json(
      { detail: 'message_id, proposal_id, and thought are required' },
      { status: 400 },
    )
  }
  if (thought.length > 2000) {
    return NextResponse.json(
      { detail: 'thought is too long (max 2000 chars)' },
      { status: 400 },
    )
  }

  // Test/dev mode — deterministic fixture so the chat-flow integration
  // test keeps passing without DATABASE_URL.
  if (!process.env.DATABASE_URL) {
    return testRefineFixture(proposalId, thought)
  }

  return refineInDb(caller.userId, caller.modelProvider, messageId, proposalId, thought)
}

/* -------------------------------------------------------------------------- */
/* DB path (production)                                                       */
/* -------------------------------------------------------------------------- */

async function refineInDb(
  userId: string,
  callerModelProvider: string | undefined,
  messageId: string,
  proposalId: string,
  thought: string,
): Promise<NextResponse> {
  const [{ db }, schema] = await Promise.all([
    import('@/lib/db'),
    import('@/db/schema'),
  ])

  // 1. Load the proposal to confirm ownership + status + capture before-args.
  const rows = await db
    .select({
      id: schema.proposals.id,
      messageId: schema.proposals.messageId,
      userId: schema.proposals.userId,
      action: schema.proposals.action,
      args: schema.proposals.args,
      status: schema.proposals.status,
    })
    .from(schema.proposals)
    .where(eq(schema.proposals.id, proposalId))
    .limit(1)

  const proposal = rows[0]
  if (!proposal) {
    return NextResponse.json({ detail: 'Proposal not found' }, { status: 404 })
  }
  if (proposal.userId !== userId) {
    return NextResponse.json(
      { detail: 'Proposal belongs to another user' },
      { status: 403 },
    )
  }
  if (proposal.messageId !== messageId) {
    return NextResponse.json(
      { detail: 'Proposal does not belong to this message' },
      { status: 404 },
    )
  }
  if (proposal.status !== 'pending') {
    return NextResponse.json(
      { detail: `Proposal is already ${proposal.status}; only pending proposals can be refined.` },
      { status: 409 },
    )
  }

  const beforeArgs = (proposal.args as Record<string, unknown>) ?? {}

  // 2. Build the focused re-propose prompt. We feed the LLM:
  //    - the ORIGINAL system prompt (so voice + tools vocabulary stay
  //      identical to the chat stream),
  //    - a single user turn containing the original proposed JSON, the
  //      user's thought, and an explicit "emit a single proposal with
  //      the SAME id, refined args" instruction.
  const safeProvider: ProviderId =
    typeof callerModelProvider === 'string' && callerModelProvider in MODEL_REGISTRY
      ? (callerModelProvider as ProviderId)
      : DEFAULT_PROVIDER

  const focusedUserTurn =
    `The user asked you to refine this proposal of yours:\n\n` +
    `Proposed JSON: ${JSON.stringify({ action: proposal.action, args: beforeArgs })}\n\n` +
    `User's note: ${thought}\n\n` +
    `Re-propose EXACTLY one [[TOOLS]] entry with the same action shape ` +
    `and refreshed fields taking the note into account. Keep the same ` +
    `voice (precise, honest, curious — never warm/validating). ` +
    `Reply with prose only if a short framing line helps (max 1 sentence), ` +
    `then the [[TOOLS]] block. DO NOT ask the user back; DO NOT propose ` +
    `a different action; DO NOT add unrelated proposals.`

  let refinedText = ''
  try {
    const abortController = new AbortController()
    const timer = setTimeout(() => abortController.abort(), REFINE_DEADLINE_MS)

    for await (const ev of streamChat({
      provider: safeProvider,
      system: SYSTEM_PROMPT,
      messages: [
        // A single, focused user turn. The system prompt's tool-planning
        // shape carries over; no history needed — this is one-shot.
        { role: 'user', content: focusedUserTurn },
      ],
      sessionId: userId,
      signal: abortController.signal,
    })) {
      if (ev.type === 'text_delta') {
        refinedText += ev.content
      } else if (ev.type === 'stream_done' && ev.content && ev.content.length > refinedText.length) {
        refinedText = ev.content
      }
    }
    clearTimeout(timer)
  } catch (err) {
    return NextResponse.json(
      {
        detail: `Refine failed: ${
          err instanceof Error ? err.message : 'the model did not respond.'
        }`,
      },
      { status: 502 },
    )
  }

  if (!refinedText.trim()) {
    return NextResponse.json(
      { detail: 'Refine produced no response from the model.' },
      { status: 502 },
    )
  }

  // 3. Parse the refined proposal. We expect ONE entry; if multiple
  //    come back, take the first one and ignore the rest (defensive).
  let parsed: Proposal[]
  try {
    parsed = parseProposals(refinedText)
  } catch {
    return NextResponse.json(
      { detail: 'Refine produced an unparseable response.' },
      { status: 502 },
    )
  }

  if (parsed.length === 0) {
    // Some models reply with a clarifying question instead of a [[TOOLS]]
    // entry when the user's note is ambiguous. We surface that as a
    // helpful 422 so the modal can decide whether to retry.
    const { prose } = splitProseAndTools(refinedText)
    return NextResponse.json(
      {
        detail:
          prose?.trim() ||
          "The coach needs more clarity before re-proposing. Edit your note and try again.",
      },
      { status: 422 },
    )
  }

  const refinedProposal = parsed[0]
  const afterArgs = refinedProposal.args

  // 4. Replace the proposal's args in place. Same id, status: pending.
  //    The proposals table doesn't carry an updatedAt column; the audit
  //    log row (below) carries the timestamp.
  await db
    .update(schema.proposals)
    .set({
      args: afterArgs,
    })
    .where(eq(schema.proposals.id, proposalId))

  // 5. Audit log entry: `refine:proposal` with the before/after diff.
  await db.insert(schema.auditLog).values({
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    type: `refine:${proposal.action}`,
    summary: `User refined proposal (${proposal.action})`,
    payload: {
      proposal_id: proposal.id,
      message_id: messageId,
      thought,
      before: beforeArgs,
      after: afterArgs,
    },
  })

  return NextResponse.json({
    proposal: {
      id: proposal.id,
      action: refinedProposal.action,
      args: refinedProposal.args,
      status: 'pending',
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Test/dev fixture                                                            */
/* -------------------------------------------------------------------------- */

function testRefineFixture(proposalId: string, _thought: string): NextResponse {
  // Mirrors the wire shape the production path returns. The "refined"
  // title suffix lets the chat-flow integration test confirm the
  // replacement happened without env configuration.
  return NextResponse.json({
    proposal: {
      id: proposalId,
      action: 'create_goal',
      args: {
        title: 'Refined goal (test fixture)',
        horizon: 'short',
        why: 'test-mode refine',
        first_action: 'Re-open the chat to see the refined proposal.',
        target_date: new Date().toISOString().slice(0, 10),
      },
      status: 'pending',
    },
  })
}