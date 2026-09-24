/**
 * /api/blockers — POST (create) and GET (list) the user's blockers.
 *
 * Source of truth: backend/server.py:842-859 (`create_blocker`) +
 * `backend/server.py:213` (`db.blockers.find(...)` in `load_state`).
 *
 * POST body (zod-validated; 400 on failure):
 *   {
 *     title:      string         // required
 *     start_date: YYYY-MM-DD     // required
 *     end_date?:  YYYY-MM-DD     // defaults to start_date
 *     note?:      string         // default ''
 *   }
 *
 * GET response:
 *   { blockers: [...] }
 *
 * Auth: Auth.js session OR legacy guest_token cookie.
 *
 * Side effects (POST): writes to `blockers` + `audit_log` (type
 * `create:blocker`) atomically.
 */

import { and, asc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  authenticateRoute,
  badRequestResponse,
} from '@/lib/auth-route'
import { AUDIT_TYPES, newId, todayIso, writeAudit } from '@/lib/audit'
import { db } from '@/lib/db'
import { blockers } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CreateBlockerBody = z.object({
  title: z.string().trim().min(1, 'title is required'),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'start_date must be YYYY-MM-DD'),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  note: z.string().optional().default(''),
})

/* -------------------------------------------------------------------------- */
/* POST                                                                       */
/* -------------------------------------------------------------------------- */

export async function POST(req: NextRequest) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequestResponse('Invalid JSON body')
  }

  const parsed = CreateBlockerBody.safeParse(body)
  if (!parsed.success) {
    return badRequestResponse(parsed.error.issues[0]?.message ?? 'Invalid body')
  }

  const input = parsed.data
  const startDate = input.start_date
  const endDate = input.end_date ?? startDate
  const note = input.note ?? ''

  const blockerId = newId('block')

  await db.transaction(async (tx: any) => {
    await tx.insert(blockers).values({
      id: blockerId,
      userId: auth.userId!,
      title: input.title,
      startDate,
      endDate,
      note,
    })
    await writeAudit(tx, {
      userId: auth.userId!,
      type: AUDIT_TYPES.CREATE_BLOCKER,
      summary: `Blocker '${input.title}' ${startDate}..${endDate}`,
      payload: {
        blocker_id: blockerId,
        title: input.title,
        start_date: startDate,
        end_date: endDate,
        note,
      },
    })
  })

  const row = await db
    .select()
    .from(blockers)
    .where(eq(blockers.id, blockerId))
    .limit(1)

  return NextResponse.json(
    row[0] ? serialize(row[0]) : { id: blockerId },
    { status: 201 },
  )
}

/* -------------------------------------------------------------------------- */
/* GET                                                                        */
/* -------------------------------------------------------------------------- */

export async function GET(req: NextRequest) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  const rows = await db
    .select()
    .from(blockers)
    .where(eq(blockers.userId, auth.userId!))
    .orderBy(asc(blockers.startDate))
    .limit(500)

  return NextResponse.json({
    blockers: rows.map(serialize),
  })
}

function serialize(row: any) {
  return {
    id: row.id,
    user_id: row.userId,
    title: row.title,
    start_date: row.startDate,
    end_date: row.endDate,
    note: row.note,
    created_at:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  }
}

// Suppress unused-import lint in test scripts that may import only POST.
void todayIso
void and
