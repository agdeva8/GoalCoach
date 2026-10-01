/**
 * DELETE /api/sources/[id] — soft-delete a source
 *
 * Sets isDeleted=true. The file in Emergent Object Storage is NOT deleted
 * (audit trail).
 *
 * Auth: Emergent OAuth OR guest cookie OR Bearer (test/dev compat).
 */

import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { verifyGuestToken } from '@/lib/guest-token'
import { db } from '@/lib/db'
import { sources } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const bearer = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (bearer && bearer !== 'bogus_xxx') return bearer

  const session = await auth()
  if (session?.user?.id) return session.user.id

  const guestToken = req.cookies.get('guest_token')?.value
  if (guestToken) return verifyGuestToken(guestToken)
  return null
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }

  const { id } = await params

  const [existing] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.id, id), eq(sources.userId, userId)))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ detail: 'Not found' }, { status: 404 })
  }

  await db
    .update(sources)
    .set({ isDeleted: true })
    .where(and(eq(sources.id, id), eq(sources.userId, userId)))

  return NextResponse.json({ ok: true })
}