/**
 * /api/commitments/[id] — update (PATCH) or delete (DELETE) a commitment.
 *
 * Source of truth: backend/server.py:410-422 (`complete_commitment` /
 * `update_commitment`).
 *
 * PATCH body — any subset of:
 *   { text?, due?, status?, goal_id? }
 *
 * `status` must be 'open' | 'done'. Setting status='done' is the
 * canonical "I completed this" path; the audit log records
 * `complete:commitment` in that case so the Honesty audit panel can
 * surface it.
 *
 * Auth: Auth.js session OR guest_token cookie.
 * Ownership: the row must exist AND belong to the user (404 if not —
 * we don't leak existence of others' rows).
 *
 * Responses:
 *   200 { commitment } on PATCH success
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
import { commitments, goals } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['open', 'done'] as const

const PatchCommitmentBody = z
  .object({
    text: z.string().trim().min(1).optional(),
    due: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    status: z.enum(STATUSES).optional(),
    goal_id: z.string().nullable().optional(),
  })
  .strict()

/* -------------------------------------------------------------------------- */
/* PATCH                                                                      */
/* -------------------------------------------------------------------------- */

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  const { id } = await ctx.params
  if (!id) return badRequestResponse('Missing commitment id')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequestResponse('Invalid JSON body')
  }

  const parsed = PatchCommitmentBody.safeParse(body)
  if (!parsed.success) {
    return badRequestResponse(parsed.error.issues[0]?.message ?? 'Invalid body')
  }
  const input = parsed.data
  if (Object.keys(input).length === 0) {
    return badRequestResponse('No fields to update')
  }

  const existing = await db
    .select({ id: commitments.id, text: commitments.text })
    .from(commitments)
    .where(
      and(eq(commitments.id, id), eq(commitments.userId, auth.userId!)),
    )
    .limit(1)
  if (!existing.length) return notFoundResponse('Commitment not found')

  // If goal_id is changing, validate the new goal is owned and stamp
  // its title.
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
  if (input.text !== undefined) updates.text = input.text
  if (input.due !== undefined) updates.due = input.due
  if (input.status !== undefined) updates.status = input.status
  if (input.goal_id !== undefined) {
    updates.goalId = input.goal_id
    updates.goalTitle = goalTitleUpdate ?? ''
  }

  const completing = input.status === 'done'
  const type = completing
    ? AUDIT_TYPES.COMPLETE_COMMITMENT
    : AUDIT_TYPES.UPDATE_COMMITMENT
  const summary = completing
    ? `Commitment '${existing[0].text}' -> done`
    : `Updated commitment '${existing[0].text}'`

  await db.transaction(async (tx: any) => {
    await tx.update(commitments).set(updates).where(eq(commitments.id, id))
    await writeAudit(tx, {
      userId: auth.userId!,
      type,
      summary,
      payload: { commitment_id: id, fields: input },
    })
  })

  const row = await db
    .select()
    .from(commitments)
    .where(eq(commitments.id, id))
    .limit(1)

  return NextResponse.json({ commitment: row[0] ? serialize(row[0]) : null })
}

/* -------------------------------------------------------------------------- */
/* DELETE                                                                     */
/* -------------------------------------------------------------------------- */

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  const { id } = await ctx.params
  if (!id) return badRequestResponse('Missing commitment id')

  const existing = await db
    .select({ id: commitments.id, text: commitments.text })
    .from(commitments)
    .where(
      and(eq(commitments.id, id), eq(commitments.userId, auth.userId!)),
    )
    .limit(1)
  if (!existing.length) return notFoundResponse('Commitment not found')

  await db.transaction(async (tx: any) => {
    await tx.delete(commitments).where(eq(commitments.id, id))
    await writeAudit(tx, {
      userId: auth.userId!,
      type: AUDIT_TYPES.DELETE_COMMITMENT,
      summary: `Deleted commitment '${existing[0].text}'`,
      payload: { commitment_id: id },
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
    text: row.text,
    due: row.due,
    status: row.status,
    created_at:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  }
}
