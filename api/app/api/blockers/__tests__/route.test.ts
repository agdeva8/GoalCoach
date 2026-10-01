/**
 * /api/blockers POST + GET.
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

const { POST, GET } = await import('../route')

const FOUNDING_USER = 'user_founder01'
const { mockAuth, chain, transaction, selectResultHolder } = mocks

function postReq(body: object, token?: string): NextRequest {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return new NextRequest('http://localhost/api/blockers', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function getReq(token?: string): NextRequest {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return new NextRequest('http://localhost/api/blockers', {
    method: 'GET',
    headers,
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

describe('POST /api/blockers', () => {
  beforeEach(resetMocks)
  afterEach(() => vi.restoreAllMocks())

  it('returns 401 without auth', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(
      postReq({ title: 'Travel', start_date: '2026-12-20' }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when title is missing', async () => {
    const res = await POST(
      postReq({ start_date: '2026-12-20' }, FOUNDING_USER),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when start_date is malformed', async () => {
    const res = await POST(
      postReq({ title: 'Travel', start_date: 'tomorrow' }, FOUNDING_USER),
    )
    expect(res.status).toBe(400)
  })

  it('creates a blocker with audit row in one transaction', async () => {
    selectResultHolder.current = [
      {
        id: 'block_synth',
        userId: FOUNDING_USER,
        title: "Sibling's wedding",
        startDate: '2026-12-20',
        endDate: '2026-12-23',
        note: 'Out of country',
        createdAt: new Date('2026-09-24T00:00:00Z'),
      },
    ]
    const res = await POST(
      postReq(
        {
          title: "Sibling's wedding",
          start_date: '2026-12-20',
          end_date: '2026-12-23',
          note: 'Out of country',
        },
        FOUNDING_USER,
      ),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('block_synth')
    expect(body.user_id).toBe(FOUNDING_USER)
    expect(body.title).toBe("Sibling's wedding")
    expect(body.start_date).toBe('2026-12-20')
    expect(body.end_date).toBe('2026-12-23')
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(chain.insert).toHaveBeenCalled()
  })
})

describe('GET /api/blockers', () => {
  beforeEach(resetMocks)
  afterEach(() => vi.restoreAllMocks())

  it('returns 401 without auth', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET(getReq())
    expect(res.status).toBe(401)
  })

  it('returns the user blockers', async () => {
    selectResultHolder.current = [
      {
        id: 'block_x',
        userId: FOUNDING_USER,
        title: 'Travel',
        startDate: '2026-12-20',
        endDate: '2026-12-23',
        note: 'Out of country',
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
    ]
    const res = await GET(getReq(FOUNDING_USER))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.blockers)).toBe(true)
    expect(body.blockers).toHaveLength(1)
    expect(body.blockers[0].id).toBe('block_x')
    expect(body.blockers[0].user_id).toBe(FOUNDING_USER)
    expect(body.blockers[0].start_date).toBe('2026-12-20')
  })
})
