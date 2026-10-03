/**
 * Goal Planner — orchestrator (Slice 3).
 *
 * Runs the typed 5-stage pipeline (Intake → [empty] → Plan → Headroom →
 * Emit) for the five planned intents and returns a discriminated union the
 * route turns into JSON. Pure with respect to infrastructure: it makes LLM
 * calls through an injected `complete` (defaulting to `completeJsonWithMeta`)
 * and touches no DB — the route owns persistence. That injection is what
 * makes the whole pipeline unit-testable without a network.
 *
 * Safety contract: never throws for a model/cross-validation failure — such
 * failures become `kind: 'no_change'` with a `plan_rejects` record. Only
 * programmer errors (bad intent enum, etc.) throw.
 */

import 'server-only'

import type { z } from 'zod'

import type { ProviderId } from '@/lib/emergent/model-registry'

import { MAX_RENEGOTIATION_ROUNDS } from './config'
import { crossValidate } from './cross-validator'
import { checkHeadroom, type HeadroomResult } from './headroom'
import { completeJsonWithMeta } from './llm'
import type { CompleteJsonArgs, CompleteJsonMeta } from './llm'
import {
  emitPrompt,
  emitRetrySuffix,
  intakePrompt,
  planPrompt,
  RENEGOTIATION_OPTIONS,
} from './prompts'
import {
  EmitSchema,
  IntakeSchema,
  PlanSchema,
  type Emit,
  type EmittedTool,
  type Intent,
  type Intake,
  type Plan,
  type RenegotiationOption,
} from './schemas'

export type CompleteFn = <S extends z.ZodTypeAny>(
  args: CompleteJsonArgs<S>,
) => Promise<{ object: z.infer<S>; meta: CompleteJsonMeta }>

export const DEFAULT_COMPLETE: CompleteFn = completeJsonWithMeta

export type PlanStage = 'intake' | 'plan' | 'emit' | 'cross_validate'

export interface PlanRejectRecord {
  intent: Intent
  stage: PlanStage
  reason: string
  rawInput: unknown
  rawOutput: unknown
  recovered: boolean
}

export interface PlanPipelineArgs {
  userId: string
  intent: Intent
  message: string
  /** `buildContext(...)` output — the LIVE STATE & MEMORY string. */
  context: string
  provider: ProviderId
  /** ISO YYYY-MM-DD. */
  today: string
  /** Titles of the user's non-dropped goals (for cross-validation). */
  existingGoalTitles: string[]
  /** `users.available_weekly_hours`; null = advisory headroom. */
  budgetHours: number | null
  /** `weekly_hours` for each active goal (null = not yet estimated). */
  activeGoalWeeklyHours: ReadonlyArray<number | null>
  renegotiation?: {
    round: number
    choice: RenegotiationOption
    priorPlan: Plan
    constraint: string
  }
  abortSignal?: AbortSignal
  deps?: { complete: CompleteFn }
}

