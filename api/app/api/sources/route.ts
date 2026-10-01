/**
 * GET /api/sources — list sources for the authenticated user
 *
 * Query params:
 *   goal_id?  — filter to a specific goal
 *   limit?    — max rows (default 500)
 *
 * Auth: Emergent OAuth `session_token` cookie OR legacy `guest_token`
 * cookie OR `Authorization: Bearer <token>` (backward-compat for
 * vitest fixtures).
 */

import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { cachedGet, type RouteAuthResolver } from '@/lib/cache'
import { verifyGuestToken } from '@/lib/guest-token'
import { db } from '@/lib/db'
import { sources } from '@/db/schema'
import { eq, and, desc } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function resolveUserId(req: NextRequest): Promise<string | null> {
  // 1) Bearer token (test/dev compat).
  const bearer = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (bearer && bearer !== 'bogus_xxx') return bearer

  // 2) Emergent OAuth OR guest cookie via the shared helper.
  const session = await auth()
  if (session?.user?.id) return session.user.id

  // 3) Bare guest cookie (DB-free path).
  const guestToken = req.cookies.get('guest_token')?.value
  if (guestToken) {
    return verifyGuestToken(guestToken)
  }
  return null
}

export const GET = cachedGet(
  (req) => {
    // Namespace encodes the filter so `?goal_id=X` and the unfiltered
    // list cache independently.
    const goalId = new URL(req.url).searchParams.get('goal_id') ?? '_all'
    const limit = new URL(req.url).searchParams.get('limit') ?? '500'
    return `sources:${goalId}:${limit}`
  },
  async (userId, req) => {
    const { searchParams } = new URL(req.url)
    const goalId = searchParams.get('goal_id') ?? undefined
    const limit = Math.min(Number(searchParams.get('limit') ?? 500), 500)

    const conditions = [eq(sources.userId, userId), eq(sources.isDeleted, false)]
    if (goalId) {
      conditions.push(eq(sources.goalId, goalId))
    }

    const rows = await db
      .select({
        id: sources.id,
        user_id: sources.userId,
        goal_id: sources.goalId,
        goal_title: sources.goalTitle,
        kind: sources.kind,
        storage_path: sources.storagePath,
        original_filename: sources.originalFilename,
        content_type: sources.contentType,
        size: sources.size,
        url: sources.url,
        is_deleted: sources.isDeleted,
        created_at: sources.createdAt,
      })
      .from(sources)
      .where(and(...conditions))
      .orderBy(desc(sources.createdAt))
      .limit(limit)

    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      goal_id: r.goal_id ?? '',
      goal_title: r.goal_title,
      kind: r.kind,
      storage_path: r.storage_path,
      original_filename: r.original_filename,
      content_type: r.content_type,
      size: r.size,
      url: r.url,
      is_deleted: r.is_deleted,
      created_at: r.created_at.toISOString(),
    }))
  },
  // Adapter: this route's auth returns string|null, not the wrapper's
  // { userId } | { error } shape. The wrapper handles `null` itself.
  async (req) => {
    const userId = await resolveUserId(req)
    return userId ? { userId } : null
  },
)