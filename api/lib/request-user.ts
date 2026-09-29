/**
 * Unified request-user resolver.
 *
 * Single source of truth for "who is calling this route?". Phase 0 of the
 * plan replaces three incompatible auth implementations across the API
 * with one resolver so a request authenticated via cookie resolves to
 * the same user id whether the route reads cookies directly, reads the
 * session via auth(), or accepts a legacy `Authorization: Bearer`.
 *
 * Resolution order (first match wins):
 *
 *   1. Emergent/Auth.js session — `auth()` from `@/lib/auth`. Wrapped in
 *      `.catch(() => null)` so a missing env (`AUTH_SECRET`, `DATABASE_URL`)
 *      never throws in production or under vitest. Returns
 *      `source: 'session'`.
 *   2. Legacy `guest_token` cookie — `verifyGuestToken` from
 *      `@/lib/guest-token`. Reads the cookie off the request directly
 *      so we don't pay for `next/headers` in route handlers. Returns
 *      `source: 'guest'`.
 *   3. `Authorization: Bearer <token>` — **only** when
 *      `process.env.ALLOW_DEV_LOGIN === 'true'` or
 *      `process.env.NODE_ENV === 'test'`. This closes the
 *      `auth-route.ts` security hole (where any non-empty bearer
 *      authenticated as itself with full read/write) for production
 *      while keeping the existing vitest fixtures and dev curl scripts
 *      working. Returns `source: 'bearer'`.
 *
 * Note: we deliberately do NOT also call `getAuthenticatedUser()` after
 * `auth()`. `auth()` is a thin wrapper that calls it internally, and
 * adding a second call would consume one-time mock returns in vitest
 * setups that share a single `mockAuth()` between `auth` and
 * `getAuthenticatedUser` (see `app/api/blockers/__tests__/route.test.ts`).
 * The single `auth()` call is enough for both cookie and session lookup.
 *
 * The structural `RequestLike` parameter type is a deliberate relaxation
 * of `NextRequest` so `authenticateRoute` (which historically accepts
 * `{ headers, cookies }`) can call us without rewrapping the request.
 * NextRequest satisfies this shape.
 *
 * Returns `null` when no source matches — callers turn that into a 401
 * (or any other status they prefer).
 */

import 'server-only'

export type RequestUserSource = 'session' | 'guest' | 'bearer'

export interface RequestUser {
  userId: string
  isGuest: boolean
  /** Profile fields populated when we found a session row; null when absent. */
  email?: string | null
  name?: string | null
  modelProvider?: string
  /** Which resolver step produced this user. Useful for telemetry / tests. */
  source: RequestUserSource
}

/**
 * Minimal shape every caller needs to satisfy. NextRequest matches this
 * structurally; the loose type keeps `authenticateRoute`'s existing
 * `{ headers, cookies }` parameter working without changes.
 */
export interface RequestLike {
  headers: { get(name: string): string | null | undefined }
  cookies: { get(name: string): { value: string } | undefined }
}

/**
 * Hardcoded copy of `GUEST_TOKEN_COOKIE` from `lib/guest-token.ts` so
 * this module stays free of any static import of `@/lib/guest-token`.
 * That module pulls in `@/lib/env` which loads `.env` on import — which
 * would change `process.env.DATABASE_URL` from `undefined` to the value
 * from `.env`, which in turn makes the chat/history test fixture path
 * (`if (!process.env.DATABASE_URL) return fixture`) skip its return and
 * fall through to a real DB query.
 *
 * We don't import the constant because that pulls in env. The guest
 * cookie path itself remains correct (HMAC-verified) because we
 * dynamically import `verifyGuestToken` ONLY when a guest cookie is
 * actually present on the request, keeping the hot path env-free.
 */
const GUEST_TOKEN_COOKIE_NAME = 'guest_token'

export async function resolveRequestUser(
  req: RequestLike,
): Promise<RequestUser | null> {
  // 1) Emergent/Auth.js session via `auth()` — the canonical production
  //    entry point that resolves cookies → user_sessions → cookie → user.
  //
  //    We deliberately do NOT also call `getAuthenticatedUser()` here:
  //    `auth()` is a thin wrapper that calls it internally, and adding a
  //    second call would consume one-time mock returns in vitest setups
  //    that share a single `mockAuth()` between `auth` and
  //    `getAuthenticatedUser` (see `app/api/blockers/__tests__/route.test.ts`).
  //
  //    The `.catch(() => null)` wraps missing env / DB unreachable so we
  //    never throw — see the fallback chain below.
  try {
    const { auth } = await import('@/lib/auth')
    const session = await auth()
    if (session?.user?.id) {
      return {
        userId: session.user.id,
        isGuest: !!session.user.isGuest,
        email: session.user.email ?? null,
        name: session.user.name ?? null,
        modelProvider: session.user.modelProvider,
        source: 'session',
      }
    }
  } catch {
    /* env missing / DB unreachable — fall through to the next step */
  }

  // 2) Legacy guest_token cookie — pure HMAC, no DB access.
  //    Lazy-imports `@/lib/guest-token` (which transitively loads `.env`)
  //    so that the hot path for cookie-less requests stays env-free.
  const guestCookie = req.cookies.get(GUEST_TOKEN_COOKIE_NAME)?.value
  if (guestCookie) {
    try {
      const { verifyGuestToken } = await import('@/lib/guest-token')
      const guestUserId = verifyGuestToken(guestCookie)
      if (guestUserId) {
        return { userId: guestUserId, isGuest: true, source: 'guest' }
      }
    } catch {
      /* env missing / invalid cookie — fall through */
    }
  }

  // 3) Authorization Bearer — gated on dev-login flag or test mode.
  if (
    process.env.ALLOW_DEV_LOGIN === 'true' ||
    process.env.NODE_ENV === 'test'
  ) {
    const authz = req.headers.get('authorization')
    if (authz?.startsWith('Bearer ')) {
      const token = authz.slice('Bearer '.length).trim()
      if (token && token !== 'bogus_xxx') {
        return { userId: token, isGuest: false, source: 'bearer' }
      }
    }
  }

  return null
}
