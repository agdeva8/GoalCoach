/**
 * POST /api/_dev/verify-slice-1 — Slice-1 close-out verification probe.
 *
 * Gated entirely on `ALLOW_DEV_LOGIN=true`. Returns 404 in any other
 * environment so this route is invisible to production traffic.
 *
 * What it does (idempotent):
 *   1. Ensures a `Slice 1 Test Goal` exists for the calling user.
 *   2. Calls `applyProposal` with the three distinct shapes the system
 *      prompt and executor handle, plus a miss case:
 *        (a) `add_milestone` with `goal_title` (LLM shape)
 *        (b) `add_milestone` with `goal_id`   (executor-native)
 *        (c) `add_milestone` with `goal_title` that resolves to nothing
 *            → must return success:false (never a half-written row)
 *   3. Counts orphan milestones (goal_id IS NULL AND goal_title = '')
 *      for the user and reports pass/fail.
 *
 * Returns: 200 with a verdict block on success, 502 on executor failure.
 */
import { sql } from 'drizzle-orm'

import { type NextRequest, NextResponse } from 'next/server'

import { applyProposal } from '@/lib/proposal-executor'
import { db } from '@/lib/db'
import { goals, milestones } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const bearer = req.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim()
  if (bearer && bearer !== 'bogus_xxx') return bearer
  return null
}

export async function POST(req: NextRequest) {
  if (process.env.ALLOW_DEV_LOGIN !== 'true') {
    return NextResponse.json({ detail: 'Not found' }, { status: 404 })
  }
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ detail: 'Missing user_id' }, { status: 400 })
  }

  const goalTitle = 'Slice 1 Test Goal'

  // 1) Ensure the goal exists.
  const existing = await db
    .select({ id: goals.id, title: goals.title })
    .from(goals)
    .where(sql`${goals.userId} = ${userId} AND ${goals.title} = ${goalTitle}`)
    .limit(1)

  let goalId: string
  if (existing[0]) {
    goalId = existing[0].id
  } else {
    const r = await applyProposal(userId, {
      id: `verify_setup_${Date.now()}`,
      action: 'create_goal',
      args: {
        title: goalTitle,
        horizon: 'short',
        why: 'Slice-1 verification probe — fixture goal',
        first_action: 'Accept the setup milestone',
        target_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
      },
    })
    if (!r.success) {
      return NextResponse.json({ ok: false, step: 'create_goal', result: r }, { status: 502 })
    }
    const fresh = await db
      .select({ id: goals.id })
      .from(goals)
      .where(sql`${goals.userId} = ${userId} AND ${goals.title} = ${goalTitle}`)
      .limit(1)
    goalId = fresh[0].id
  }

  // 2a) LLM-shape milestone (goal_title only).
  const rA = await applyProposal(userId, {
    id: `verify_a_${Date.now()}`,
    action: 'add_milestone',
    args: {
      goal_title: goalTitle,
      title: 'Milestone via goal_title (LLM shape)',
      target_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    },
  })

  // 2b) Executor-native milestone (goal_id only).
  const rB = await applyProposal(userId, {
    id: `verify_b_${Date.now()}`,
    action: 'add_milestone',
    args: {
      goal_id: goalId,
      title: 'Milestone via goal_id (executor-native)',
      target_date: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
    },
  })

  // 2c) Miss case — must be rejected, never half-written.
  const rC = await applyProposal(userId, {
    id: `verify_c_${Date.now()}`,
    action: 'add_milestone',
    args: {
      goal_title: 'Imaginary goal that does not exist',
      title: 'Should never be persisted',
    },
  })

  // 3) Verify what landed.
  const linked = await db.execute(sql`
    SELECT title, goal_id IS NOT NULL AS has_id, COALESCE(goal_title, '') AS linked_title
    FROM milestones
    WHERE user_id = ${userId} AND (goal_id = ${goalId} OR goal_title = ${goalTitle})
    ORDER BY target_date
  `)
  const linkedRows = (linked as unknown as { rows: any[] }).rows

  const orphans = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM milestones
    WHERE user_id = ${userId} AND goal_id IS NULL AND goal_title = ''
  `)
  const orphanCount = (orphans as unknown as { rows: any[] }).rows[0].n as number

  // 4) Verdict.
  const verdict = {
    a_success: rA.success === true,
    a_result: rA.result,
    b_success: rB.success === true,
    b_result: rB.result,
    c_correctly_rejected: rC.success === false,
    c_result: rC.result,
    linked_milestones: linkedRows.length,
    orphan_milestones: orphanCount,
    bug_closed:
      rA.success &&
      rB.success &&
      rC.success === false &&
      linkedRows.length >= 2 &&
      orphanCount === 0,
  }

  return NextResponse.json({ ok: true, goalId, verdict, linked_milestones: linkedRows })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
