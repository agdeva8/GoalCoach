/**
 * /api/milestones/[id] — update (PATCH) or delete (DELETE) a milestone.
 *
 * Source of truth: backend/server.py:367-380 (mirroring the goal-edit
 * surface — milestones are an inline detail of a goal).
 *
 * PATCH body — any subset of:
 *   { title?, target_date?, status?, goal_id? }
 *
 * Auth: Auth.js session OR guest_token cookie.
 * Ownership: 404 if the row doesn't exist or isn't owned by the user.
 *
 * Responses:
 *   200 { milestone } on PATCH success
 *   200 { ok: true } on DELETE success
 *   400 invalid body
 *   401 unauthenticated
 *   404 not found / not owned
 */

import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  authenticateRoute,
  badRequestResponse,
  notFoundResponse,
} from '@/lib/auth-route'
import { AUDIT_TYPES, writeAudit } from '@/lib/audit'
import { db } from '@/lib/db'
import { goals, milestones } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PatchMilestoneBody = z
  .object({
    title: z.string().trim().min(1).optional(),
    target_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    status: z.string().optional(),
    goal_id: z.string().nullable().optional(),
  })
  .strict()

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  const { id } = await ctx.params
  if (!id) return badRequestResponse('Missing milestone id')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequestResponse('Invalid JSON body')
  }

  const parsed = PatchMilestoneBody.safeParse(body)
  if (!parsed.success) {
    return badRequestResponse(parsed.error.issues[0]?.message ?? 'Invalid body')
  }
  const input = parsed.data
  if (Object.keys(input).length === 0) {
    return badRequestResponse('No fields to update')
  }

  const existing = await db
    .select({ id: milestones.id, title: milestones.title })
    .from(milestones)
    .where(
      and(eq(milestones.id, id), eq(milestones.userId, auth.userId!)),
    )
    .limit(1)
  if (!existing.length) return notFoundResponse('Milestone not found')

  let goalTitleUpdate: string | undefined
  if (input.goal_id !== undefined) {
    if (input.goal_id === null) {
      goalTitleUpdate = ''
    } else {
      const goalRow = await db
        .select({ title: goals.title })
        .from(goals)
        .where(
          and(eq(goals.id, input.goal_id), eq(goals.userId, auth.userId!)),
        )
        .limit(1)
      if (!goalRow.length) return notFoundResponse('Goal not found')
      goalTitleUpdate = goalRow[0].title
    }
  }

  const updates: Record<string, any> = {}
  if (input.title !== undefined) updates.title = input.title
  if (input.target_date !== undefined) updates.targetDate = input.target_date
  if (input.status !== undefined) updates.status = input.status
  if (input.goal_id !== undefined) {
    updates.goalId = input.goal_id
    updates.goalTitle = goalTitleUpdate ?? ''
  }

  await db.transaction(async (tx: any) => {
    await tx.update(milestones).set(updates).where(eq(milestones.id, id))
    await writeAudit(tx, {
      userId: auth.userId!,
      type: AUDIT_TYPES.UPDATE_MILESTONE,
      summary: `Updated milestone '${existing[0].title}'`,
      payload: { milestone_id: id, fields: input },
    })
  })

  const row = await db
    .select()
    .from(milestones)
    .where(eq(milestones.id, id))
    .limit(1)

  return NextResponse.json({
    milestone: row[0] ? serialize(row[0]) : null,
  })
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  const { id } = await ctx.params
  if (!id) return badRequestResponse('Missing milestone id')

  const existing = await db
    .select({ id: milestones.id, title: milestones.title })
    .from(milestones)
    .where(
      and(eq(milestones.id, id), eq(milestones.userId, auth.userId!)),
    )
    .limit(1)
  if (!existing.length) return notFoundResponse('Milestone not found')

  await db.transaction(async (tx: any) => {
    await tx.delete(milestones).where(eq(milestones.id, id))
    await writeAudit(tx, {
      userId: auth.userId!,
      type: AUDIT_TYPES.DELETE_MILESTONE,
      summary: `Deleted milestone '${existing[0].title}'`,
      payload: { milestone_id: id },
    })
  })

  return NextResponse.json({ ok: true })
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
