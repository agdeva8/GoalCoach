/**
 * Proposal executor — port of `apply_proposal` from backend/server.py:312-424.
 *
 * Source of truth:
 *   - backend/server.py:312-424 (the Python function we're porting)
 *   - migration/discovery/03-nextjs-architecture.md Section 4 ("Tool proposal model")
 *   - y/db/schema.ts (the Drizzle schema we write to)
 *
 * What this file is responsible for:
 *   - Take a confirmed proposal `{ id, action, args }` and write its effect
 *     to the goals / commitments / milestones / blockers tables.
 *   - Each action runs in its own Drizzle transaction so a partial write
 *     cannot leave the database in a half-updated state.
 *   - Return `{ success, result }` where `result` is the human-readable
 *     confirmation line shown back to the user (mirrors the Python
 *     `return f"…"` strings).
 *
 * What this file is NOT responsible for:
 *   - Updating `proposals.status` from pending -> confirmed. The route
 *     handler (`app/api/tools/confirm/route.ts`) does that so the status
 *     change is observable even when the underlying action is rejected by
 *     the executor (e.g. "no matching goal"). This mirrors the Python
 *     `_find_proposal` + `apply_proposal` split.
 *   - Auth. Route handlers must verify session ownership before calling
 *     `applyProposal`.
 *
 * Design decisions vs. the Python original:
 *   1. **ID-based, not title-based.** The Python version fuzzy-matches
 *      `goal_title` text. The new schema gives every row a stable string
 *      ID (`goal_xxx`, `commit_xxx` …) and every tool's zod schema
 *      requires `goal_id` / `commitment_id`. This eliminates the
 *      "no matching goal for 'Runn'" failure mode entirely.
 *   2. **One transaction per action.** Drizzle's `db.transaction` gives
 *      atomic per-action semantics. The Python original issued one Mongo
 *      `update_one` per action; Postgres transactions are cheap so we use
 *      them everywhere.
 *   3. **Lazy DB import.** Importing `@/lib/db` triggers env validation
 *      (DATABASE_URL etc.) at module load, which crashes the test suite
 *      where no env is configured. We `await import('@/lib/db')` inside
 *      each function instead. drizzle-orm itself has no side effects so
 *      its imports stay at the top of the file.
 */

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface Proposal {
  id: string
  action: string
  args: Record<string, any>
}

export interface ApplyProposalResult {
  success: boolean
  result: string
}

/** Mirrors the Postgres enum in `db/schema.ts`. */
const HORIZONS = ['weekly', 'short', 'medium', 'long'] as const
type Horizon = (typeof HORIZONS)[number]

/** Mirrors the Postgres enum in `db/schema.ts`. */
const GOAL_STATUSES = ['active', 'paused', 'dropped'] as const
type GoalStatus = (typeof GOAL_STATUSES)[number]

/* -------------------------------------------------------------------------- */
/* Lazy DB / schema loaders                                                   */
/*                                                                             */
/* Imported as a function (not at module top-level) so vitest can load this   */
/* module without DATABASE_URL/AUTH_SECRET/etc. set. The production server    */
/* still gets env-validated at first request — `lib/env.ts` is a hard boot    */
/* gate, the lazy import just delays it from "import time" to "first call".   */
/* -------------------------------------------------------------------------- */

async function getDbAndSchema() {
  const [{ db }, schema] = await Promise.all([
    import('@/lib/db'),
    import('@/db/schema'),
  ])
  return { db, schema }
}

/* -------------------------------------------------------------------------- */
/* ID generator (mirrors backend `new_id(prefix)` shape)                     */
/* -------------------------------------------------------------------------- */

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

/** Today's date in ISO `YYYY-MM-DD` (UTC), matching Python's default. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Apply a confirmed proposal to the database.
 *
 * Returns a human-readable `result` line. The function never throws on
 * business-logic failures (missing goal, etc.) — those are returned as
 * `success: false` with a `result` that names what went wrong, so the
 * caller can surface the message to the user without try/catch.
 *
 * Unknown `action` strings return `{ success: false, result: "Unknown
 * action '…'" }`. The route handler is expected to 502 in that case.
 */
