/**
 * Smoke tests for /api/auth/me.
 *
 * Phase 1 Task 6 acceptance criterion:
 *   "At minimum, a smoke test that /api/auth/session returns null when
 *    not authenticated." — `/api/auth/me` is the legacy FastAPI surface
 *    that the frontend already calls; it must return 401 when there is
 *    neither an Auth.js session nor a valid `guest_token` cookie.
 */

// Stub out env BEFORE importing any module that loads lib/env.
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { GUEST_TOKEN_COOKIE, signGuestToken } from '@/lib/guest-token'

/* -------------------------------------------------------------------------- */
/* Mocks                                                                      */
/* -------------------------------------------------------------------------- */

// Default: no Auth.js session.
const mockAuth = vi.fn().mockResolvedValue(null)
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}))

// Default: no user row returned (i.e. empty DB).
function makeSelectChain(rows: any[] = []) {
  const chain: any = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(rows))
  return chain
}

const mockSelectImpl: any = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelectImpl(...args),
  },
}))

function makeRequestWithCookie(cookieValue: string | null): NextRequest {
  const headers: Record<string, string> = {}
  if (cookieValue) {
    headers.cookie = `${GUEST_TOKEN_COOKIE}=${cookieValue}`
  }
  // NextRequest takes a URL + init; cookie parsing happens in the
  // request constructor.
  return new NextRequest('http://localhost/api/auth/me', { headers })
}

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    mockAuth.mockReset()
    mockSelectImpl.mockReset()
    mockAuth.mockResolvedValue(null)
    mockSelectImpl.mockImplementation(() => makeSelectChain([]))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when there is no Auth.js session and no guest_token cookie', async () => {
    const { GET } = await import('@/app/api/auth/me/route')
    const req = makeRequestWithCookie(null)
    const res = await GET(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.detail).toMatch(/not authenticated/i)
  })

  it('returns 401 when the guest_token cookie is malformed', async () => {
    const { GET } = await import('@/app/api/auth/me/route')
    const req = makeRequestWithCookie('not-a-real-token')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns the Auth.js session user when one is present', async () => {
    mockAuth.mockResolvedValueOnce({
      user: {
        id: 'user_google_abc',
        isGuest: false,
        modelProvider: 'gemini',
        name: 'Ada',
        email: 'ada@example.com',
        image: 'https://example.com/p.png',
      },
    })

    const { GET } = await import('@/app/api/auth/me/route')
    const req = makeRequestWithCookie(null)
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      user_id: 'user_google_abc',
      email: 'ada@example.com',
      name: 'Ada',
      image: 'https://example.com/p.png',
      model_provider: 'gemini',
      is_guest: false,
    })
  })

  it('returns the guest user when a valid guest_token cookie is present', async () => {
    const { token } = signGuestToken('user_guest_abc123456789')

    mockSelectImpl.mockImplementationOnce(() =>
      makeSelectChain([
        {
          id: 'user_guest_abc123456789',
          email: null,
          name: 'Guest',
          image: null,
          modelProvider: 'gemini',
          isGuest: true,
        },
      ])
    )

    const { GET } = await import('@/app/api/auth/me/route')
    const req = makeRequestWithCookie(token)
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      user_id: 'user_guest_abc123456789',
      email: null,
      name: 'Guest',
      image: null,
      model_provider: 'gemini',
      is_guest: true,
    })
  })
})
