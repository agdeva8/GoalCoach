/**
 * Smoke tests for guest_token helpers + /api/auth/guest route.
 *
 * Covers the Phase 1 Task 6 acceptance criteria:
 *  - signGuestToken / verifyGuestToken round-trip
 *  - forged signatures are rejected
 *  - expired tokens are rejected
 *  - the /api/auth/guest route inserts a `users` row with isGuest=true
 *    and sets an HttpOnly cookie with a 10-minute maxAge
 */

// Stub out env BEFORE importing lib/db or lib/guest-token so the zod
// schema doesn't fail validation in the test runner.
vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    AUTH_SECRET:
      'test-secret-test-secret-test-secret-test-secret-32+chars',
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    OPENAI_API_KEY: 'test-openai-key',
    MINIMAX_API_KEY: 'test-MiniMax-key',
    MINIMAX_BASE_URL: 'https://api.MiniMax.example.com',
    BLOB_READ_WRITE_TOKEN: 'test-blob-token',
  },
}))

// Mock the DB layer so we don't hit Postgres in unit tests.
vi.mock('@/lib/db', async () => {
  const schema = await import('@/db/schema')
  return {
    db: {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    },
    schema,
  }
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/lib/db'
import { users } from '@/db/schema'
import {
  GUEST_TOKEN_COOKIE,
  GUEST_TOKEN_TTL_SECONDS,
  generateGuestUserId,
  signGuestToken,
  verifyGuestToken,
} from '@/lib/guest-token'

/* -------------------------------------------------------------------------- */
/* signGuestToken / verifyGuestToken                                          */
/* -------------------------------------------------------------------------- */

describe('signGuestToken / verifyGuestToken', () => {
  it('round-trips a fresh user id', () => {
    const userId = generateGuestUserId()
    const { token, expiresAt } = signGuestToken(userId)

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(verifyGuestToken(token)).toBe(userId)

    const ttlMs = expiresAt.getTime() - Date.now()
    // Allow a 2s skew for test runtime.
    expect(ttlMs).toBeGreaterThan(GUEST_TOKEN_TTL_SECONDS * 1000 - 2000)
    expect(ttlMs).toBeLessThanOrEqual(GUEST_TOKEN_TTL_SECONDS * 1000)
  })

  it('rejects undefined / empty / null tokens', () => {
    expect(verifyGuestToken(undefined)).toBeNull()
    expect(verifyGuestToken(null)).toBeNull()
    expect(verifyGuestToken('')).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifyGuestToken('no-dot-here')).toBeNull()
    expect(verifyGuestToken('.justdot')).toBeNull()
    expect(verifyGuestToken('justdot.')).toBeNull()
    expect(verifyGuestToken('a.b.c')).toBeNull()
  })

  it('rejects a forged signature', () => {
    const userId = generateGuestUserId()
    const { token } = signGuestToken(userId)
    const dot = token.indexOf('.')
    // Flip the last character of the signature so HMAC no longer matches.
    const forged = token.slice(0, dot + 1) + (token.endsWith('A') ? 'B' : 'A')
    expect(verifyGuestToken(forged)).toBeNull()
  })

  it('rejects an expired token', () => {
    const userId = generateGuestUserId()
    // Build a token whose exp is already in the past. We hard-code the
    // secret to match the `vi.mock('@/lib/env', ...)` stub at the top
    // of this file.
    const secret =
      'test-secret-test-secret-test-secret-test-secret-32+chars'
    const payload = Buffer.from(
      JSON.stringify({ userId, exp: Date.now() - 1000 }),
      'utf8'
    )
    const crypto = require('node:crypto') as typeof import('node:crypto')
    const payloadB64 = payload
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
    const sig = crypto
      .createHmac('sha256', secret)
      .update(payloadB64)
      .digest()
    const sigB64 = sig
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
    const token = `${payloadB64}.${sigB64}`
    expect(verifyGuestToken(token)).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* /api/auth/guest route                                                      */
/* -------------------------------------------------------------------------- */

describe('POST /api/auth/guest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('inserts a users row with isGuest=true and sets the guest_token cookie', async () => {
    const { POST } = await import('@/app/api/auth/guest/route')

    const response = await POST()
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.user.is_guest).toBe(true)
    expect(body.user.user_id).toMatch(/^user_guest_[0-9a-f]{12}$/)
    expect(body.user.email).toBeNull()
    expect(body.user.name).toBe('Guest')
    expect(body.user.picture).toBeNull()
    expect(body.user.model_provider).toBe('gemini')

    // The DB insert was called with an isGuest=true row.
    expect(db.insert).toHaveBeenCalledWith(users)
    const insertValues = (db.insert as any).mock.results[0].value.values
    expect(insertValues).toHaveBeenCalledTimes(1)
    const inserted = insertValues.mock.calls[0][0]
    expect(inserted.isGuest).toBe(true)
    expect(inserted.email).toBeNull()
    expect(inserted.id).toBe(body.user_id)

    // The cookie has the expected name + 10-minute maxAge + HttpOnly.
    const cookie = response.cookies.get(GUEST_TOKEN_COOKIE)
    expect(cookie).toBeDefined()
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.maxAge).toBe(GUEST_TOKEN_TTL_SECONDS)
    expect(cookie?.path).toBe('/')

    // The cookie value is a valid guest token that round-trips to the
    // same user_id the response body returned.
    expect(verifyGuestToken(cookie?.value)).toBe(body.user_id)
  })
})
