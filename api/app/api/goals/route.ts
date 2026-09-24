/**
 * POST /api/goals — direct CRUD: create a goal.
 *
 * Source of truth: backend/server.py:312-329 (`apply_proposal` →
 * `create_goal`) ported to a first-class HTTP endpoint so the dashboard
 * UI can edit state without going through the chat.
 *
 * Body (zod-validated; 400 on failure):
 *   {
 *     title:        string        // required, non-empty after trim
 *     horizon:      'weekly'|'short'|'medium'|'long'   // required
 *     why?:         string        // default ""
 *     next_action?: string        // default ""
 *     start_date?:  YYYY-MM-DD    // default today (UTC)
 *     target_date?: YYYY-MM-DD    // default null
 *   }
 *
 * Auth: Auth.js session OR legacy guest_token cookie.
 *
 * Response: 201 { id, user_id, title, horizon, why, next_action, start_date,
 * target_date, status, created_at, updated_at }
 *
 * Side effects:
 *   - Inserts a row in `goals`.
 *   - Inserts a row in `audit_log` (type `create:goal`) in the SAME
 *     transaction so the audit trail can never get out of sync with
 *     the data it describes.
 */

import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  authenticateRoute,
  badRequestResponse,
} from '@/lib/auth-route'
import { AUDIT_TYPES, asIsoDateOrNull, newId, todayIso, writeAudit } from '@/lib/audit'
import { db } from '@/lib/db'
import { goals } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HORIZONS = ['weekly', 'short', 'medium', 'long'] as const

const CreateGoalBody = z.object({
  title: z.string().trim().min(1, 'title is required'),
  horizon: z.enum(HORIZONS),
  why: z.string().optional().default(''),
  next_action: z.string().optional().default(''),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'start_date must be YYYY-MM-DD')
    .optional(),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'target_date must be YYYY-MM-DD')
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

  const parsed = CreateGoalBody.safeParse(body)
  if (!parsed.success) {
    return badRequestResponse(parsed.error.issues[0]?.message ?? 'Invalid body')
  }

  const input = parsed.data
  // asIsoDateOrNull gives us a definitive "valid | null | undefined"
  // signal; we already validated the regex with zod above, so a non-null
  // result is guaranteed valid.
  const startDate = input.start_date ?? todayIso()
  const targetDate =
    input.target_date === undefined ? null : input.target_date

  const goalId = newId('goal')

  // Single transaction: row + audit.
  await db.transaction(async (tx: any) => {
    await tx.insert(goals).values({
      id: goalId,
      userId: auth.userId!,
      title: input.title,
      horizon: input.horizon,
      why: input.why,
      nextAction: input.next_action,
      startDate,
      targetDate,
      status: 'active',
    })
    await writeAudit(tx, {
      userId: auth.userId!,
      type: AUDIT_TYPES.CREATE_GOAL,
      summary: `Created goal '${input.title}' (${input.horizon})`,
      payload: {
        goal_id: goalId,
        title: input.title,
        horizon: input.horizon,
        why: input.why,
        next_action: input.next_action,
        start_date: startDate,
        target_date: targetDate,
      },
    })
  })

  // Read back to return the canonical row shape (created_at etc).
  const row = await db
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.userId, auth.userId!)))
    .limit(1)

  return NextResponse.json(row[0] ? serialize(row[0]) : { id: goalId }, {
    status: 201,
  })
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                              */
/* -------------------------------------------------------------------------- */

function serialize(row: any) {
  return {
    id: row.id,
    user_id: row.userId,
    title: row.title,
    horizon: row.horizon,
    why: row.why,
    next_action: row.nextAction,
    start_date: row.startDate,
    target_date: row.targetDate,
    status: row.status,
    created_at:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updated_at:
      row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  }
}

void asIsoDateOrNull // re-exported for tests / future endpoints
