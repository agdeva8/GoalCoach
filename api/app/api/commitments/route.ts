/**
 * POST /api/commitments — direct CRUD: create a commitment.
 *
 * Source of truth: backend/server.py:395-408 (`apply_proposal` →
 * `add_commitment`).
 *
 * Body (zod-validated; 400 on failure):
 *   {
 *     text:       string            // required, non-empty
 *     goal_id?:   string|null       // optional FK; null = unlinked
 *     due?:       YYYY-MM-DD|null   // optional
 *   }
 *
 * Auth: Auth.js session OR legacy guest_token cookie.
 *
 * Response: 201 { id, user_id, goal_id, goal_title, text, due, status, created_at }
 *
 * Side effects: writes to `commitments` + `audit_log` (type
 * `create:commitment`) in one transaction. If `goal_id` is supplied,
 * the goal must be owned by the same user (404 otherwise) and we
 * denormalize `goal_title` onto the commitment row for query speed
 * (mirrors the legacy backend).
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
import { commitments, goals } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CreateCommitmentBody = z.object({
  text: z.string().trim().min(1, 'text is required'),
  goal_id: z.string().nullable().optional(),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'due must be YYYY-MM-DD')
    .nullable()
    .optional(),
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

  const parsed = CreateCommitmentBody.safeParse(body)
  if (!parsed.success) {
    return badRequestResponse(parsed.error.issues[0]?.message ?? 'Invalid body')
  }

  const input = parsed.data
  const goalId = input.goal_id ?? null

  // Resolve goal_title for denormalization — also enforces ownership.
  let goalTitle = ''
  if (goalId) {
    const goalRow = await db
      .select({ title: goals.title })
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.userId, auth.userId!)))
      .limit(1)
    if (!goalRow.length) {
      return notFoundResponse('Goal not found')
    }
    goalTitle = goalRow[0].title
  }

  const due = input.due ?? null
  const commitmentId = newId('commit')

  await db.transaction(async (tx: any) => {
    await tx.insert(commitments).values({
      id: commitmentId,
      userId: auth.userId!,
      goalId,
      goalTitle,
      text: input.text,
      due,
      status: 'open',
    })
    await writeAudit(tx, {
      userId: auth.userId!,
      type: AUDIT_TYPES.CREATE_COMMITMENT,
      summary: `Committed: ${input.text}`,
      payload: {
        commitment_id: commitmentId,
        text: input.text,
        goal_id: goalId,
        due,
      },
    })
  })

  const row = await db
    .select()
    .from(commitments)
    .where(eq(commitments.id, commitmentId))
    .limit(1)

  return NextResponse.json(
    row[0] ? serialize(row[0]) : { id: commitmentId },
    { status: 201 },
  )
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
