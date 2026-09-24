/**
 * POST /api/auth/logout
 *
 * Clears the session_token cookie + user_sessions row (via signOut()).
 * Also clears the guest_token cookie in case the user had an active guest session.
 */

import { NextResponse } from 'next/server'

import { signOut } from '@/lib/auth'
import { GUEST_TOKEN_COOKIE } from '@/lib/guest-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await signOut()
  } catch {
    /* best-effort */
  }

  // Clear guest_token cookie too (signOut only handles session_token).
  const { cookies } = await import('next/headers')
  const jar = await cookies()
  jar.set(GUEST_TOKEN_COOKIE, '', { maxAge: 0, path: '/' })

  return NextResponse.json({ ok: true })
}