export async function applyProposal(
  userId: string,
  proposal: Proposal
): Promise<ApplyProposalResult> {
  const { db, schema } = await getDbAndSchema()

  switch (proposal.action) {
    case 'create_goal':
      return applyCreateGoal(db, schema, userId, proposal)
    case 'update_goal':
      return applyUpdateGoal(db, schema, userId, proposal)
    case 'drop_goal':
      return applyStatusChange(db, schema, userId, proposal, 'dropped', 'Dropped')
    case 'pause_goal':
      return applyStatusChange(db, schema, userId, proposal, 'paused', 'Paused')
    case 'set_goal_dates':
      return applySetGoalDates(db, schema, userId, proposal)
    case 'add_milestone':
      return applyAddMilestone(db, schema, userId, proposal)
    case 'add_blocker':
      return applyAddBlocker(db, schema, userId, proposal)
    case 'add_commitment':
      return applyAddCommitment(db, schema, userId, proposal)
    case 'complete_commitment':
      return applyCompleteCommitment(db, schema, userId, proposal)
    default:
      return { success: false, result: `Unknown action '${proposal.action}'` }
  }
}

/* -------------------------------------------------------------------------- */
/* Per-action implementations                                                  */
/*                                                                             */
/* Each is a self-contained `db.transaction(async (tx) => { … })` block. We   */
/* don't reuse a single transaction because each action is independent —      */
/* one failure should not roll back an earlier successful write from another  */
/* call to applyProposal.                                                     */
/* -------------------------------------------------------------------------- */

async function applyCreateGoal(
  db: any,
  schema: any,
  userId: string,
  proposal: Proposal
): Promise<ApplyProposalResult> {
  const args = proposal.args
  const title: string = args.title ?? 'Untitled goal'
  const horizon: Horizon = (HORIZONS as readonly string[]).includes(args.horizon)
    ? args.horizon
    : 'medium'
  const why: string = args.why ?? ''
  const nextAction: string = args.next_action ?? ''
  const startDate: string = args.start_date ?? todayIso()
  const targetDate: string | null = args.target_date ?? null

  const goalId = newId('goal')

  await db.transaction(async (tx: any) => {
    await tx.insert(schema.goals).values({
      id: goalId,
      userId,
      title,
      horizon,
      why,
      nextAction,
      startDate,
      targetDate,
      status: 'active',
    })
    await tx.insert(schema.auditLog).values({
      id: newId('audit'),
      userId,
      type: `confirm:${proposal.action}`,
      summary: `Created goal '${title}' (${horizon})`,
      payload: { proposal_id: proposal.id, args },
    })
  })

  return {
    success: true,
    result: `Created goal '${title}' (${horizon})`,
  }
}

async function applyUpdateGoal(
  db: any,
  schema: any,
  userId: string,
  proposal: Proposal
): Promise<ApplyProposalResult> {
  const args = proposal.args
  const goalId: string | undefined = args.goal_id
  if (!goalId) {
    return { success: false, result: `Missing goal_id for update_goal` }
  }

  // Pre-flight: confirm the goal exists and is owned by this user.
  const existing = await db
    .select({ id: schema.goals.id, title: schema.goals.title })
    .from(schema.goals)
    .where(and(eq(schema.goals.userId, userId), eq(schema.goals.id, goalId)))
    .limit(1)
  if (!existing.length) {
    return { success: false, result: `No matching goal for '${goalId}'` }
  }

  const updates: Record<string, any> = { updatedAt: new Date() }
  if (typeof args.title === 'string' && args.title.length > 0) {
    updates.title = args.title
  }
  if (typeof args.why === 'string') {
    updates.why = args.why
  }
  if (typeof args.next_action === 'string') {
    updates.nextAction = args.next_action
  }
  if (
    typeof args.status === 'string' &&
    (GOAL_STATUSES as readonly string[]).includes(args.status)
  ) {
    updates.status = args.status as GoalStatus
  }
  if (typeof args.target_date === 'string') {
    updates.targetDate = args.target_date
  }

  const existingTitle = existing[0].title

  await db.transaction(async (tx: any) => {
    await tx.update(schema.goals).set(updates).where(eq(schema.goals.id, goalId))
    await tx.insert(schema.auditLog).values({
      id: newId('audit'),
      userId,
      type: `confirm:${proposal.action}`,
      summary: `Updated goal '${existingTitle}'`,
      payload: { proposal_id: proposal.id, args },
    })
  })

  return {
    success: true,
    result: `Updated goal '${existingTitle}'`,
  }
}

