/**
 * Emergent OAuth REST client.
 *
 * Source of truth: backend/server.py:84-150 (the Python
 * `/api/auth/session` handler we are replacing).
 *
 * Wire protocol — discovered by reading the Python
 * `emergentintegrations.llm.chat.LlmChat` source and the legacy
 * `create_session` handler:
 *
 *   GET  EMERGENT_AUTH_URL
 *        Headers: X-Session-ID: <session_id>
 *        200     { id, email, name, picture, session_token }
 *
 * `EMERGENT_AUTH_URL` defaults to the production OAuth round-trip
 * endpoint Emergent exposes for this exact flow:
 *   https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data
 *
 * The returned `session_token` is what the client surfaces back to the
 * browser as an HttpOnly cookie (7-day lifetime, matching the
 * Python `response.set_cookie(max_age=7 * 24 * 60 * 60)`).
 *
 * Why server-only:
 *   - Reads `EMERGENT_LLM_KEY` and `INTEGRATION_PROXY_URL` from
 *     `process.env`. Never bundle this file into a client component.
 *   - Uses `next/headers.cookies` to write the cookie from the
 *     `/api/auth/session` route handler.
 */

import 'server-only'

import { cookies } from 'next/headers'

/* -------------------------------------------------------------------------- */
/* Types — mirror the JSON returned by the Emergent OAuth round-trip.        */
/* -------------------------------------------------------------------------- */

export interface EmergentSessionUser {
  /** Provider-side user id (Emergent's, not ours). */
  id: string
  email: string
  name: string | null
  picture: string | null
  /**
   * Bearer-ish token the backend can keep server-side. We never
   * return this to the client — we only set it as an HttpOnly cookie.
   */
  session_token: string
}

export interface EmergentAuthError extends Error {
  status: number
  cause?: unknown
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The URL the frontend (AuthCallback.js / `frontend/src/components/…`)
 * posts a `session_id` to for the OAuth round-trip. Override via
 * `EMERGENT_AUTH_URL` if you proxy Emergent behind a different host
 * (e.g. for staging).
 */
const DEFAULT_AUTH_URL =
  'https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data'

function resolveAuthUrl(): string {
  const fromEnv = process.env.EMERGENT_AUTH_URL?.trim()
  return (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_AUTH_URL)
}

/** HttpOnly cookie name carrying the Emergent session token.
 *  Matches the Python `response.set_cookie(key="session_token", …)`. */
export const SESSION_TOKEN_COOKIE = 'session_token'

/** Cookie lifetime: 7 days, matching Python server.py:147. */
export const SESSION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

/* -------------------------------------------------------------------------- */
/* exchangeSessionId                                                          */
/*                                                                             */
/* POST/GETs the Emergent auth endpoint with the hash-derived `session_id`  */
/* the frontend extracted from the OAuth redirect. Returns the user info    */
/* and the opaque session token to set as the HttpOnly cookie.              */
/* -------------------------------------------------------------------------- */

/**
 * Exchange a `session_id` (delivered to the browser via OAuth redirect)
 * for the user's profile + a server-side `session_token`.
 *
 * Throws an `EmergentAuthError` with `status: 401` on a non-200
 * response so the route handler can map it directly to a 401.
 *
 * @param sessionId — the `session_id` value from the OAuth hash fragment.
 */
export async function exchangeSessionId(
  sessionId: string,
): Promise<EmergentSessionUser> {
  const url = resolveAuthUrl()
  const headers: Record<string, string> = {
    'X-Session-ID': sessionId,
    Accept: 'application/json',
  }

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers,
      // 15-second ceiling mirrors Python `timeout=15` on requests.get.
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
  } catch (e) {
    const err = new Error(
      `Emergent auth service unreachable: ${(e as Error).message ?? String(e)}`,
    ) as EmergentAuthError
    err.status = 502
    err.cause = e
    throw err
  }

  if (resp.status !== 200) {
    let detail = ''
    try {
      detail = await resp.text()
    } catch {
      /* ignore */
    }
    const err = new Error(
      `Emergent auth rejected session_id (HTTP ${resp.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    ) as EmergentAuthError
    err.status = resp.status === 200 ? 401 : resp.status
    throw err
  }

  let body: unknown
  try {
    body = await resp.json()
  } catch (e) {
    const err = new Error('Emergent auth returned non-JSON body') as EmergentAuthError
    err.status = 502
    err.cause = e
    throw err
  }

  const data = body as Partial<EmergentSessionUser>
  if (
    typeof data.email !== 'string' ||
    typeof data.session_token !== 'string' ||
    typeof data.id !== 'string'
  ) {
    const err = new Error(
      'Emergent auth response missing required fields (email/session_token/id)',
    ) as EmergentAuthError
    err.status = 502
    throw err
  }

  return {
    id: data.id,
    email: data.email,
    name: typeof data.name === 'string' ? data.name : null,
    picture: typeof data.picture === 'string' ? data.picture : null,
    session_token: data.session_token,
  }
}

/* -------------------------------------------------------------------------- */
/* Cookie helpers                                                              */
/*                                                                             */
/* The route handler (`/api/auth/session`) writes the cookie after a         */
/* successful exchange. signOut deletes it.                                 */
/* -------------------------------------------------------------------------- */

/**
 * Set the `session_token` cookie on the active response.
 *
 * Mirrors the Python `response.set_cookie(key="session_token", value=…,
 * max_age=7*24*60*60, httponly=True, secure=True, samesite="none", path="/")`.
 * `secure` is `true` in production and `false` in development so
 * http://localhost still works.
 */
export async function setSessionCookie(
  sessionToken: string,
): Promise<void> {
  const jar = await cookies()
  const isProd = process.env.NODE_ENV === 'production'
  jar.set({
    name: SESSION_TOKEN_COOKIE,
    value: sessionToken,
    httpOnly: true,
    secure: isProd,
    sameSite: 'none',
    maxAge: SESSION_TOKEN_TTL_SECONDS,
    path: '/',
  })
}

/**
 * Clear the `session_token` cookie. Used by `/api/auth/logout`.
 */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies()
  jar.set({
    name: SESSION_TOKEN_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    maxAge: 0,
    path: '/',
  })
}