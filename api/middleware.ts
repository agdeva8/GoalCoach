/**
 * Route protection + CORS middleware.
 *
 * Source of truth: migration/discovery/03-nextjs-architecture.md
 * Section 3 (auth model) + Section 8 Task 14 (Auth middleware
 * & route protection) + Locked Decision #3 (guest_token retained).
 *
 * Two responsibilities:
 *
 *  1. /coach/* — auth gate. Redirects unauthenticated users to the
 *     signin prompt URL. Dual-auth world: Emergent `session_token`
 *     cookie OR legacy `guest_token` HMAC cookie.
 *
 *  2. /api/* — CORS for cross-origin dev (CRA on :3000 calling the
 *     Next.js backend on :3001). Adds the standard headers to every
 *     API response and short-circuits OPTIONS preflight with a 204.
 *     In production, the allowed origin is the deployed frontend
 *     URL; for dev it's http://localhost:3000.
 *
 * Runs with `runtime: 'nodejs'` (Next 16 supports it) so we can
 * import the same `getAuthenticatedUser()` helper without forking
 * into an edge-compatible auth config.
 */

import { NextResponse, type NextRequest } from 'next/server'

import { getAuthenticatedUser } from '@/lib/auth'
import { GUEST_TOKEN_COOKIE, verifyGuestToken } from '@/lib/guest-token'

export const runtime = 'nodejs'

const PUBLIC_PREFIXES = [
  '/api/auth', // Emergent + legacy guest route
  '/auth',     // OAuth callback
  '/_next',
]

const PUBLIC_EXACT = new Set<string>(['/', '/favicon.ico'])

function isStaticAsset(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? ''
  return last.includes('.')
}

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true
  if (isStaticAsset(pathname)) return true
  return false
}

function isCoachPath(pathname: string): boolean {
  return pathname === '/coach' || pathname.startsWith('/coach/')
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/')
}

// Allowed origins for CORS. In dev the CRA frontend lives on :3000.
// In prod, set `CORS_ALLOWED_ORIGIN` to the deployed frontend URL
// (e.g., https://v2.goalcoach.com).
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:4004', 'http://127.0.0.1:3000', 'http://127.0.0.1:4004']

function getAllowedOrigin(req: NextRequest): string {
  const configured = process.env.CORS_ALLOWED_ORIGIN?.trim()
  if (configured) return configured
  const requestOrigin = req.headers.get('origin') ?? ''
  if (DEV_ORIGINS.includes(requestOrigin)) return requestOrigin
  // Fallback: assume dev. Prod must set the env var explicitly.
  return DEV_ORIGINS[0]
}

function corsHeaders(req: NextRequest): Headers {
  const h = new Headers()
  h.set('Access-Control-Allow-Origin', getAllowedOrigin(req))
  h.set('Access-Control-Allow-Credentials', 'true')
  h.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  h.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Cookie, X-Requested-With'
  )
  h.set('Access-Control-Max-Age', '86400')
  // Expose headers the browser may need to read (e.g., Set-Cookie flows).
  h.set('Access-Control-Expose-Headers', 'Set-Cookie')
  return h
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // --- CORS preflight for /api/* ---
  if (isApiPath(pathname) && req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(req),
    })
  }

  // --- CORS for actual /api/* requests ---
  if (isApiPath(pathname)) {
    const res = NextResponse.next()
    corsHeaders(req).forEach((value, key) => res.headers.set(key, value))
    return res
  }

  // --- Auth gate for /coach/* ---
  if (!isCoachPath(pathname)) {
    if (isPublic(pathname)) return NextResponse.next()
    return NextResponse.next()
  }

  const ctx = await getAuthenticatedUser()
  if (ctx?.user?.id) return NextResponse.next()

  const guestToken = req.cookies.get(GUEST_TOKEN_COOKIE)?.value
  if (verifyGuestToken(guestToken)) return NextResponse.next()

  if (req.nextUrl.searchParams.get('signin')) {
    return NextResponse.next()
  }
  const url = req.nextUrl.clone()
  url.pathname = '/coach'
  url.search = '?signin=google'
  return NextResponse.redirect(url)
}

export const config = {
  // Run on /api/* (CORS), /coach/* (auth), and root (auth redirect).
  matcher: ['/api/:path*', '/coach/:path*', '/'],
}