/**
 * Shared implementation for drop_goal and pause_goal.
 *
 * Lifted out so both terminal/pause transitions share identical
 * transaction + audit semantics — and so future maintainers find one
 * place to update when "what does a goal status change audit entry look
 * like" inevitably changes.
 */
async function applyStatusChange(
  db: any,
  schema: any,
  userId: string,
  proposal: Proposal,
  newStatus: GoalStatus,
  verb: 'Dropped' | 'Paused'
): Promise<ApplyProposalResult> {
  const goalId: string | undefined = proposal.args.goal_id
  if (!goalId) {
    return { success: false, result: `Missing goal_id for ${proposal.action}` }
  }
  const reason: string | undefined = proposal.args.reason

  const rows = await db
    .select({ id: schema.goals.id, title: schema.goals.title })
    .from(schema.goals)
    .where(and(eq(schema.goals.userId, userId), eq(schema.goals.id, goalId)))
    .limit(1)
  if (!rows.length) {
    return { success: false, result: `No matching goal for '${goalId}'` }
  }
  const title = rows[0].title

  await db.transaction(async (tx: any) => {
    await tx
      .update(schema.goals)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(schema.goals.id, goalId))
    await tx.insert(schema.auditLog).values({
      id: newId('audit'),
      userId,
      type: `confirm:${proposal.action}`,
      summary: `${verb} goal '${title}'${reason ? ` (${reason})` : ''}`,
      payload: { proposal_id: proposal.id, args: proposal.args },
    })
  })

  return { success: true, result: `${verb} goal '${title}'` }
}

async function applySetGoalDates(
  db: any,
  schema: any,
  userId: string,
  proposal: Proposal
): Promise<ApplyProposalResult> {
  const args = proposal.args
  const goalId: string | undefined = args.goal_id
  if (!goalId) {
    return { success: false, result: `Missing goal_id for set_goal_dates` }
  }

  const updates: Record<string, any> = { updatedAt: new Date() }
  if (typeof args.start_date === 'string') updates.startDate = args.start_date
  if (typeof args.target_date === 'string') updates.targetDate = args.target_date
  if (updates.startDate === undefined && updates.targetDate === undefined) {
    return {
      success: false,
      result: `set_goal_dates requires start_date or target_date`,
    }
  }

  const rows = await db
    .select({ id: schema.goals.id, title: schema.goals.title })
    .from(schema.goals)
    .where(and(eq(schema.goals.userId, userId), eq(schema.goals.id, goalId)))
    .limit(1)
  if (!rows.length) {
    return { success: false, result: `No matching goal for '${goalId}'` }
  }
  const title = rows[0].title

  await db.transaction(async (tx: any) => {
    await tx.update(schema.goals).set(updates).where(eq(schema.goals.id, goalId))
    await tx.insert(schema.auditLog).values({
      id: newId('audit'),
      userId,
      type: `confirm:${proposal.action}`,
      summary: `Timeline set for '${title}': ${args.start_date ?? '?'} -> ${args.target_date ?? '?'}`,
      payload: { proposal_id: proposal.id, args },
    })
  })

  return {
    success: true,
    result: `Timeline set for '${title}': ${args.start_date ?? '?'} -> ${args.target_date ?? '?'}`,
  }
}

