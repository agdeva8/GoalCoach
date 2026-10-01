/**
 * DELETE /api/auth/personas/:userId — delete a single persona.
 *
 * Gated on `ALLOW_DEV_LOGIN=true`. Used by the Header's persona
 * menu to clean up throwaway guest accounts that have accumulated
 * over the course of testing.
 *
 * Cascade: deleting a user cascades to their goals / milestones /
 * commitments / blockers / sources / memories / audit events (the
 * `users.id` FK in each table uses `onDelete: 'cascade'`). The
 * session_token row in `sessions` (if any) is also cascaded.
 *
 * Refuses to delete the user matching the current session cookie so
 * you can't accidentally delete the persona you're signed in as.
 * Refuses to delete the six curated personas (`persona_key IS NOT
 * NULL`) — those are first-class dev identities, not guests.
 */
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { users } from '@/db/schema'
import { resolveRequestUser } from '@/lib/request-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ userId: string }> },
) {
  if (process.env.ALLOW_DEV_LOGIN !== 'true') {
    return NextResponse.json({ detail: 'Not found' }, { status: 404 })
  }

  const { userId: targetUserId } = await props.params
  const caller = await resolveRequestUser(req).catch(() => null)

  if (caller?.userId === targetUserId) {
    return NextResponse.json(
      { detail: "Can't delete the persona you're signed in as." },
      { status: 400 },
    )
  }

  const target = await db
    .select({
      userId: users.id,
      personaKey: users.personaKey,
      isGuest: users.isGuest,
    })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1)

  if (target.length === 0) {
    return NextResponse.json({ detail: 'Not found' }, { status: 404 })
  }

  // Don't delete curated (non-guest) personas — those are dev identities.
  if (target[0].personaKey !== null && target[0].isGuest !== true) {
    return NextResponse.json(
      { detail: "Can't delete curated dev personas." },
      { status: 400 },
    )
  }

  await db.delete(users).where(eq(users.id, targetUserId))

  return NextResponse.json({ ok: true, deleted: targetUserId })
}
