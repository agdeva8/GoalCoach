/**
 * /api/milestones POST — direct milestone creation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const mockAuth = vi.fn()
  const selectResultHolder: { current: unknown[] } = { current: [] }

  function buildChain(): any {
    const chain: any = {}
    chain.from = vi.fn(() => chain)
    chain.where = vi.fn(() => chain)
    chain.orderBy = vi.fn(() => chain)
    chain.limit = vi.fn(() => Promise.resolve(selectResultHolder.current))
    chain.values = vi.fn(() => chain)
    chain.set = vi.fn(() => chain)
    chain.returning = vi.fn(() => Promise.resolve([]))
    chain.select = vi.fn(() => chain)
    chain.insert = vi.fn(() => chain)
    chain.update = vi.fn(() => chain)
    chain.delete = vi.fn(() => chain)
    return chain
  }

  const chain = buildChain()
  const transaction = vi.fn(async (cb: any) => cb(chain))
  const dbMock = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    transaction,
  }

  return { mockAuth, chain, dbMock, transaction, selectResultHolder }
})

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
    MINIMAX_BASE_URL: 'https://api.minimax.example.com',
    BLOB_READ_WRITE_TOKEN: 'test-blob-token',
  },
}))

vi.mock('@/lib/auth', () => ({ auth: () => mocks.mockAuth(), getAuthenticatedUser: () => mocks.mockAuth().then((s: any) => s ? { user: { id: s.user.id, email: null, name: null, image: null, modelProvider: 'gemini', isGuest: false }, source: 'session' } : null) }))
vi.mock('@/lib/db', () => ({ db: mocks.dbMock }))

const { POST } = await import('../route')

const FOUNDING_USER = 'user_founder01'
const { mockAuth, chain, transaction, selectResultHolder } = mocks

function makeReq(body: object, token?: string): NextRequest {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return new NextRequest('http://localhost/api/milestones', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function resetMocks() {
  for (const k of [
    'from',
    'where',
    'orderBy',
    'limit',
    'values',
    'set',
    'returning',
    'select',
    'insert',
    'update',
    'delete',
  ]) {
    chain[k].mockClear()
  }
  transaction.mockClear()
  selectResultHolder.current = []
  mockAuth.mockReset()
  mockAuth.mockResolvedValue({
    user: { id: FOUNDING_USER, isGuest: false, modelProvider: 'gemini' },
  })
}

describe('POST /api/milestones', () => {
  beforeEach(resetMocks)
  afterEach(() => vi.restoreAllMocks())

  it('returns 401 without auth', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(makeReq({ title: 'First draft' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when title is missing', async () => {
    const res = await POST(makeReq({ target_date: '2026-12-31' }, FOUNDING_USER))
    expect(res.status).toBe(400)
  })

  it('returns 400 when target_date is malformed', async () => {
    const res = await POST(
      makeReq({ title: 'First draft', target_date: 'soon' }, FOUNDING_USER),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when goal_id is supplied but not owned', async () => {
    selectResultHolder.current = []
    const res = await POST(
      makeReq(
        { title: 'First draft', goal_id: 'goal_x' },
        FOUNDING_USER,
      ),
    )
    expect(res.status).toBe(404)
  })

  it('creates a milestone with audit row in one transaction', async () => {
    selectResultHolder.current = [
      {
        id: 'mile_synth',
        userId: FOUNDING_USER,
        goalId: null,
        goalTitle: '',
        title: 'First draft',
        targetDate: '2026-09-30',
        status: 'open',
        createdAt: new Date('2026-09-24T00:00:00Z'),
      },
    ]
    const res = await POST(
      makeReq({ title: 'First draft', target_date: '2026-09-30' }, FOUNDING_USER),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('mile_synth')
    expect(body.user_id).toBe(FOUNDING_USER)
    expect(body.title).toBe('First draft')
    expect(body.target_date).toBe('2026-09-30')
    expect(body.status).toBe('open')
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(chain.insert).toHaveBeenCalled()
  })
})
