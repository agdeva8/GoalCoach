/**
 * POST /api/auth/dev-login — dev-only auth bypass.
 *
 * Mirrors `/api/auth/session` in shape: it produces a real
 * `session_token` cookie linked to a real `users` row linked to a real
 * `user_sessions` row, so the rest of the app (chat, goals, state,
 * audit, etc.) sees an Emergent-style authenticated user without
 * distinguishing the dev path from the OAuth path.
 *
 * Gated on the explicit `ALLOW_DEV_LOGIN=true` env var. Returns 404
 * (not 403 — we don't want to leak the existence of this endpoint) when
 * the flag is unset, so the route is invisible in production.
 *
 * Why this exists:
 *   The Emergent OAuth host lives in the MiniMax Code browser
 *   environment. When developing locally or in CI without that
 *   environment attached, the Google button sends the user through the
 *   real OAuth proxy and fails. The point of this route is to let us
 *   build + test the LLM goal-creation flow, milestone tracking,
 *   welcome-toast logic, etc. without standing up the OAuth host each
 *   time. It writes the same DB rows and the same cookie the OAuth
 *   path writes — only the email/name/avatar come from query params
 *   instead of the Emergent profile endpoint.
 *
 * Hard guard: when `ALLOW_DEV_LOGIN` is anything other than the string
 * "true", this route returns 404. The check is intentionally string-
 * strict (no `"1"`, no `"yes"`) so a misconfigured environment defaults
 * to safe behavior.
 *
 * Wire protocol:
 *   POST /api/auth/dev-login?user_id=<id>&name=<name>
 *     200 { user: { user_id, email, name, model_provider, is_guest } }
 *     404 { detail: 'Not found' }                — when env flag unset
 *     400 { detail: 'Missing user_id' }          — when param missing
 */
import { randomUUID } from 'node:crypto'

import { type NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import { users } from '@/db/schema'
import { SESSION_TOKEN_COOKIE } from '@/lib/emergent/auth'
import { setSessionCookie } from '@/lib/emergent/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

/** Sanitize a freeform query param into a stable identifier prefix. */
function safeId(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64)
}

function safeName(raw: string): string {
  return raw.trim().slice(0, 80) || 'Dev User'
}

export async function POST(req: NextRequest) {
  // Hard gate. 404 (not 403) so the route is invisible in production.
  if (process.env.ALLOW_DEV_LOGIN !== 'true') {
    return NextResponse.json({ detail: 'Not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const userId = safeId(url.searchParams.get('user_id') ?? 'user_founder01')
  const name = safeName(url.searchParams.get('name') ?? 'Dev User')
  // Stable, deterministic-looking email so re-running doesn't churn
  // the row and so audit history is greppable.
  const email = `${userId}@dev.local`

  // 1) Find or create the users row.
  const existing = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(sql`${users.id} = ${userId}`)
    .limit(1)

  let dbUserId: string
  if (existing[0]) {
    dbUserId = existing[0].id
    await db
      .update(users)
      .set({ name })
      .where(sql`${users.id} = ${userId}`)
  } else {
    dbUserId = userId
    await db.insert(users).values({
      id: dbUserId,
      email,
      name,
      image: null,
      emailVerified: null,
      isGuest: false,
      modelProvider: 'gemini',
    })
  }

  // 2) Mint a session_token + link via user_sessions.
  const sessionToken = `dev_${randomUUID().replace(/-/g, '')}`
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
  await db.execute(sql`
    INSERT INTO user_sessions (session_token, user_id, expires_at, created_at)
    VALUES (${sessionToken}, ${dbUserId}, ${expiresAt.toISOString()}, NOW())
  `)

  // 3) Set the cookie on the active response so the browser picks it up.
  await setSessionCookie(sessionToken)

  return NextResponse.json({
    user: {
      user_id: dbUserId,
      email,
      name,
      picture: null,
      model_provider: 'gemini',
      is_guest: false,
    },
  })
}

/**
 * GET variant — convenient for a one-click browser "Continue as Dev"
 * link that POSTs via a small <form>. Mirrors the POST contract. Most
 * callers will hit this via the SignInModal button (a fetch POST that
 * reloads on success).
 */
export async function GET(req: NextRequest) {
  return POST(req)
}

// Re-export the cookie name so tests / tooling can introspect the
// exact same constant the server uses.
export { SESSION_TOKEN_COOKIE }
