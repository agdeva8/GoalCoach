/**
 * Goal Planner — Stage 4 cross-validator (programmatic; no LLM).
 *
 * Runs after Stage 4, before anything reaches the user. Every emitted tool
 * must be internally consistent with the Stage 3 plan and with the user's
 * existing goals. On failure the orchestrator retries Stage 4 once with the
 * diff; a second failure falls back to `no_change` (never a 500).
 *
 * Rules (PRD Iteration 10 §Cross-validator):
 *   - the action is in the intent's allowed set;
 *   - `args` matches the action's Zod schema;
 *   - `add_milestone.goal_title` / `add_commitment.goal_title` match the plan
 *     goal (or an existing active goal);
 *   - `add_milestone.target_date` is one of the plan's milestone dates;
 *   - `add_milestone.phase` / `add_commitment.phase` are keys of
 *     `plan.goal.phase_objectives`;
 *   - `add_blocker` dates are one of the plan's blockers;
 *   - `add_commitment.due` is one of the plan's commitment dues;
 *   - for `add_goal`: goal present, 3-5 milestones, 1-3 commitments.
 *
 * Deliberately NOT enforced: that `target_date` falls inside the horizon
 * window. The PRD both says it MUST (glossary) and ships a worked example
 * that violates it (a `short` goal at +120d for interview/notice latency).
 * Enforcing it would reject the spec's own example, so it stays a Stage 3
 * prompt instruction, not a hard gate.
 */

import {
  MAX_COMMITMENTS,
  MAX_MILESTONES,
  MIN_COMMITMENTS,
  MIN_MILESTONES,
} from './config'
import {
  ACTION_ARG_SCHEMAS,
  ALLOWED_ACTIONS,
  type Emit,
  type Intent,
  type Plan,
} from './schemas'

export interface CrossValidateInput {
  intent: Intent
  plan: Plan
  emit: Emit
  /** Titles of the user's active goals (any non-dropped status). */
  existingGoalTitles: readonly string[]
}

export interface CrossValidateResult {
  ok: boolean
  errors: string[]
}

function norm(s: string): string {
  return s.trim().toLowerCase()
}

export function crossValidate(input: CrossValidateInput): CrossValidateResult {
  const errors: string[] = []
  const { intent, plan, emit } = input

  const allowed = ALLOWED_ACTIONS[intent]
  const planTitle = plan.goal ? norm(plan.goal.title) : null
  const knownTitles = new Set<string>(
    [...input.existingGoalTitles, ...(plan.goal ? [plan.goal.title] : [])].map(
      norm,
    ),
  )
  const planMilestoneDates = new Set(plan.milestones.map((m) => m.target_date))
  const milestoneByTitle = new Map(
    plan.milestones.map((m) => [norm(m.title), m]),
  )
  const planCommitmentDues = new Set(plan.commitments.map((c) => c.due))
  const planBlockerKeys = new Set(
    plan.blockers.map((b) => `${b.start_date}|${b.end_date}`),
  )
  const phaseKeys = new Set(Object.keys(plan.goal?.phase_objectives ?? {}))

  // Intent-specific structural bounds.
  if (intent === 'add_goal') {
    if (!plan.goal) {
      errors.push('add_goal requires a non-null plan.goal')
    }
    const mc = plan.milestones.length
    if (mc < MIN_MILESTONES || mc > MAX_MILESTONES) {
      errors.push(
        `add_goal requires ${MIN_MILESTONES}-${MAX_MILESTONES} milestones (got ${mc})`,
      )
    }
    const cc = plan.commitments.length
    if (cc < MIN_COMMITMENTS || cc > MAX_COMMITMENTS) {
      errors.push(
        `add_goal requires ${MIN_COMMITMENTS}-${MAX_COMMITMENTS} commitments (got ${cc})`,
      )
    }
  }

  for (const tool of emit.tools) {
    if (!allowed.includes(tool.action)) {
      errors.push(`Action '${tool.action}' is not allowed for intent '${intent}'`)
      continue
    }

    const parsed = ACTION_ARG_SCHEMAS[tool.action].safeParse(tool.args)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ')
      errors.push(`Action '${tool.action}' args invalid: ${detail}`)
      continue
    }
    const args = parsed.data as Record<string, any>

    switch (tool.action) {
      case 'create_goal': {
        if (planTitle && norm(String(args.title)) !== planTitle) {
          errors.push(
            `create_goal.title '${args.title}' does not match plan.goal.title '${plan.goal?.title}'`,
          )
        }
        break
      }
      case 'add_milestone': {
        const gt = norm(String(args.goal_title))
        if (!knownTitles.has(gt)) {
          errors.push(
            `add_milestone.goal_title '${args.goal_title}' matches no plan/existing goal`,
          )
        }
        if (!planMilestoneDates.has(args.target_date)) {
          errors.push(
            `add_milestone.target_date '${args.target_date}' is not in plan.milestones`,
          )
        }
        const planned = milestoneByTitle.get(norm(String(args.title)))
        if (planned && planned.phase !== args.phase) {
          errors.push(
            `add_milestone.phase '${args.phase}' does not match plan milestone phase '${planned.phase}'`,
          )
        }
        if (phaseKeys.size > 0 && !phaseKeys.has(args.phase)) {
          errors.push(
            `add_milestone.phase '${args.phase}' is not a key in plan.goal.phase_objectives`,
          )
        }
        break
      }
      case 'add_commitment': {
        const gt = norm(String(args.goal_title))
        if (!knownTitles.has(gt)) {
          errors.push(
            `add_commitment.goal_title '${args.goal_title}' matches no plan/existing goal`,
          )
        }
        if (!planCommitmentDues.has(args.due)) {
          errors.push(
            `add_commitment.due '${args.due}' is not in plan.commitments`,
          )
        }
        if (phaseKeys.size > 0 && !phaseKeys.has(args.phase)) {
          errors.push(
            `add_commitment.phase '${args.phase}' is not a key in plan.goal.phase_objectives`,
          )
        }
        break
      }
      case 'add_blocker': {
        const key = `${args.start_date}|${args.end_date}`
        if (!planBlockerKeys.has(key)) {
          errors.push(
            `add_blocker dates ${key} are not in plan.blockers (the LLM must not invent blockers)`,
          )
        }
        break
      }
      default:
        // update_goal / drop_goal / pause_goal / set_goal_dates /
        // complete_commitment — arg schema already validated; no
        // plan-coherence rule beyond the allowed-action check.
        break
    }
  }

  return { ok: errors.length === 0, errors }
}
