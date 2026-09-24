/**
 * POST /api/auth/session — exchange an Emergent OAuth `session_id`
 * for a server-side `session_token` cookie.
 *
 * Source of truth: backend/server.py:84-150 (`/api/auth/session`).
 *
 * Wire protocol:
 *   POST  /api/auth/session
 *         Body: { session_id: string }
 *         200   { user: { id, email, name, picture, model_provider, is_guest } }
 *         401   { detail: 'Invalid session_id' }
 *         502   { detail: 'Auth service error: ...' }
 *
 * The response sets a `session_token` HttpOnly cookie (7-day lifetime)
 * that mirrors the Python `response.set_cookie(...)` call.
 *
 * Server-only: this route imports `lib/emergent/auth.ts` which reads
 * `EMERGENT_LLM_KEY` from `process.env`. The `runtime = 'nodejs'` flag
 * keeps the route on the Node.js runtime so the cookie jar works.
 */

import { NextRequest, NextResponse } from 'next/server'

import { upsertUserFromSession } from '@/lib/auth'
import { exchangeSessionId, setSessionCookie } from '@/lib/emergent/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SessionBody {
  session_id?: unknown
}

export async function POST(req: NextRequest) {
  let body: SessionBody
  try {
    body = (await req.json()) as SessionBody
  } catch {
    return NextResponse.json(
      { detail: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : ''
  if (!sessionId) {
    return NextResponse.json(
      { detail: 'Missing session_id' },
      { status: 400 },
    )
  }

  // 1) Exchange the session_id for the Emergent profile + session_token.
  let emergentUser
  try {
    emergentUser = await exchangeSessionId(sessionId)
  } catch (e) {
    const status = (e as { status?: number }).status ?? 502
    const detail = (e as Error).message ?? 'Auth service error'
    return NextResponse.json({ detail }, { status })
  }

  // 2) Upsert the local `users` row + the `user_sessions` link.
  let user
  try {
    user = await upsertUserFromSession({
      email: emergentUser.email,
      name: emergentUser.name,
      picture: emergentUser.picture,
      sessionToken: emergentUser.session_token,
    })
  } catch (e) {
    return NextResponse.json(
      { detail: `Auth persistence failed: ${(e as Error).message ?? String(e)}` },
      { status: 500 },
    )
  }

  // 3) Set the session_token cookie.
  await setSessionCookie(emergentUser.session_token)

  return NextResponse.json({
    user: {
      user_id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      model_provider: user.modelProvider,
      is_guest: user.isGuest,
    },
  })
}