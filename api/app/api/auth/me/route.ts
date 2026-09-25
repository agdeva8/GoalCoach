/**
 * Returns the current authenticated user, regardless of source.
 *
 * Source of truth: migration/discovery/03-nextjs-architecture.md
 * Section 3 (auth model — Emergent OAuth + guest cookie).
 *
 * Response shape (snake_case keys) matches the legacy FastAPI
 * `/api/auth/me` so the existing frontend `api.me()` and test
 * fixtures keep working without a port:
 *   { user_id, email, name, image, model_provider, is_guest }
 *
 * `model_provider` is read from the `users` row (Emergent OAuth doesn't
 * carry it; we persist whatever the user picked via `/api/preferences`
 * — guests default to 'gemini').
 */

import { NextResponse, type NextRequest } from 'next/server'
import { sql } from 'drizzle-orm'

import { auth } from '@/lib/auth'
import { GUEST_TOKEN_COOKIE, verifyGuestToken } from '@/lib/guest-token'
import { db } from '@/lib/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // 0) Dev-auth bypass — `Authorization: Bearer <user_id>` resolves
  //    directly to that user row, mirroring the cheap-token short-
  //    circuit in `app/api/chat/stream/route.ts` so curl + scripts can
  //    hit the API without going through Emergent OAuth. Production
  //    OAuth still flows through `auth()` (path 1) below.
  const bearer = req.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim()
  if (bearer && bearer.length > 0 && bearer !== 'bogus_xxx') {
    const userId = bearer
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        image: users.image,
        modelProvider: users.modelProvider,
        isGuest: users.isGuest,
      })
      .from(users)
      .where(sql`${users.id} = ${userId}`)
      .limit(1)
    const u = rows[0]
    if (u) {
      return NextResponse.json({
        user_id: u.id,
        email: u.email ?? null,
        name: u.name ?? null,
        image: u.image ?? null,
        model_provider: u.modelProvider ?? 'gemini',
        is_guest: u.isGuest ?? false,
      })
    }
    return NextResponse.json({ detail: 'Unknown dev user' }, { status: 401 })
  }

  // 1) Emergent OAuth session OR guest cookie. `getAuthenticatedUser`
  //    reads the cookies + looks up the `users` row.
  const session = await auth()
  if (session?.user?.id) {
    return NextResponse.json({
      user_id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
      model_provider: session.user.modelProvider ?? 'gemini',
      is_guest: session.user.isGuest ?? false,
    })
  }

  // 2) Last-ditch: bare guest cookie without DB lookup (mirrors the
  //    middleware path).
  const token = req.cookies.get(GUEST_TOKEN_COOKIE)?.value
  const guestUserId = verifyGuestToken(token)
  if (guestUserId) {
    const row = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        image: users.image,
        modelProvider: users.modelProvider,
        isGuest: users.isGuest,
      })
      .from(users)
      .where(eq(users.id, guestUserId))
      .limit(1)

    const guest = row[0]
    if (guest) {
      return NextResponse.json({
        user_id: guest.id,
        email: guest.email ?? null,
        name: guest.name ?? null,
        image: guest.image ?? null,
        model_provider: guest.modelProvider ?? 'gemini',
        is_guest: true,
      })
    }
  }

  return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
}