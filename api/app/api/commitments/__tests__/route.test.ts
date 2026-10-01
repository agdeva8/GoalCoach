/**
 * /api/commitments POST — direct commitment creation.
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
  return new NextRequest('http://localhost/api/commitments', {
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

describe('POST /api/commitments', () => {
  beforeEach(resetMocks)
  afterEach(() => vi.restoreAllMocks())

  it('returns 401 without auth', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(makeReq({ text: 'Run 3x' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when text is missing', async () => {
    const res = await POST(makeReq({ goal_id: 'goal_x' }, FOUNDING_USER))
    expect(res.status).toBe(400)
  })

  it('returns 400 when due is not ISO YYYY-MM-DD', async () => {
    const res = await POST(
      makeReq({ text: 'Run 3x', due: 'tomorrow' }, FOUNDING_USER),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when goal_id is supplied but not owned', async () => {
    selectResultHolder.current = []
    const res = await POST(
      makeReq({ text: 'Run 3x', goal_id: 'goal_x' }, FOUNDING_USER),
    )
    expect(res.status).toBe(404)
  })

  it('creates a commitment and writes audit row in one transaction', async () => {
    selectResultHolder.current = [
      {
        id: 'commit_synth',
        userId: FOUNDING_USER,
        goalId: null,
        goalTitle: '',
        text: 'Schedule 3 runs this week',
        due: null,
        status: 'open',
        createdAt: new Date('2026-09-24T00:00:00Z'),
      },
    ]
    const res = await POST(
      makeReq({ text: 'Schedule 3 runs this week' }, FOUNDING_USER),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('commit_synth')
    expect(body.user_id).toBe(FOUNDING_USER)
    expect(body.text).toBe('Schedule 3 runs this week')
    expect(body.status).toBe('open')
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(chain.insert).toHaveBeenCalled()
  })

  it('creates a commitment linked to an owned goal', async () => {
    // First SELECT (goal title lookup) returns the goal row.
    // Second SELECT (post-insert read-back) returns the commitment.
    selectResultHolder.current = [{ title: 'Build a running habit' }]
    // We can't easily switch the result mid-test with our chain, so
    // simulate the second read by chaining a re-set: the second
    // .limit() call should see the read-back row.
    const origLimit = chain.limit.getMockImplementation()
    let calls = 0
    chain.limit.mockImplementation(() => {
      calls++
      if (calls === 1) return Promise.resolve([{ title: 'Build a running habit' }])
      return Promise.resolve([
        {
          id: 'commit_synth',
          userId: FOUNDING_USER,
          goalId: 'goal_run123',
          goalTitle: 'Build a running habit',
          text: 'Run 3x',
          due: null,
          status: 'open',
          createdAt: new Date('2026-09-24T00:00:00Z'),
        },
      ])
    })
    void origLimit

    const res = await POST(
      makeReq(
        { text: 'Run 3x', goal_id: 'goal_run123' },
        FOUNDING_USER,
      ),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.goal_id).toBe('goal_run123')
    expect(body.goal_title).toBe('Build a running habit')
  })
})
