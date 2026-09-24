/**
 * Server actions for sign-in / sign-out — Emergent OAuth world.
 *
 * Source of truth: migration/discovery/03-nextjs-architecture.md
 * Section 3 (auth model) — after the Emergent swap.
 *
 * Replaces the previous `signInWithGoogle()` server action (which
 * delegated to Auth.js v5). The flow is now:
 *
 *   1. `signInWithEmergent()` / `signInWithEmergentAction()` redirect
 *      the browser to the Emergent OAuth host. Emergent redirects back
 *      to `/auth/callback` with `?session_id=…`.
 *   2. The `/auth/callback` page POSTs the `session_id` to
 *      `/api/auth/session`, which exchanges it via `lib/emergent/auth.ts`
 *      and sets the cookie.
 *
 * `signOutAction()` clears the `session_token` + `guest_token` cookies
 * (the dual-auth world of the migration).
 *
 * `continueAsGuestAction()` sets the `guest_token` cookie directly via
 * `next/headers` `cookies()` so the browser actually receives it (a
 * server-side `fetch` to `/api/auth/guest` would set the cookie on the
 * API response, but server actions can't forward `Set-Cookie` to the
 * user's browser).
 */

'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { signOut as clearSession } from '@/lib/auth'
import {
  GUEST_TOKEN_COOKIE,
  GUEST_TOKEN_TTL_SECONDS,
  generateGuestUserId,
  signGuestToken,
} from '@/lib/guest-token'
import { db } from '@/lib/db'
import { users } from '@/db/schema'

/**
 * Begin the Emergent OAuth flow.
 *
 * Returns the Emergent OAuth URL for callers that want to navigate the
 * browser themselves (the AuthCallback pattern). When called as a server
 * action from the Header, the caller typically does
 * `window.location.href = await signInWithEmergent()` so the redirect
 * happens client-side and the server action doesn't need to throw.
 */
export async function signInWithEmergent(): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const redirectParam = encodeURIComponent(
    `${appUrl.replace(/\/$/, '')}/auth/callback`
  )
  // The Emergent OAuth start URL — production host. If you've
  // configured `EMERGENT_AUTH_URL` to a custom proxy, point the
  // browser at `/auth/start` instead which proxies through that host.
  const emergentOAuthBase =
    process.env.EMERGENT_OAUTH_URL?.trim() ||
    'https://demobackend.emergentagent.com/auth/v1/env/oauth/login'
  return `${emergentOAuthBase}?redirect=${redirectParam}`
}

/**
 * Form-action version of `signInWithEmergent()`. Used by `<form action>`
 * buttons; calls `redirect()` so the browser navigates to Emergent's
 * OAuth host. Replaces the broken `<a href="/api/auth/signin/google">`.
 */
export async function signInWithEmergentAction(): Promise<void> {
  const url = await signInWithEmergent()
  redirect(url)
}

/**
 * Form-action guest flow. Sets `guest_token` directly via `next/headers`
 * `cookies()` so the browser actually receives it. Mirrors the work in
 * `app/api/auth/guest/route.ts` so either entry point produces an
 * identical user state.
 */
export async function continueAsGuestAction(): Promise<void> {
  const userId = generateGuestUserId()

  await db.insert(users).values({
    id: userId,
    email: null,
    name: 'Guest',
    image: null,
    emailVerified: null,
    isGuest: true,
  })

  const { token } = signGuestToken(userId)

  const jar = await cookies()
  jar.set({
    name: GUEST_TOKEN_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: GUEST_TOKEN_TTL_SECONDS,
    path: '/',
  })

  redirect('/coach')
}

/**
 * Sign out of Emergent OAuth + the guest flow.
 *
 * Clears the `session_token` cookie (handled by `signOut` in
 * `lib/auth.ts`) and also the `guest_token` cookie in case a user
 * previously authenticated as a guest and upgraded without explicitly
 * signing out first.
 */
export async function signOutAction(): Promise<void> {
  const jar = await cookies()
  jar.delete(GUEST_TOKEN_COOKIE)
  await clearSession()
}
