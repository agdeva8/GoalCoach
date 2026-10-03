/**
 * POST /api/chat/plan — the Goal Planner pipeline endpoint (Iteration 10).
 *
 * Non-streaming JSON sibling of `/api/chat/stream`. It runs the typed 5-stage
 * pipeline (`lib/goal-planner/orchestrator.ts`) for the five planned intents
 * and persists an assistant message + any proposals exactly like the stream
 * route, so the existing `/api/tools/confirm|reject` flow applies them
 * unchanged.
 *
 * Flag: off by default (`GOAL_PLANNER_ENABLED`). When disabled — or when the
 * conversation kind is `general` — the route returns a status the client uses
 * to fall back to `/api/chat/stream`.
 *
 * Response statuses:
 *   - { status: 'disabled' } | { status: 'not_planned' }
 *   - { status: 'clarify', prose, questions }
 *   - { status: 'early', shape, prose }
 *   - { status: 'no_change', prose, reason }
 *   - { status: 'renegotiate', prose, headroom, options, plan }
 *   - { status: 'ok', prose, proposals, headroom, plan }
 */

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { isGoalPlannerEnabledFor } from '@/lib/goal-planner/config'
import { runPlanPipeline } from '@/lib/goal-planner/orchestrator'
import type { PlanPipelineArgs } from '@/lib/goal-planner/orchestrator'
import {
  INTENTS,
  PlanSchema,
  RenegotiationOptionSchema,
  type Intent,
} from '@/lib/goal-planner/schemas'
import { MODEL_REGISTRY, type ProviderId } from '@/lib/emergent/model-registry'
import { resolveRequestUser } from '@/lib/request-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Vercel function duration ceiling — 3 sequential LLM stages on a slow backend. */
export const maxDuration = 60

const DEFAULT_PROVIDER: ProviderId = 'gemini'

/**
 * Master pipeline deadline. Defaults to 55s so it fits under the route's
 * `maxDuration = 60` on Vercel. Override with `GOAL_PLANNER_TIMEOUT_MS` for
 * local dev on a slow backend.
 *
 * KNOWN ISSUE (Iteration 10, Slice 3): on the DeepSeek backend the text
 * fallback's Zod repair retries push a real add_goal run past 60s, so the
 * pipeline usually aborts → `no_change`. This MUST be fixed before the flag
 * is flipped on in prod. See the Slice 3 report.
 */
const PIPELINE_TIMEOUT_MS = Number(
  process.env.GOAL_PLANNER_TIMEOUT_MS ?? 55_000,
)

interface PlanRequestBody {
  message?: unknown
  kind?: unknown
  refId?: unknown
  scope?: unknown
  autoAnswer?: unknown
  auto_answer?: unknown
  provider?: unknown
  title?: unknown
  helperText?: unknown
  renegotiation?: {
    round?: unknown
    choice?: unknown
    priorPlan?: unknown
    constraint?: unknown
  }
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export async function POST(req: NextRequest) {
  const caller = await resolveRequestUser(req)
  if (!caller) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }
  const userId = caller.userId

  let body: PlanRequestBody
  try {
    body = (await req.json()) as PlanRequestBody
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    return NextResponse.json({ detail: 'Missing message' }, { status: 400 })
  }

  // Flag check happens before any DB/LLM work.
  if (!isGoalPlannerEnabledFor(userId)) {
    return NextResponse.json({ status: 'disabled' })
  }

  const kindRaw = typeof body.kind === 'string' ? body.kind : ''
  const intent = (INTENTS as readonly string[]).includes(kindRaw)
    ? (kindRaw as Intent)
    : null
  if (!intent) {
    return NextResponse.json({ status: 'not_planned' })
  }

  const provider: ProviderId =
    typeof body.provider === 'string' && body.provider in MODEL_REGISTRY
      ? (body.provider as ProviderId)
      : ((caller.modelProvider as ProviderId | undefined) ?? DEFAULT_PROVIDER)

  const autoAnswer =
    body.autoAnswer === false || body.auto_answer === false ? false : true

  const refId = typeof body.refId === 'string' ? body.refId : null
  const conversationId = refId
    ? `conv_${intent}_${refId}`
    : `conv_${intent}_${userId}`
  const convTitle =
    typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
  const convHelper =
    typeof body.helperText === 'string'
      ? body.helperText.trim().slice(0, 500)
      : ''

  const [{ db }, schema, stateBuilder] = await Promise.all([
    import('@/lib/db'),
    import('@/db/schema'),
    import('@/lib/llm/state-builder'),
  ])

  await db
    .insert(schema.conversations)
    .values({
      id: conversationId,
      userId,
      kind: intent,
      title: convTitle,
      status: 'open',
      goalId: refId && !refId.startsWith('new_goal_') ? refId : null,
    })
    .onConflictDoNothing({ target: schema.conversations.id })

