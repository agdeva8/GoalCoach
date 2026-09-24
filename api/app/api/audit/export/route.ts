/**
 * GET /api/audit/export — JSON file dump of all user messages + audit events.
 *
 * Sets Content-Disposition: attachment so the browser downloads a .json file.
 *
 * Used by the Honesty Audit UI ("what has the coach done on my behalf?").
 *
 * Auth: Emergent OAuth session OR valid guest_token cookie.
 * Never includes secrets (session_token values, etc.) — only user-visible data.
 */

import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, commitments, goals, messages, users } from '@/db/schema'
import { GUEST_TOKEN_COOKIE, verifyGuestToken } from '@/lib/guest-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getUserIdAndEmail(
  req: NextRequest
): Promise<{ userId: string; email: string | null; name: string | null } | null> {
  // 1) Emergent OAuth (shared helper).
  const session = await auth()
  if (session?.user?.id) {
    return {
      userId: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    }
  }

  // 2) Bare guest cookie.
  const token = req.cookies.get(GUEST_TOKEN_COOKIE)?.value
  const guestUserId = verifyGuestToken(token)
  if (guestUserId) {
    const row = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, guestUserId))
      .limit(1)
    const user = row[0]
    if (!user) return null
    return { userId: user.id, email: user.email, name: user.name }
  }

  return null
}

export async function GET(req: NextRequest) {
  const user = await getUserIdAndEmail(req)
  if (!user) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }

  const { userId, email, name } = user

  // Fetch all user data in parallel.
  const [auditRows, messageRows, goalRows, commitmentRows] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(eq(auditLog.userId, userId))
      .orderBy(auditLog.createdAt),
    db
      .select()
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(messages.createdAt),
    db
      .select()
      .from(goals)
      .where(eq(goals.userId, userId))
      .orderBy(goals.createdAt),
    db
      .select()
      .from(commitments)
      .where(eq(commitments.userId, userId))
      .orderBy(commitments.createdAt),
  ])

  // Map to the legacy FastAPI response shape (snake_case keys).
  const audit_log = auditRows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    type: r.type,
    summary: r.summary,
    payload: r.payload,
    created_at: r.createdAt.toISOString(),
  }))

  const conversation = messageRows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    role: r.role,
    content: r.content,
    provider: r.provider,
    created_at: r.createdAt.toISOString(),
  }))

  const exportedAt = new Date().toISOString()
  const filename = `goalcoach-export-${userId}-${exportedAt.slice(0, 10)}.json`

  const payload = {
    exported_at: exportedAt,
    user: { email, name },
    state: {
      goals: goalRows.map((g) => ({
        id: g.id,
        title: g.title,
        horizon: g.horizon,
        status: g.status,
        created_at: g.createdAt.toISOString(),
      })),
      commitments: commitmentRows.map((c) => ({
        id: c.id,
        text: c.text,
        due:
        c.due == null
          ? null
          : typeof c.due === 'string'
            ? c.due
            : (c.due as Date).toISOString().slice(0, 10),
        status: c.status,
        created_at: c.createdAt.toISOString(),
      })),
    },
    conversation,
    audit_log,
  }

  return NextResponse.json(payload, {
    headers: {
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}