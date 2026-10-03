/**
 * /api/daily_log — the coach's memory of the day (Iteration 10, effect 5.3).
 *
 *   GET  ?date=YYYY-MM-DD   → { log: DailyLogRow | null }
 *   GET  (no date)          → { logs: DailyLogRow[] }  (last 7 days, desc)
 *   PUT  { date, text?, commitments?, blockers? } → { log: DailyLogRow }
 *
 * Direct CRUD (no propose→confirm) — this is scheduling/constraint data, same
 * bucket as blockers/timetable blocks (hard constraint #2). Cache invalidation
 * is handled by the auth choke-point; we do not cache these reads.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { authenticateRoute, badRequestResponse } from '@/lib/auth-route'
import { AUDIT_TYPES, writeAudit } from '@/lib/audit'
import {
  getDailyLog,
  getDailyLogsSince,
  upsertDailyLog,
} from '@/lib/daily-log'
import { db } from '@/lib/db'
import { recomputeGoalDrift } from '@/lib/drift-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const PutDailyLogBody = z.object({
  date: isoDate,
  text: z.string().max(5000).optional(),
  commitments: z
    .array(
      z.object({
        commitment_id: z.string().min(1),
        completed: z.boolean(),
        note: z.string().max(2000).default(''),
      }),
    )
    .optional(),
  blockers: z
    .array(
      z.object({
        blocker_id: z.string().min(1),
        skipped: z.boolean(),
        note: z.string().max(2000).default(''),
      }),
    )
    .optional(),
})

function last7DaysFrom(today: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 6)
  return d.toISOString().slice(0, 10)
}

/* -------------------------------------------------------------------------- */
/* GET                                                                        */
/* -------------------------------------------------------------------------- */

export async function GET(req: NextRequest) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  const date = req.nextUrl.searchParams.get('date')
  if (date) {
    if (!isoDate.safeParse(date).success) {
      return badRequestResponse('Invalid date (expected YYYY-MM-DD)')
    }
    const log = await getDailyLog(auth.userId!, date)
    return NextResponse.json({ log })
  }

  const today = new Date().toISOString().slice(0, 10)
  const logs = await getDailyLogsSince(auth.userId!, last7DaysFrom(today))
  return NextResponse.json({ logs })
}

/* -------------------------------------------------------------------------- */
/* PUT                                                                        */
/* -------------------------------------------------------------------------- */

export async function PUT(req: NextRequest) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequestResponse('Invalid JSON body')
  }

  const parsed = PutDailyLogBody.safeParse(body)
  if (!parsed.success) {
    return badRequestResponse(parsed.error.issues[0]?.message ?? 'Invalid body')
  }
  const { date, text, commitments, blockers } = parsed.data

  const log = await upsertDailyLog(auth.userId!, date, {
    text,
    commitments,
    blockers,
  })

  await db.transaction(async (tx: any) => {
    await writeAudit(tx, {
      userId: auth.userId!,
      type: AUDIT_TYPES.UPSERT_DAILY_LOG,
      summary: `Daily log for ${date}`,
      payload: {
        date,
        text_len: (text ?? '').length,
        commitments: commitments?.length ?? 0,
        blockers: blockers?.length ?? 0,
      },
    })
  })

  // Effect 5.5 — a log change can move drift. Best-effort.
  await recomputeGoalDrift(auth.userId!).catch(() => {})

  return NextResponse.json({ log })
}