  const userMessageId = `msg_${Date.now()}_${randomUUID().slice(0, 8)}`
  await db.insert(schema.messages).values({
    id: userMessageId,
    userId,
    conversationId,
    role: 'user',
    content: message,
    provider,
  })

  const [context, state, budgetRow, goalRows] = await Promise.all([
    stateBuilder.buildContext(userId, conversationId, intent, message, autoAnswer, {
      title: convTitle,
      helperText: convHelper,
    }),
    stateBuilder.loadState(userId),
    db
      .select({ availableWeeklyHours: schema.users.availableWeeklyHours })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1),
    db
      .select({
        weeklyHours: schema.goals.weeklyHours,
        status: schema.goals.status,
      })
      .from(schema.goals)
      .where(eq(schema.goals.userId, userId)),
  ])

  const existingGoalTitles = state.goals
    .filter((g) => g.status !== 'dropped')
    .map((g) => g.title)
  const activeGoalWeeklyHours = goalRows
    .filter((g) => g.status === 'active')
    .map((g) => g.weeklyHours)
  const budgetHours = budgetRow[0]?.availableWeeklyHours ?? null

  const today = new Date().toISOString().slice(0, 10)

  let result
  try {
    result = await runPlanPipeline({
      userId,
      intent,
      message,
      context,
      provider,
      today,
      existingGoalTitles,
      budgetHours,
      activeGoalWeeklyHours,
      renegotiation: parseRenegotiation(body.renegotiation),
      abortSignal: AbortSignal.timeout(PIPELINE_TIMEOUT_MS),
    })
  } catch (e) {
    return NextResponse.json(
      { status: 'error', detail: (e as Error).message ?? String(e) },
      { status: 500 },
    )
  }

  // Best-effort observability — a reject-log failure must not fail the request.
  if (result.rejects.length > 0) {
    await db
      .insert(schema.planRejects)
      .values(
        result.rejects.map((r) => ({
          id: newId('prej'),
          userId,
          intent,
          stage: r.stage,
          reason: r.reason.slice(0, 2000),
          rawInput: (r.rawInput ?? {}) as object,
          rawOutput: (r.rawOutput ?? {}) as object,
          recovered: r.recovered,
        })),
      )
      .catch(() => {
        /* ignore */
      })
  }

  // Determine persisted assistant text + proposals per result kind.
  const assistantText = result.kind === 'clarify' ? result.prompt : result.prose

  const proposals =
    result.kind === 'ok'
      ? result.tools.map((t) => ({
          id: newId('prop'),
          action: t.action,
          args: t.args as Record<string, unknown>,
        }))
      : []

  const assistantMessageId = `msg_${Date.now()}_${randomUUID().slice(0, 8)}`
  await db.transaction(async (tx: any) => {
    await tx.insert(schema.messages).values({
      id: assistantMessageId,
      userId,
      conversationId,
      role: 'assistant',
      content: assistantText,
      provider,
    })
    for (const p of proposals) {
      await tx.insert(schema.proposals).values({
        id: p.id,
        messageId: assistantMessageId,
        userId,
        conversationId,
        action: p.action,
        args: p.args,
        status: 'pending',
      })
    }
  })

  const base = {
    message_id: assistantMessageId,
    conversation_id: conversationId,
    ref_id: refId,
  }

  switch (result.kind) {
    case 'clarify':
      return NextResponse.json({
        status: 'clarify',
        ...base,
        prose: result.prompt,
        questions: result.questions,
      })
    case 'early':
      return NextResponse.json({
        status: 'early',
        ...base,
        shape: result.shape,
        prose: result.prose,
      })
    case 'no_change':
      return NextResponse.json({
        status: 'no_change',
        ...base,
        prose: result.prose,
        reason: result.reason,
      })
    case 'renegotiate':
      return NextResponse.json({
        status: 'renegotiate',
        ...base,
        prose: result.prose,
        headroom: result.headroom,
        options: result.options,
        plan: result.plan,
      })
    case 'ok':
      return NextResponse.json({
        status: 'ok',
        ...base,
        prose: result.prose,
        proposals: proposals.map((p) => ({ ...p, status: 'pending' })),
        headroom: result.headroom,
        plan: result.plan,
      })
    default:
      return NextResponse.json({ status: 'no_change', ...base, prose: '' })
  }
}

/** Parse the client-supplied renegotiation payload into the pipeline shape. */
function parseRenegotiation(
  raw: PlanRequestBody['renegotiation'],
): PlanPipelineArgs['renegotiation'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { round, choice, priorPlan, constraint } = raw
  if (typeof round !== 'number' || typeof constraint !== 'string') return undefined
  const choiceParsed = RenegotiationOptionSchema.safeParse(choice)
  const planParsed = PlanSchema.safeParse(priorPlan)
  if (!choiceParsed.success || !planParsed.success) return undefined
  return {
    round,
    choice: choiceParsed.data,
    priorPlan: planParsed.data,
    constraint,
  }
}
