/**
 * Sutra state builder — ported from backend/server.py:522-563.
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
 *   buildContext(userId, conversationId, kind, latestMessage, autoAnswer, intent?) -> string
 *   loadHistory(userId, conversationId, limit) -> ChatHistoryMessage[]
 *
 * Iteration N: history is now scoped to a single conversation bucket
 * (atomic per-operation), and `buildContext` is operation-aware — an
 * `add_goal` conversation sees a slim state snapshot (titles + load),
 * while `general` keeps the full Python-parity dump. `plan_day` /
 * `edit_goal` / `drop_goal` show the relevant open commitments and the
 * scoped entity, with everything else omitted. The state-impact
 * reasoning happens in the LLM via the [[IMPACT]] block, not here.
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

import { cacheKey, readThrough } from '@/lib/cache'
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

/** Cache namespace for the `loadState` read model (see lib/cache.ts). */
export const COACH_STATE_NS = 'coach_state'

/**
 * Public entry point — READ-THROUGH CACHED.
 *
 * Every consumer (dashboard `GET /api/state`, the chat context builder,
 * `tools/confirm`'s response) shares one entry per user. It is refreshed
 * write-through by `refreshDashboardState()` after any state-affecting
 * mutation, and expires after `DEFAULT_TTL_MS` as the cross-instance safety
 * net. Call `loadStateCore()` when you deliberately need an uncached read.
 */
export async function loadState(userId: string): Promise<CoachState> {
  return readThrough(cacheKey(userId, COACH_STATE_NS), () =>
    loadStateCore(userId),
  )
}

/**
 * Uncached body of `loadState`.
 *
 * The five table reads are independent and now run CONCURRENTLY: against
 * the remote Supabase pooler each one is a full round trip, and running
 * them back-to-back made this the single most expensive call in the app
 * (measured 1.4–2.6s for a dashboard load before caching). The variables
 * are declared in the original sequential order — mocks that discriminate
 * tables by `.from()` arrival order depend on it.
 */
