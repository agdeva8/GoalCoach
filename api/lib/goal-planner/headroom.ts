/**
 * Goal Planner — Stage 3.5, the programmatic headroom check. No LLM.
 *
 * The PRD's decision tree (Iteration 10 §The 5-stage pipeline):
 *   total <= budget            → proceed
 *   total > budget, free >= -5 → proceed (prose names the tightness)
 *   free < -5                  → renegotiate
 *
 * Two refinements locked with the founder (see the Slice 0 report):
 *   1. Capacity is ONE global discretionary pool across all life areas, so
 *      `budgetHours` is `users.available_weekly_hours` verbatim.
 *   2. When the budget is unset (null) OR any active goal has no
 *      `weekly_hours` yet, headroom is ADVISORY — it never auto-triggers
 *      renegotiation. Without this, an account with legacy goals would be
 *      told it over-committed on numbers the model made up. (This is the
 *      Iteration-10 F4 fix.)
 */

import { CAP_TIGHT_SLACK_HOURS } from './config'

export interface HeadroomGoalInput {
  /** `goals.weekly_hours`; null = not yet estimated. */
  weeklyHours: number | null
}

export interface HeadroomInput {
  /** `users.available_weekly_hours`; null = user has not set a budget. */
  budgetHours: number | null
  activeGoals: readonly HeadroomGoalInput[]
  /** `plan.goal.weekly_hours` for the proposed plan. */
  newWeeklyHours: number
}

export type HeadroomDecision =
  | 'proceed'
  | 'proceed_tight'
  | 'renegotiate'
  | 'advisory'

export interface HeadroomResult {
  decision: HeadroomDecision
  budgetHours: number | null
  /** Sum of KNOWN active goal estimates (nulls excluded). */
  currentLoad: number
  newLoad: number
  total: number
  /** `budgetHours - total`, or null when no budget is set. */
  free: number | null
  /** Active goals with no `weekly_hours` — makes the sum approximate. */
  unknownGoalCount: number
  /** Human-readable, for the Stage 3 prose / renegotiation UI. */
  message: string
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function checkHeadroom(input: HeadroomInput): HeadroomResult {
  const known = input.activeGoals.filter(
    (g) => typeof g.weeklyHours === 'number',
  )
  const unknownGoalCount = input.activeGoals.length - known.length
  const currentLoad = round1(
    known.reduce((sum, g) => sum + (g.weeklyHours as number), 0),
  )
  const newLoad = input.newWeeklyHours
  const total = round1(currentLoad + newLoad)
  const budget = input.budgetHours

  // No budget → advisory. Nothing to enforce against.
  if (budget === null || budget === undefined) {
    return {
      decision: 'advisory',
      budgetHours: null,
      currentLoad,
      newLoad,
      total,
      free: null,
      unknownGoalCount,
      message:
        'No weekly budget set — headroom is advisory until you set one in Settings.',
    }
  }

  const free = round1(budget - total)

  // Budget set but the load figure is incomplete → advisory, never
  // renegotiate on a partial sum.
  if (unknownGoalCount > 0) {
    return {
      decision: 'advisory',
      budgetHours: budget,
      currentLoad,
      newLoad,
      total,
      free,
      unknownGoalCount,
      message: `${unknownGoalCount} active goal(s) have no weekly estimate yet — headroom is approximate.`,
    }
  }

  if (total <= budget) {
    return {
      decision: 'proceed',
      budgetHours: budget,
      currentLoad,
      newLoad,
      total,
      free,
      unknownGoalCount,
      message: `Fits with ${round1(free)}h of headroom.`,
    }
  }

  if (free >= -CAP_TIGHT_SLACK_HOURS) {
    return {
      decision: 'proceed_tight',
      budgetHours: budget,
      currentLoad,
      newLoad,
      total,
      free,
      unknownGoalCount,
      message: `Tight — you'd be ${round1(-free)}h over your ${budget}h budget.`,
    }
  }

  return {
    decision: 'renegotiate',
    budgetHours: budget,
    currentLoad,
    newLoad,
    total,
    free,
    unknownGoalCount,
    message: `Overcommits by ${round1(-free)}h (budget ${budget}h, load ${total}h).`,
  }
}
