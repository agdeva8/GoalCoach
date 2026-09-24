/**
 * GoalCoach state builder — ported from backend/server.py:522-563.
 *
 * `buildContext` produces the string that gets appended to SYSTEM_PROMPT as
 * `=== LIVE STATE & MEMORY ===` for every chat turn. The output structure
 * (heading lines, bullet shape, fallback "none yet", conversation tail)
 * MUST match the Python version 1:1 — the model is tuned against it, and
 * a different chip rendering is the most common regression source after
 * a system prompt change.
 *
 * Re-implemented against the Postgres/Drizzle schema instead of Motor
 * Mongo, but the input/output contract is preserved:
 *
 *   buildContext(userId, latestMessage, autoAnswer) -> string
 *
 * Equivalent Python signature was:
 *   build_context(state, history, user_name, auto_answer=False) -> str
 *
 * The new signature drops `state` and `user_name` (both derived internally
 * now) and drops `history` (the chat route loads the last 24 messages and
 * passes them inline as `history` to keep parity with the Python slice).
 *
 * The `latestMessage` argument is the user message for the current turn —
 * if non-empty we still need to consider it part of the recent
 * conversation even though it hasn't been persisted yet.
 */

import { and, asc, desc, eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import {
  blockers,
  commitments,
  goals,
  messages,
  milestones,
  sources,
} from '@/db/schema'
import {
  computeOverCommitment,
  type OverCommitment,
} from '@/lib/over-commitment'

/* -------------------------------------------------------------------------- */
/* Types — mirror the Python `state` dict shape so callers (e.g. the chat    */
/* route) can pass pre-computed state when they already have it.             */
/* -------------------------------------------------------------------------- */

export interface StateGoal {
  id: string
  title: string
  horizon: 'weekly' | 'short' | 'medium' | 'long'
  status: 'active' | 'paused' | 'dropped'
  next_action?: string | null
  target_date?: string | null
  // Sources attached to this goal (the dashboard renders chips per
  // goal; the chat-time context doesn't currently use these but
  // keeping the field avoids a future migration).
  sources?: StateSource[]
}

export interface StateCommitment {
  id: string
  text: string
  status: 'open' | 'done'
  due?: string | null
  goal_title?: string | null
}

export interface StateMilestone {
  id: string
  title: string
  target_date?: string | null
  goal_title?: string | null
  status: string
}

export interface StateBlocker {
  id: string
  title: string
  start_date?: string | null
  end_date?: string | null
  note?: string | null
}

export interface StateSource {
  id: string
  goal_id: string | null
  goal_title: string
  kind: 'file' | 'link'
  original_filename: string
  content_type: string
  size: number
  url: string
  created_at: string
}

export interface CoachState {
  goals: StateGoal[]
  commitments: StateCommitment[]
  milestones: StateMilestone[]
  blockers: StateBlocker[]
  sources: StateSource[]
  over_commitment: OverCommitment
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

/* -------------------------------------------------------------------------- */
/* Over-commitment heuristic — imported from `lib/over-commitment.ts`.        */
/* `loadState` returns the chip from the canonical helper so the chat-time   */
/* context string and the dashboard UI share the exact same level / message. */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* loadState — Postgres/Drizzle port of server.py:209-255 (load_state).     */
/* -------------------------------------------------------------------------- */

export async function loadState(userId: string): Promise<CoachState> {
  // goals — sort by created_at ASC, limit 500. Same shape as Mongo's
  // `.find({...}, {"_id": 0}).sort("created_at", 1).to_list(500)` —
  // Drizzle doesn't project out `_id` because Postgres tables don't
  // have one, so we just select the columns we need.
  const goalsRows = await db
    .select({
      id: goals.id,
      title: goals.title,
      horizon: goals.horizon,
      status: goals.status,
      nextAction: goals.nextAction,
      targetDate: goals.targetDate,
    })
    .from(goals)
    .where(eq(goals.userId, userId))
    .orderBy(asc(goals.createdAt))
    .limit(500)

  const commitmentsRows = await db
    .select({
      id: commitments.id,
      text: commitments.text,
      status: commitments.status,
      due: commitments.due,
      goalTitle: commitments.goalTitle,
    })
    .from(commitments)
    .where(eq(commitments.userId, userId))
    .orderBy(asc(commitments.createdAt))
    .limit(1000)

  const milestonesRows = await db
    .select({
      id: milestones.id,
      title: milestones.title,
      targetDate: milestones.targetDate,
      goalTitle: milestones.goalTitle,
      status: milestones.status,
    })
    .from(milestones)
    .where(eq(milestones.userId, userId))
    .orderBy(asc(milestones.targetDate))
    .limit(1000)

  const blockersRows = await db
    .select({
      id: blockers.id,
      title: blockers.title,
      startDate: blockers.startDate,
      endDate: blockers.endDate,
      note: blockers.note,
    })
    .from(blockers)
    .where(eq(blockers.userId, userId))
    .orderBy(asc(blockers.startDate))
    .limit(500)

  // The Python version groups sources by goal_id and stamps each goal
  // with `goal["sources"]`. We preserve that field for parity (the chip
  // render in `buildContext` reads `goal.sources`, although the current
  // build_context body in server.py doesn't actually render sources —
  // we keep it for future chat-side source citation without a migration).
  const sourcesRows = await db
    .select({
      id: sources.id,
      goalId: sources.goalId,
      goalTitle: sources.goalTitle,
      kind: sources.kind,
      originalFilename: sources.originalFilename,
      contentType: sources.contentType,
      size: sources.size,
      url: sources.url,
      createdAt: sources.createdAt,
    })
    .from(sources)
    .where(
      and(eq(sources.userId, userId), eq(sources.isDeleted, false)),
    )
    .orderBy(desc(sources.createdAt))
    .limit(500)

  const byGoal = new Map<string, StateSource[]>()
  const sourcesList: StateSource[] = []
  for (const s of sourcesRows) {
    const item: StateSource = {
      id: s.id,
      goal_id: s.goalId,
      goal_title: s.goalTitle,
      kind: s.kind,
      original_filename: s.originalFilename,
      content_type: s.contentType,
      size: s.size,
      url: s.url,
      created_at:
        s.createdAt instanceof Date
          ? s.createdAt.toISOString()
          : String(s.createdAt),
    }
    sourcesList.push(item)
    const key = s.goalId ?? ''
    const arr = byGoal.get(key) ?? []
    arr.push(item)
    byGoal.set(key, arr)
  }

  const goalsList: StateGoal[] = goalsRows.map((g) => ({
    id: g.id,
    title: g.title,
    horizon: g.horizon,
    status: g.status,
    next_action: g.nextAction,
    target_date: g.targetDate,
    sources: byGoal.get(g.id) ?? [],
  }))

  const commitmentsList: StateCommitment[] = commitmentsRows.map((c) => ({
    id: c.id,
    text: c.text,
    status: c.status,
    due: c.due,
    goal_title: c.goalTitle,
  }))

  const milestonesList: StateMilestone[] = milestonesRows.map((m) => ({
    id: m.id,
    title: m.title,
    target_date: m.targetDate,
    goal_title: m.goalTitle,
    status: m.status,
  }))

  const blockersList: StateBlocker[] = blockersRows.map((b) => ({
    id: b.id,
    title: b.title,
    start_date: b.startDate,
    end_date: b.endDate,
    note: b.note,
  }))

  return {
    goals: goalsList,
    commitments: commitmentsList,
    milestones: milestonesList,
    blockers: blockersList,
    sources: sourcesList,
    over_commitment: computeOverCommitment(goalsList, commitmentsList),
  }
}

/* -------------------------------------------------------------------------- */
/* loadHistory — load the last N (default 24) messages for context.         */
/* Matches server.py:612 — `.sort("created_at", 1)` (oldest first) and the  */
/* caller slices `history[-24:]`. We do the slice here so callers can't     */
/* forget it.                                                                */
/* -------------------------------------------------------------------------- */

export async function loadHistory(
  userId: string,
  limit = 24,
): Promise<ChatHistoryMessage[]> {
  const rows = await db
    .select({
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(asc(messages.createdAt))
    // Pull a larger window then trim — keeps the SQL simple and the
    // slice semantics identical to the Python version (`history[-24:]`).
    .limit(2000)

  // Python slice semantics: last N items of an oldest-first list.
  const tail = rows.slice(-limit)
  return tail.map((m) => ({ role: m.role, content: m.content }))
}

/* -------------------------------------------------------------------------- */
/* buildContext — verbatim port of server.py:522-563.                        */
/*                                                                             */
/* Signature changed from                                                       */
/*   build_context(state: dict, history: List[dict], user_name: Optional[str],*/
/*                 auto_answer: bool = False) -> str                           */
/* to                                                                          */
/*   buildContext(userId: string, latestMessage: string,                       */
/*                autoAnswer: boolean = false) -> Promise<string>              */
/* because in the new Next.js runtime both `state` and `history` are loaded   */
/* via Drizzle at request time (chat/route.ts is the only caller). The        */
/* output format is preserved byte-for-byte so model behavior doesn't drift. */
/* -------------------------------------------------------------------------- */

export async function buildContext(
  userId: string,
  latestMessage: string,
  autoAnswer = false,
): Promise<string> {
  void latestMessage // Reserved: future "RETURNING AFTER A GAP" detection
  void autoAnswer // Already rendered in the header below.

  const [state, history] = await Promise.all([
    loadState(userId),
    loadHistory(userId, 24),
  ])

  // The following block is the exact Python build_context body, with
  // snake_case dict access translated to JS property access. Output
  // formatting (newlines, separators, chip text) must stay identical.
  const lines: string[] = []

  // First two header lines — match Python's `datetime.now(timezone.utc)`
  // output and the AUTO-ANSWER MODE banner.
  lines.push(`Today is ${new Date().toISOString().slice(0, 10)}.`)
  lines.push(`AUTO-ANSWER MODE: ${autoAnswer ? 'on' : 'off'}.`)

  // CURRENT TRACKED GOALS — drop dropped goals, render bullet list.
  const liveGoals = state.goals.filter((g) => g.status !== 'dropped')
  if (liveGoals.length > 0) {
    lines.push('CURRENT TRACKED GOALS:')
    for (const g of liveGoals) {
      const na = g.next_action ? ` | next: ${g.next_action}` : ''
      const td = g.target_date ? ` | target: ${g.target_date}` : ''
      lines.push(
        `- [${g.horizon}] ${g.title} (status: ${g.status})${na}${td}`,
      )
    }
  } else {
    lines.push('CURRENT TRACKED GOALS: none yet.')
  }

  // OPEN COMMITMENTS — only status === 'open'.
  const openCommits = state.commitments.filter((c) => c.status === 'open')
  if (openCommits.length > 0) {
    lines.push('')
    lines.push('OPEN COMMITMENTS:')
    for (const c of openCommits) {
      const due = c.due ? ` (due ${c.due})` : ''
      lines.push(`- ${c.text}${due} [goal: ${c.goal_title ?? ''}]`)
    }
  }

  // MILESTONES — all of them (Python doesn't filter).
  if (state.milestones.length > 0) {
    lines.push('')
    lines.push('MILESTONES:')
    for (const m of state.milestones) {
      lines.push(
        `- ${m.title ?? ''} [${m.goal_title ?? ''}] target ${m.target_date ?? ''} (${m.status ?? 'open'})`,
      )
    }
  }

  // BLOCKERS — all of them.
  if (state.blockers.length > 0) {
    lines.push('')
    lines.push('KNOWN BLOCKERS (plan around these):')
    for (const b of state.blockers) {
      lines.push(
        `- ${b.title ?? ''} ${b.start_date ?? ''}..${b.end_date ?? ''} ${b.note ?? ''}`,
      )
    }
  }

  // LOAD summary — one line.
  const oc = state.over_commitment
  lines.push('')
  lines.push(
    `LOAD: ${oc.active_goals} active goals, ${oc.open_commitments} open commitments. Level: ${oc.level}.`,
  )

  // RECENT CONVERSATION — oldest-first slice of last 24 messages.
  if (history.length > 0) {
    lines.push('')
    lines.push('RECENT CONVERSATION (oldest first):')
    for (const m of history) {
      const role = m.role === 'user' ? 'User' : 'Coach'
      lines.push(`${role}: ${m.content}`)
    }
  } else {
    lines.push('')
    lines.push('This is the first message from this user.')
  }

  return lines.join('\n')
}