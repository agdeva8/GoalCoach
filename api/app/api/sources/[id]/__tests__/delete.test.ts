/**
 * DELETE /api/sources/[id] — integration tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGuestToken: vi.fn(),
}))

vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-test-secret-32+chars',
    EMERGENT_LLM_KEY: 'sk-emergent-test',
    INTEGRATION_PROXY_URL: 'https://integrations.emergentagent.com',
  },
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.mockAuth }))
vi.mock('@/lib/guest-token', () => ({ verifyGuestToken: mocks.mockGuestToken }))

// Default chain returns empty rows. The success test overrides
// `db.select` to return a row.
function makeSelectChain(rows: any[]) {
  const chain: any = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(rows))
  return chain
}

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => makeSelectChain([])),
    insert: vi.fn().mockReturnValue({ values: vi.fn() }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
  },
}))

import { DELETE } from '../route'
import { NextRequest } from 'next/server'

const { mockAuth, mockGuestToken } = mocks

const SESSION_TOKEN = 'test_session_founder01'

function makeDeleteRequest(id: string, token?: string) {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return new NextRequest(`http://localhost/api/sources/${id}`, { method: 'DELETE', headers })
}

describe('DELETE /api/sources/[id]', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: 'user_founder01', isGuest: false, modelProvider: 'gemini' } })
    mockGuestToken.mockReturnValue(null)
  })
  afterEach(() => { vi.clearAllMocks() })

  it('rejects unauthenticated requests with 401', async () => {
    mockAuth.mockResolvedValueOnce({ user: null })
    const res = await DELETE(makeDeleteRequest('src_abc123'), { params: Promise.resolve({ id: 'src_abc123' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent source', async () => {
    // Default mock returns [] so this naturally returns 404.
    const res = await DELETE(makeDeleteRequest('src_notfound', SESSION_TOKEN), { params: Promise.resolve({ id: 'src_notfound' }) })
    expect(res.status).toBe(404)
  })

  it('returns { ok: true } for a valid source', async () => {
    const { db } = await import('@/lib/db')
    ;(db as any).select = vi.fn(() => makeSelectChain([{ id: 'src_abc123' }]))
    const res = await DELETE(makeDeleteRequest('src_abc123', SESSION_TOKEN), { params: Promise.resolve({ id: 'src_abc123' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})