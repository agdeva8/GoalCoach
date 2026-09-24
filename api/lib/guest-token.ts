/**
 * Legacy `guest_token` cookie — HMAC-signed, 10-minute expiration.
 *
 * Source of truth: migration/discovery/03-nextjs-architecture.md
 * Locked Decision #3 — keep the legacy guest_token cookie semantics
 * with a 10-minute expiration (anti-abuse window). The architecture
 * sketch mentions a simpler `isGuest=true` row path, but the locked
 * decision explicitly retains the signed cookie format, so we honor
 * that here.
 *
 * Wire format:
 *
 *   base64url(payloadJson) + "." + base64url(hmacSha256(payloadJson, AUTH_SECRET))
 *
 * where payloadJson is `{ "userId": "user_guest_<hex12>", "exp": <unix-ms> }`.
 *
 * The signature is checked with `crypto.timingSafeEqual` so an attacker
 * who guesses one byte of the MAC can't probe other values cheaply.
 *
 * The cookie name is exported as `GUEST_TOKEN_COOKIE` so
 * `/api/auth/guest`, the middleware, and the sign-out action all
 * reference a single source of truth.
 */

import 'server-only'

import crypto from 'node:crypto'

import { env } from '@/lib/env'

export const GUEST_TOKEN_COOKIE = 'guest_token'

/** 10-minute window (locked decision). */
export const GUEST_TOKEN_TTL_SECONDS = 60 * 10

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

interface GuestTokenPayload {
  userId: string
  exp: number // unix milliseconds
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(std, 'base64')
}

function hmac(payload: string): Buffer {
  return crypto.createHmac('sha256', env.AUTH_SECRET).update(payload).digest()
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  // `crypto.timingSafeEqual` requires equal-length buffers; pad the
  // shorter one with zero bytes (which still fails the comparison but
  // avoids the throw that would otherwise reveal length mismatch).
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Generate a fresh guest user ID in the locked format `user_guest_<hex12>`.
 * 12 hex chars = 48 bits = ~280T values, more than enough for a 10-min
 * anti-abuse window.
 */
export function generateGuestUserId(): string {
  const hex = crypto.randomBytes(6).toString('hex')
  return `user_guest_${hex}`
}

/**
 * Sign a guest token for the given user ID. Returns the cookie value
 * (already in `payload.signature` form) and the absolute expiration
 * Date — the caller can put the Date in the response body for the
 * frontend to display.
 */
export function signGuestToken(userId: string): {
  token: string
  expiresAt: Date
} {
  const expiresAt = new Date(Date.now() + GUEST_TOKEN_TTL_SECONDS * 1000)
  const payload: GuestTokenPayload = {
    userId,
    exp: expiresAt.getTime(),
  }
  const payloadJson = JSON.stringify(payload)
  const payloadB64 = b64urlEncode(Buffer.from(payloadJson, 'utf8'))
  const sig = hmac(payloadB64)
  const sigB64 = b64urlEncode(sig)
  return { token: `${payloadB64}.${sigB64}`, expiresAt }
}

/**
 * Verify a guest token and return the user ID if valid, or `null` if
 * the signature is wrong, the format is bad, or the token has expired.
 *
 * Pure (no I/O); safe to call from middleware and route handlers.
 */
export function verifyGuestToken(token: string | undefined | null): string | null {
  if (!token) return null

  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null

  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)

  let payloadBytes: Buffer
  let sigBytes: Buffer
  try {
    payloadBytes = b64urlDecode(payloadB64)
    sigBytes = b64urlDecode(sigB64)
  } catch {
    return null
  }

  const expected = hmac(payloadB64)
  if (!timingSafeEqual(expected, sigBytes)) return null

  let parsed: GuestTokenPayload
  try {
    parsed = JSON.parse(payloadBytes.toString('utf8')) as GuestTokenPayload
  } catch {
    return null
  }

  if (typeof parsed.userId !== 'string' || typeof parsed.exp !== 'number') {
    return null
  }
  if (parsed.exp <= Date.now()) return null

  return parsed.userId
}
