/**
 * Goal Planner — per-stage prompts (Slice 3).
 *
 * The IP lives in `lib/llm/prompts.ts` (`SYSTEM_PROMPT`). These prompts are
 * additive: they reference the shared voice rather than restating it, and
 * describe the JSON each stage must emit (so the text-fallback path has the
 * field contract too).
 *
 * Voice (from SYSTEM_PROMPT): precise/curious, never warm/validating. No
 * greetings, no filler.
 */

import type { Intent, Plan, RenegotiationOption } from './schemas'

const VOICE =
  'Voice: precise and curious, never warm or validating. No greetings, no ' +
  'filler, no "great job". Name the actual constraint the user did not name.'

export function intakePrompt(args: {
  intent: Intent
  message: string
  context: string
  today: string
}): string {
  return `${VOICE}

You are stage 1 (Intake) of a planning pipeline. Classify the user's message.
Today is ${args.today}. Conversation intent: ${args.intent}.

Return a JSON object with:
- "shape": one of "one_new_goal" | "multiple_goals" | "over_committed" |
  "returning_after_gap" | "meta_question" | "routine_return".
- "needs_clarification": boolean. True only when a plan is impossible without
  one or two facts (and intent is not drop_goal / review_progress).
- "clarifying_questions": array of 0-2 sharp questions. Ask only what changes
  the plan.
- "referenced_goal_titles": existing goal titles the message names.
- "framing_line": one short line, or "".

Do not plan here. Classify only.

=== LIVE STATE ===
${args.context}`
}

export function planPrompt(args: {
  intent: Intent
  message: string
  context: string
  today: string
  renegotiation?: {
    choice: RenegotiationOption
    priorPlan: Plan
    constraint: string
  }
}): string {
  const reneg = args.renegotiation
    ? `

=== RENEGOTIATION (round constraint) ===
The previous plan over-committed the user. Apply this choice and re-plan:
- choice: ${args.renegotiation.choice}
- constraint: ${args.renegotiation.constraint}
- previous plan: ${JSON.stringify(args.renegotiation.priorPlan)}
Keep the same goal unless the choice is to drop/replace it.`
    : ''

  return `${VOICE}

You are stage 3 (Plan). Produce a realistic, phased plan for the user's
message. Today is ${args.today}. Conversation intent: ${args.intent}.

Return a JSON object:
{
  "goal": { "title", "horizon": "weekly|short|medium|long", "why",
            "first_action", "start_date": "YYYY-MM-DD",
            "target_date": "YYYY-MM-DD", "weekly_hours": 1-20,
            "phase_objectives": { "<phase>": "<verifiable objective>", ... } }
          | null,
  "milestones": [ { "title", "target_date", "phase", "rationale" } ],   // ≤5
  "blockers":  [ { "title", "start_date", "end_date", "note" } ],       // ≤3
  "commitments": [ { "goal_title", "text", "due", "phase" } ],          // ≤3
  "prose": "one short paragraph (≤500 chars)"
}

Rules:
- Decompose into 2-4 phases; each phase_objectives value must be OBSERVABLE
  from outside ("Pass 5 SD mocks", not "read Ch 5"). 3-5 milestones, grouped by
  phase (milestone.phase MUST be a phase_objectives key).
- Commitments are the SMALLEST next actions in the next 1-4 days (setup
  actions), and their "due" must be one of them.
- Emit blockers ONLY if the user named them. Never invent a blocker.
- If the user already did something, do not re-propose it.
- Prefer a realistic target_date with buffer over an optimistic one, and name
  the trade-off in prose.
- prose must name the load-bearing constraint that, if it breaks, breaks the plan.
- If intent is drop_goal / review_progress and no new goal is warranted, goal
  may be null and milestones may be empty.

${reneg}

=== LIVE STATE ===
${args.context}`
}

export function emitPrompt(args: {
  intent: Intent
  plan: Plan
}): string {
  return `${VOICE}

You are stage 4 (Emit). Convert the plan below into an ordered list of tool
calls. Return:
{ "tools": [ { "action": "<action>", "args": { ... } } ] }   // 1-8 tools

Fixed order when creating a goal: create_goal, then add_milestone ×N, then
add_blocker ×N, then add_commitment ×N.

Allowed actions for intent "${args.intent}":
- add_goal: create_goal, add_milestone, add_blocker, add_commitment
- plan_day: add_commitment, complete_commitment, add_blocker
- edit_goal: update_goal, set_goal_dates, add_milestone, add_blocker, add_commitment
- drop_goal: drop_goal, pause_goal
- review_progress: update_goal, set_goal_dates, add_commitment,
  complete_commitment, add_blocker, pause_goal, drop_goal

Every add_milestone.add_goal reference and add_commitment.goal_title must match
the plan goal title (or an existing goal's exact title). Every
add_milestone.target_date / add_commitment.due must come from the plan. Every
phase must be a phase_objectives key.

Use these EXACT arg keys — do not rename or omit them:
- create_goal: { title, horizon, why, first_action, start_date, target_date,
  weekly_hours, phase_objectives, life_area }
- add_milestone: { goal_title, title, target_date, phase }
- add_blocker: { title, start_date, end_date, note }
- add_commitment: { goal_title, text, due, phase }

Copy weekly_hours and phase_objectives VERBATIM from the plan goal. Every
milestone and commitment must carry its phase.

=== PLAN ===
${JSON.stringify(args.plan)}`
}

export function emitRetrySuffix(errors: string[]): string {
  return `

=== CROSS-VALIDATION FAILED — FIX AND RE-EMIT ===
${errors.map((e) => `- ${e}`).join('\n')}
Emit the corrected { "tools": [...] } only.`
}

/** The four renegotiation buttons surfaced when Stage 3.5 says no. */
export const RENEGOTIATION_OPTIONS: readonly RenegotiationOption[] = [
  'shift_existing_target',
  'drop_existing_commitment',
  'extend_new_timeline',
  'reduce_new_hours',
]

export const RENEGOTIATION_LABELS: Record<RenegotiationOption, string> = {
  shift_existing_target: 'Shift an existing goal’s target date',
  drop_existing_commitment: 'Drop a commitment from an existing goal',
  extend_new_timeline: 'Extend this goal’s timeline',
  reduce_new_hours: 'Reduce this goal’s weekly hours',
}
