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

import { auth } from '@/lib/auth'
import { GUEST_TOKEN_COOKIE, verifyGuestToken } from '@/lib/guest-token'
import { db } from '@/lib/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
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