export type PlanPipelineResult =
  | { kind: 'clarify'; prompt: string; questions: string[]; rejects: PlanRejectRecord[] }
  | { kind: 'early'; shape: Intake['shape']; prose: string; rejects: PlanRejectRecord[] }
  | { kind: 'no_change'; reason: string; prose: string; rejects: PlanRejectRecord[] }
  | {
      kind: 'renegotiate'
      prose: string
      headroom: HeadroomResult
      options: RenegotiationOption[]
      plan: Plan
      rejects: PlanRejectRecord[]
    }
  | {
      kind: 'ok'
      prose: string
      tools: EmittedTool[]
      plan: Plan
      headroom: HeadroomResult | null
      modes: CompleteJsonMeta['mode'][]
      rejects: PlanRejectRecord[]
    }

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Blocker cue heuristic. The PRD forbids the LLM inventing blockers, and
 * blockers are direct-CRUD data anyway (hard constraint #2), so we only keep
 * model-produced blockers when the user's own words point at one.
 */
const BLOCKER_CUE =
  /\b(travel|trip|vacation|holiday|wedding|conference|exam|exams|launch|deadline|away|moving|relocat\w*|surgery|hospital|busy|blocker|blocked|out of town|on leave|festival|ceremony|visa)\b/i

export function messageMentionsBlocker(message: string): boolean {
  return BLOCKER_CUE.test(message)
}

export async function runPlanPipeline(
  args: PlanPipelineArgs,
): Promise<PlanPipelineResult> {
  const complete = args.deps?.complete ?? DEFAULT_COMPLETE
  const rejects: PlanRejectRecord[] = []
  const modes: CompleteJsonMeta['mode'][] = []

  const reject = (
    stage: PlanStage,
    reason: string,
    rawInput: unknown,
    rawOutput: unknown,
    recovered = false,
  ): PlanRejectRecord => ({
    intent: args.intent,
    stage,
    reason,
    rawInput,
    rawOutput,
    recovered,
  })

  const call = async <S extends z.ZodTypeAny>(
    schema: S,
    prompt: string,
  ): Promise<z.infer<S>> => {
    const { object, meta } = await complete({
      provider: args.provider,
      schema,
      prompt,
      abortSignal: args.abortSignal,
    })
    modes.push(meta.mode)
    return object
  }

  /* Stage 1 — Intake ---------------------------------------------------- */
  let intake: Intake
  try {
    intake = await call(
      IntakeSchema,
      intakePrompt({
        intent: args.intent,
        message: args.message,
        context: args.context,
        today: args.today,
      }),
    )
  } catch (e) {
    const reason = `intake failed: ${errMsg(e)}`
    rejects.push(reject('intake', reason, { message: args.message }, null))
    return {
      kind: 'no_change',
      reason,
      prose:
        'I could not read that as a planning request. Rephrase it or add a concrete next step.',
      rejects,
    }
  }

  if (intake.needs_clarification && intake.clarifying_questions.length > 0) {
    return {
      kind: 'clarify',
      prompt:
        intake.framing_line ||
        'A couple of details would change the plan meaningfully:',
      questions: intake.clarifying_questions,
      rejects,
    }
  }
  if (
    intake.shape === 'meta_question' ||
    intake.shape === 'routine_return' ||
    intake.shape === 'over_committed'
  ) {
    return { kind: 'early', shape: intake.shape, prose: intake.framing_line, rejects }
  }

  /* Stage 3 — Plan ------------------------------------------------------ */
  let plan: Plan
  try {
    plan = await call(
      PlanSchema,
      planPrompt({
        intent: args.intent,
        message: args.message,
        context: args.context,
        today: args.today,
        renegotiation: args.renegotiation,
      }),
    )
  } catch (e) {
    const reason = `plan failed: ${errMsg(e)}`
    rejects.push(reject('plan', reason, { message: args.message }, null))
    return {
      kind: 'no_change',
      reason,
      prose:
        'I could not turn that into a concrete plan. Add a deadline or a smallest first step and I will try again.',
      rejects,
    }
  }

  // Anti-hallucination gate — drop blockers the user did not name.
  if (plan.blockers.length > 0 && !messageMentionsBlocker(args.message)) {
    const invented = plan.blockers
    plan = { ...plan, blockers: [] }
    rejects.push(
      reject(
        'plan',
        `cleared ${invented.length} invented blocker(s)`,
        { blockers: invented },
        null,
        true,
      ),
    )
  }

  if (args.intent === 'add_goal' && !plan.goal) {
    const reason = 'add_goal plan produced no goal'
    rejects.push(reject('plan', reason, { plan }, null))
    return {
      kind: 'no_change',
      reason,
      prose: plan.prose || 'I did not get a concrete goal out of that.',
      rejects,
    }
  }

  /* Stage 3.5 — Headroom (programmatic) -------------------------------- */
  let headroom: HeadroomResult | null = null
  if (plan.goal) {
    headroom = checkHeadroom({
      budgetHours: args.budgetHours,
      activeGoals: args.activeGoalWeeklyHours.map((weeklyHours) => ({ weeklyHours })),
      newWeeklyHours: plan.goal.weekly_hours,
    })
    if (headroom.decision === 'renegotiate') {
      const round = args.renegotiation?.round ?? 0
      if (round >= MAX_RENEGOTIATION_ROUNDS) {
        const reason = `renegotiation exhausted: ${headroom.message}`
        rejects.push(reject('plan', reason, { headroom }, null))
        return {
          kind: 'no_change',
          reason,
          prose: `Still over budget after ${MAX_RENEGOTIATION_ROUNDS} attempts. ${headroom.message} Try a smaller goal, or drop an existing one first.`,
          rejects,
        }
      }
      return {
        kind: 'renegotiate',
        prose: plan.prose,
        headroom,
        options: [...RENEGOTIATION_OPTIONS],
        plan,
        rejects,
      }
    }
  }

  /* Stage 4 — Emit ------------------------------------------------------ */
  let emit: Emit
  try {
    emit = await call(EmitSchema, emitPrompt({ intent: args.intent, plan }))
  } catch (e) {
    const reason = `emit failed: ${errMsg(e)}`
    rejects.push(reject('emit', reason, { plan }, null))
    return { kind: 'no_change', reason, prose: plan.prose, rejects }
  }

  // Keep only add_blocker tools grounded in the (possibly-emptied) plan, so a
  // hallucinated blocker is dropped rather than failing the whole plan.
  const allowedBlockerKeys = new Set(
    plan.blockers.map((b) => `${b.start_date}|${b.end_date}`),
  )
  const beforeFilter = emit.tools.length
  emit = {
    tools: emit.tools.filter((t) => {
      if (t.action !== 'add_blocker') return true
      const a = t.args as Record<string, unknown>
      return allowedBlockerKeys.has(`${a.start_date}|${a.end_date}`)
    }),
  }
  if (emit.tools.length !== beforeFilter) {
    rejects.push(
      reject(
        'cross_validate',
        `dropped ${beforeFilter - emit.tools.length} ungrounded blocker tool(s)`,
        {},
        null,
        true,
      ),
    )
  }

  let cv = crossValidate({
    intent: args.intent,
    plan,
    emit,
    existingGoalTitles: args.existingGoalTitles,
  })

  if (!cv.ok) {
    const firstErrors = [...cv.errors]
    try {
      emit = await call(
        EmitSchema,
        emitPrompt({ intent: args.intent, plan }) + emitRetrySuffix(firstErrors),
      )
      cv = crossValidate({
        intent: args.intent,
        plan,
        emit,
        existingGoalTitles: args.existingGoalTitles,
      })
    } catch (e) {
      const reason = `emit retry failed: ${errMsg(e)}`
      rejects.push(reject('emit', reason, { plan }, null))
      return { kind: 'no_change', reason, prose: plan.prose, rejects }
    }

    if (!cv.ok) {
      const reason = `cross-validation failed: ${cv.errors.join('; ')}`
      rejects.push(reject('cross_validate', reason, { plan, emit }, cv.errors))
      return { kind: 'no_change', reason, prose: plan.prose, rejects }
    }
    // Recovered on retry — still record it, flagged.
    rejects.push(
      reject(
        'cross_validate',
        firstErrors.join('; '),
        { plan },
        firstErrors,
        true,
      ),
    )
  }

  return {
    kind: 'ok',
    prose: plan.prose,
    tools: emit.tools,
    plan,
    headroom,
    modes,
    rejects,
  }
}
