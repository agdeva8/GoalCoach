/**
 * POST /api/milestones — direct CRUD: create a milestone.
 *
 * Source of truth: backend/server.py:367-380 (`apply_proposal` →
 * `add_milestone`).
 *
 * Body (zod-validated; 400 on failure):
 *   {
 *     title:       string           // required
 *     goal_id?:    string|null      // optional FK
 *     target_date?: YYYY-MM-DD|null // optional
 *     status?:     string           // default 'open'
 *   }
 *
 * Auth: Auth.js session OR legacy guest_token cookie.
 *
 * Response: 201 { id, user_id, goal_id, goal_title, title, target_date, status, created_at }
 *
 * Side effects: writes to `milestones` + `audit_log` (type
 * `create:milestone`) atomically. If `goal_id` is supplied, the goal
 * must be owned by the same user (404 otherwise).
 */

import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  authenticateRoute,
  badRequestResponse,
  notFoundResponse,
} from '@/lib/auth-route'
import { AUDIT_TYPES, newId, writeAudit } from '@/lib/audit'
import { db } from '@/lib/db'
import { goals, milestones } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CreateMilestoneBody = z.object({
  title: z.string().trim().min(1, 'title is required'),
  goal_id: z.string().nullable().optional(),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  status: z.string().optional().default('open'),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequestResponse('Invalid JSON body')
  }

  const parsed = CreateMilestoneBody.safeParse(body)
  if (!parsed.success) {
    return badRequestResponse(parsed.error.issues[0]?.message ?? 'Invalid body')
  }

  const input = parsed.data
  const goalId = input.goal_id ?? null

  let goalTitle = ''
  if (goalId) {
    const goalRow = await db
      .select({ title: goals.title })
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.userId, auth.userId!)))
      .limit(1)
    if (!goalRow.length) return notFoundResponse('Goal not found')
    goalTitle = goalRow[0].title
  }

  const targetDate = input.target_date ?? null
  const milestoneId = newId('mile')

  await db.transaction(async (tx: any) => {
    await tx.insert(milestones).values({
      id: milestoneId,
      userId: auth.userId!,
      goalId,
      goalTitle,
      title: input.title,
      targetDate,
      status: input.status,
    })
    await writeAudit(tx, {
      userId: auth.userId!,
      type: AUDIT_TYPES.CREATE_MILESTONE,
      summary: `Milestone '${input.title}' -> ${targetDate ?? ''}`.trim(),
      payload: {
        milestone_id: milestoneId,
        title: input.title,
        goal_id: goalId,
        target_date: targetDate,
      },
    })
  })

  const row = await db
    .select()
    .from(milestones)
    .where(eq(milestones.id, milestoneId))
    .limit(1)

  return NextResponse.json(
    row[0] ? serialize(row[0]) : { id: milestoneId },
    { status: 201 },
  )
}

function serialize(row: any) {
  return {
    id: row.id,
    user_id: row.userId,
    goal_id: row.goalId,
    goal_title: row.goalTitle,
    title: row.title,
    target_date: row.targetDate,
    status: row.status,
    created_at:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  }
}
