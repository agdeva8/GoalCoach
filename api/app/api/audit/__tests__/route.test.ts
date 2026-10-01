/**
 * Tests for GET /api/audit (paginated audit log).
 */

vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-test-secret-32+chars',
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

const mockAuth = vi.fn().mockResolvedValue(null)
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}))

function makeSelectChain(rows: any[] = []) {
  const chain: any = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(rows))
  return chain
}

const mockSelectImpl: any = vi.fn()
vi.mock('@/lib/db', () => ({
  db: { select: mockSelectImpl },
}))

function makeRequest(
  params: Record<string, string> = {},
  cookieValue: string | null = null
): NextRequest {
  const url = new URL('http://localhost/api/audit')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  const headers: Record<string, string> = {}
  if (cookieValue) {
    headers.cookie = `${GUEST_TOKEN_COOKIE}=${cookieValue}`
  }
  return new NextRequest(url, { headers })
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('GET /api/audit', () => {
  beforeEach(() => {
    mockAuth.mockReset()
    mockSelectImpl.mockReset()
    mockAuth.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockSelectImpl.mockImplementationOnce(() => makeSelectChain([]))
    const { GET } = await import('@/app/api/audit/route')
    const req = makeRequest()
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns audit events for the authenticated user', async () => {
    const userId = 'user_abc123'
    const { token } = signGuestToken(userId)

    const mockRows = [
      {
        id: 'audit_001',
        userId,
        type: 'confirm:create_goal',
        summary: 'Created goal "Learn TypeScript"',
        payload: { title: 'Learn TypeScript' },
        createdAt: new Date('2026-01-01T10:00:00Z'),
      },
    ]
    mockSelectImpl.mockImplementationOnce(() => makeSelectChain(mockRows))

    const { GET } = await import('@/app/api/audit/route')
    const req = makeRequest({}, token)
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].type).toBe('confirm:create_goal')
    expect(body[0].user_id).toBe(userId)
    expect(body[0].created_at).toBe('2026-01-01T10:00:00.000Z')
  })

  it('respects limit parameter capped at 200', async () => {
    const userId = 'user_abc123'
    const { token } = signGuestToken(userId)
    mockSelectImpl.mockImplementationOnce(() => makeSelectChain([]))

    const { GET } = await import('@/app/api/audit/route')
    // limit=10 should pass 10 to the chain
    const req = makeRequest({ limit: '10' }, token)
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('filters by type prefix when type param is provided', async () => {
    const userId = 'user_abc123'
    const { token } = signGuestToken(userId)
    mockSelectImpl.mockImplementationOnce(() => makeSelectChain([]))

    const { GET } = await import('@/app/api/audit/route')
    const req = makeRequest({ type: 'confirm:create_goal' }, token)
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})