async function applyAddMilestone(
  db: any,
  schema: any,
  userId: string,
  proposal: Proposal
): Promise<ApplyProposalResult> {
  const args = proposal.args
  const goalId: string | undefined = args.goal_id
  const title: string = args.title ?? ''
  const targetDate: string | null = args.target_date ?? null

  let goalTitle = ''
  if (goalId) {
    const rows = await db
      .select({ title: schema.goals.title })
      .from(schema.goals)
      .where(and(eq(schema.goals.userId, userId), eq(schema.goals.id, goalId)))
      .limit(1)
    if (rows.length) goalTitle = rows[0].title
  }

  await db.transaction(async (tx: any) => {
    await tx.insert(schema.milestones).values({
      id: newId('mile'),
      userId,
      goalId: goalId ?? null,
      goalTitle,
      title,
      targetDate,
      status: 'open',
    })
    await tx.insert(schema.auditLog).values({
      id: newId('audit'),
      userId,
      type: `confirm:${proposal.action}`,
      summary: `Milestone '${title}' -> ${targetDate ?? ''}`,
      payload: { proposal_id: proposal.id, args },
    })
  })

  return {
    success: true,
    result: `Milestone '${title}' -> ${targetDate ?? ''}`,
  }
}

async function applyAddBlocker(
  db: any,
  schema: any,
  userId: string,
  proposal: Proposal
): Promise<ApplyProposalResult> {
  const args = proposal.args
  const title: string = args.title ?? ''
  const startDate: string = args.start_date ?? todayIso()
  const endDate: string = args.end_date ?? startDate
  const note: string = args.note ?? ''

  await db.transaction(async (tx: any) => {
    await tx.insert(schema.blockers).values({
      id: newId('block'),
      userId,
      title,
      startDate,
      endDate,
      note,
    })
    await tx.insert(schema.auditLog).values({
      id: newId('audit'),
      userId,
      type: `confirm:${proposal.action}`,
      summary: `Blocker '${title}' ${startDate}..${endDate}`,
      payload: { proposal_id: proposal.id, args },
    })
  })

  return {
    success: true,
    result: `Blocker '${title}' ${startDate}..${endDate}`,
  }
}

async function applyAddCommitment(
  db: any,
  schema: any,
  userId: string,
  proposal: Proposal
): Promise<ApplyProposalResult> {
  const args = proposal.args
  const text: string = args.text ?? ''
  const goalId: string | null = args.goal_id ?? null
  const due: string | null = args.due ?? null

  let goalTitle = ''
  if (goalId) {
    const rows = await db
      .select({ title: schema.goals.title })
      .from(schema.goals)
      .where(and(eq(schema.goals.userId, userId), eq(schema.goals.id, goalId)))
      .limit(1)
    if (rows.length) goalTitle = rows[0].title
  }

  await db.transaction(async (tx: any) => {
    await tx.insert(schema.commitments).values({
      id: newId('commit'),
      userId,
      goalId,
      goalTitle,
      text,
      due,
      status: 'open',
    })
    await tx.insert(schema.auditLog).values({
      id: newId('audit'),
      userId,
      type: `confirm:${proposal.action}`,
      summary: `Committed: ${text}`,
      payload: { proposal_id: proposal.id, args },
    })
  })

  return { success: true, result: `Committed: ${text}` }
}

async function applyCompleteCommitment(
  db: any,
  schema: any,
  userId: string,
  proposal: Proposal
): Promise<ApplyProposalResult> {
  const commitmentId: string | undefined = proposal.args.commitment_id
  if (!commitmentId) {
    return {
      success: false,
      result: `Missing commitment_id for complete_commitment`,
    }
  }

  const rows = await db
    .select({ id: schema.commitments.id, text: schema.commitments.text })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.id, commitmentId)
      )
    )
    .limit(1)
  if (!rows.length) {
    return {
      success: false,
      result: `No matching commitment for '${commitmentId}'`,
    }
  }
  const text = rows[0].text

  await db.transaction(async (tx: any) => {
    await tx
      .update(schema.commitments)
      .set({ status: 'done' })
      .where(eq(schema.commitments.id, commitmentId))
    await tx.insert(schema.auditLog).values({
      id: newId('audit'),
      userId,
      type: `confirm:${proposal.action}`,
      summary: `Commitment '${text}' -> done`,
      payload: { proposal_id: proposal.id, args: proposal.args },
    })
  })

  return { success: true, result: `Commitment '${text}' -> done` }
}