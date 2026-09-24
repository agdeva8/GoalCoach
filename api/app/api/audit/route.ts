/**
 * GET /api/audit — paginated audit log for the current user.
 *
 * Query params:
 *   type     — optional; filter by event type prefix (e.g. "confirm:create_goal")
 *   limit    — optional; rows per page, default 50, max 200
 *   before   — optional cursor; an audit ID or ISO timestamp; returns rows
 *              older than that id/ts
 *
 * Auth: Emergent OAuth session OR valid guest_token cookie.
 * Always scoped to the authenticated user — never returns another user's events.
 */

import { and, eq, lt, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog } from '@/db/schema'
import { GUEST_TOKEN_COOKIE, verifyGuestToken } from '@/lib/guest-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

async function getUserId(req: NextRequest): Promise<string | null> {
  // 1) Emergent OAuth OR guest cookie (shared helper).
  const session = await auth()
  if (session?.user?.id) return session.user.id

  // 2) Bare guest cookie (DB-free path).
  const token = req.cookies.get(GUEST_TOKEN_COOKIE)?.value
  return verifyGuestToken(token)
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10)
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit), MAX_LIMIT)
  const typeFilter = searchParams.get('type')
  const before = searchParams.get('before')

  // Build where conditions.
  const conditions = [eq(auditLog.userId, userId)]

  if (typeFilter) {
    conditions.push(sql`${auditLog.type} LIKE ${typeFilter || ''}%`)
  }

  // Cursor: if `before` looks like a timestamp use it directly, otherwise use
  // the id as a tiebreaker (both are safe because the index is compound).
  if (before) {
    const isTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(before)
    if (isTimestamp) {
      conditions.push(lt(auditLog.createdAt, new Date(before)))
    } else {
      // Treat as id cursor — rows with id < before (for forward pagination).
      conditions.push(sql`${auditLog.id} < ${before}`)
    }
  }

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(sql`${auditLog.createdAt} DESC, ${auditLog.id} DESC`)
    .limit(limit)

  // Drizzle returns snake_case from the schema; map to the legacy snake_case
  // field names the frontend expects (matching the FastAPI response shape).
  const events = rows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    type: r.type,
    summary: r.summary,
    payload: r.payload,
    created_at: r.createdAt.toISOString(),
  }))

  return NextResponse.json(events)
}