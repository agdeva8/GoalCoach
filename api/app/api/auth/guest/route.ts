/**
 * Legacy `guest_token` endpoint.
 *
 * Source of truth: migration/discovery/03-nextjs-architecture.md
 * Locked Decision #3 — 10-minute cookie expiry (anti-abuse window).
 *
 * POST creates an anonymous `users` row with `isGuest=true`,
 * `email=null`, `name='Guest'`, then sets an HttpOnly `guest_token`
 * cookie signed with AUTH_SECRET (HMAC-SHA256, see lib/guest-token.ts).
 * The cookie expires after exactly 10 minutes; the browser refuses to
 * send it after that.
 *
 * On the next Google sign-in the existing migration flow (Task 15)
 * reassigns the guest's child rows (`goals`, `commitments`, …) to the
 * real user_id, then deletes the guest row. This endpoint only creates
 * the row; reassignment is a separate concern.
 */

import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { users } from '@/db/schema'
import {
  GUEST_TOKEN_COOKIE,
  GUEST_TOKEN_TTL_SECONDS,
  generateGuestUserId,
  signGuestToken,
} from '@/lib/guest-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const userId = generateGuestUserId()

  await db.insert(users).values({
    id: userId,
    email: null,
    name: 'Guest',
    image: null,
    emailVerified: null,
    isGuest: true,
    // modelProvider falls back to schema default 'gemini'.
  })

  const { token, expiresAt } = signGuestToken(userId)

  // Shape matches FastAPI: { user: { user_id, email, name, picture, is_guest, model_provider, ... } }
  // Keep 10-min TTL (locked architecture decision #3).
  const response = NextResponse.json({
    user: {
      user_id: userId,
      email: null,
      name: 'Guest',
      picture: null,
      is_guest: true,
      model_provider: 'gemini',
    },
  })

  // Secure in production, lax in dev so http://localhost:3000 still works.
  const isProd = process.env.NODE_ENV === 'production'

  response.cookies.set({
    name: GUEST_TOKEN_COOKIE,
    value: token,
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: GUEST_TOKEN_TTL_SECONDS,
    path: '/',
  })

  return response
}