export async function loadStateCore(userId: string): Promise<CoachState> {
  // goals — sort by created_at ASC, limit 500. Same shape as Mongo's
  // `.find({...}, {"_id": 0}).sort("created_at", 1).to_list(500)` —
  // Drizzle doesn't project out `_id` because Postgres tables don't
  // have one, so we just select the columns we need.
  const qGoals = db
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

  const qCommitments = db
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

  const qMilestones = db
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

  const qBlockers = db
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
  const qSources = db
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

  // Join all five: Promise.all resolves them in one wall-clock round trip
  // instead of five. The query objects are built in the original order
  // above, so table-arrival-order mocks still see
  // goals → commitments → milestones → blockers → sources.
  const [
    goalsRows,
    commitmentsRows,
    milestonesRows,
    blockersRows,
    sourcesRows,
  ] = await Promise.all([
    qGoals,
    qCommitments,
    qMilestones,
    qBlockers,
    qSources,
  ])

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
/* loadHistory — load the last N messages in a single conversation bucket.   */
/*                                                                            */
/* Iteration N: was previously "last N messages by userId" — that bled the   */
/* prior goal's conversation into the LLM prompt on every new operation.    */
/* Now: `conversationId` is a REQUIRED argument; the query filters by it.    */
/* For `general` chats the caller still passes 24 to keep Python parity;    */
/* for scoped operations the caller passes 12 (or whatever fits the surface).*/
/* -------------------------------------------------------------------------- */

export async function loadHistory(
  userId: string,
  conversationId: string,
  limit = 24,
): Promise<ChatHistoryMessage[]> {
  if (!conversationId) {
    // Defensive — refusing to silently fall back to the old global filter.
    throw new Error('loadHistory: conversationId is required')
  }

  const rows = await db
    .select({
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(eq(messages.userId, userId), eq(messages.conversationId, conversationId)),
    )
    .orderBy(asc(messages.createdAt))
    // Pull a small headroom then trim — keeps the SQL simple and matches
    // the Python slice semantics (`history[-limit:]`). Per-bucket message
    // counts are small (single-digit typical), so 100 is plenty.
    .limit(Math.max(limit * 4, 100))

  // Python slice semantics: last N items of an oldest-first list.
  const tail = rows.slice(-limit)
  return tail.map((m) => ({ role: m.role, content: m.content }))
}

/* -------------------------------------------------------------------------- */
/* buildContext — operation-aware port of server.py:522-563.                   */
/*                                                                             */
/* Iteration N: signature now requires `conversationId` + `kind`. Three      */
/* branches:                                                                   */
/*   - 'add_goal'  → slim context (titles + load + atomic history) — the     */
/*                   LLM only needs current state to reason about impact,    */
/*                   not the full app dump. This is what fixes the "HU       */
/*                   plans for old goal" bug.                                 */
/*   - 'plan_day' | 'edit_goal' | 'drop_goal' → scoped context (open commit- */
/*                   ments + scoped entity, no other goals). The conversation*/
/*                   is about ONE entity; full state would be noise.         */
/*   - 'general' → full Python-parity dump. The left-rail chat stays a free- */
/*                 form coaching surface and sees everything.                */
/*                                                                            */
/* RECENT CONVERSATION is always filtered to the current bucket regardless   */
/* of kind (operation isolation principle).                                   */
/* -------------------------------------------------------------------------- */

export type ConversationKind =
  | 'general'
  | 'add_goal'
  | 'plan_day'
  | 'review_progress'
  | 'edit_goal'
  | 'drop_goal'

/**
 * What the opener told the USER this chat is for (the modal's title bar +
 * helper line). Scoped chats now start from an EMPTY composer — the canned
 * prefill is gone — so these two strings are the only signal of which
 * button the user pressed, and the model has to carry that intent.
 */
export interface ConversationIntent {
  title?: string
  helperText?: string
}

export async function buildContext(
  userId: string,
  conversationId: string,
  kind: ConversationKind,
  latestMessage: string,
  autoAnswer = false,
  intent?: ConversationIntent,
): Promise<string> {
  void latestMessage // Reserved: future "RETURNING AFTER A GAP" detection
  void autoAnswer // Already rendered in the header below.

  if (!conversationId) {
    throw new Error('buildContext: conversationId is required')
  }

  const historyLimit = kind === 'general' ? 24 : 12

  const [state, history] = await Promise.all([
    loadState(userId),
    loadHistory(userId, conversationId, historyLimit),
  ])

  // The following block renders the LIVE STATE & MEMORY section. Output
  // formatting (newlines, separators, chip text) must stay identical for
  // the `general` branch (Python parity); the other branches have their
  // own slim shape designed for the LLM to reason about impact without
  // hallucinating cross-context plans.
  const lines: string[] = []

  // First two header lines — match Python's `datetime.now(timezone.utc)`
  // output and the AUTO-ANSWER MODE banner.
  lines.push(`Today is ${new Date().toISOString().slice(0, 10)}.`)
  lines.push(`AUTO-ANSWER MODE: ${autoAnswer ? 'on' : 'off'}.`)

  // The SYSTEM_PROMPT's "=== OPERATION MODE ===" section is keyed off the
  // conversation kind — it literally tells the model "the conversation's
  // kind (in LIVE STATE) tells you what surface the user is on" — but the
  // kind was never rendered into this string, so every conversation read
  // as free-form GENERAL. Emit it, plus the opener's intent: scoped chats
  // start from an empty composer now (no canned prefill), so title +
  // helper line are the only trace of which button opened the window.
  lines.push(`KIND: "${kind}"`)
  const intentTitle = intent?.title?.trim()
  if (intentTitle) {
    lines.push('')
    lines.push(`CONVERSATION INTENT: ${intentTitle}`)
    const intentHelp = intent?.helperText?.trim()
    if (intentHelp) lines.push(intentHelp)
  }

  if (kind === 'add_goal') {
    // Slim context — title-only goals + load. No commitments, no
    // milestones, no blockers. The LLM needs the current load to reason
    // about over-commitment impact, but the full dump is noise for a
    // "create one new goal" operation.
    const liveGoals = state.goals.filter((g) => g.status !== 'dropped')
    if (liveGoals.length > 0) {
      lines.push('CURRENT TRACKED GOALS (titles only):')
      for (const g of liveGoals) {
        lines.push(`- ${g.title} (${g.horizon}, ${g.status})`)
      }
    } else {
      lines.push('CURRENT TRACKED GOALS: none yet.')
    }
    const oc = state.over_commitment
    lines.push('')
    lines.push(
      `LOAD: ${oc.active_goals} active goals, ${oc.open_commitments} open commitments. Level: ${oc.level}.`,
    )
  } else if (kind === 'plan_day' || kind === 'edit_goal' || kind === 'drop_goal') {
    // Scoped context — see the entity the conversation is about plus the
    // open commitments the user is juggling. Full state would be noise.
    const liveGoals = state.goals.filter((g) => g.status !== 'dropped')
    if (liveGoals.length > 0) {
      lines.push('CURRENT TRACKED GOALS (titles only):')
      for (const g of liveGoals) {
        lines.push(`- ${g.title} (${g.horizon}, ${g.status})`)
      }
    }
    const openCommits = state.commitments.filter((c) => c.status === 'open')
    if (openCommits.length > 0) {
      lines.push('')
      lines.push('OPEN COMMITMENTS (titles only):')
      for (const c of openCommits.slice(0, 50)) {
        lines.push(`- ${c.text} [goal: ${c.goal_title ?? ''}]`)
      }
    }
  } else {
    // 'general' — full Python-parity dump. Don't refactor this branch;
    // it must stay byte-for-byte compatible with the legacy behaviour.
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
  }

  // RECENT CONVERSATION — always filtered to the current bucket (the
  // operation isolation principle). Length differs by kind.
  if (history.length > 0) {
    lines.push('')
    lines.push('RECENT CONVERSATION (oldest first):')
    for (const m of history) {
      const role = m.role === 'user' ? 'User' : 'Coach'
      lines.push(`${role}: ${m.content}`)
    }
  } else {
    lines.push('')
    lines.push('This is the first message in this conversation.')
  }

  return lines.join('\n')
}