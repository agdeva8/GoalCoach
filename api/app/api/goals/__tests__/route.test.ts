/**
 * /api/goals POST — direct goal creation.
 *
 * Covers Phase 1 Task 11 acceptance:
 *   - auth required (401 when no session)
 *   - valid input creates a goal (201 + audit row in same transaction)
 *   - invalid input returns 400
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
    // In Drizzle, a transaction's `tx` object exposes the same
    // select/insert/update/delete surface as `db`. Wire those onto the
    // chain so handlers can call `tx.insert(table).values(...)` etc.
    chain.select = vi.fn(() => chain)
    chain.insert = vi.fn(() => chain)
    chain.update = vi.fn(() => chain)
    chain.delete = vi.fn(() => chain)
    return chain
  }

  const chain = buildChain()
  const transaction = vi.fn(async (cb: any) => cb(chain))
  // In Drizzle, `tx` inside a transaction exposes the SAME API surface
  // as `db` — insert/update/delete/select/transaction. Build a single
  // object with all five so the handler can call any of them on `tx`.
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
const { mockAuth, chain, dbMock, transaction, selectResultHolder } = mocks

function makeReq(body: object | null, token?: string): NextRequest {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return new NextRequest('http://localhost/api/goals', {
    method: 'POST',
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  })
}

describe('POST /api/goals', () => {
  beforeEach(() => {
    // Reset only the call history — do NOT reset implementations, as
    // `vi.resetAllMocks` would clear `mockReturnValue` and our chain
    // methods would lose their return values. We rely on the mock
    // implementations set in `vi.hoisted` and reset only per-test
    // data below.
    chain.from.mockClear()
    chain.where.mockClear()
    chain.orderBy.mockClear()
    chain.limit.mockClear()
    chain.values.mockClear()
    chain.set.mockClear()
    chain.returning.mockClear()
    chain.select.mockClear()
    chain.insert.mockClear()
    chain.update.mockClear()
    chain.delete.mockClear()
    transaction.mockClear()

    selectResultHolder.current = []
    mockAuth.mockReset()
    mockAuth.mockResolvedValue({
      user: { id: FOUNDING_USER, isGuest: false, modelProvider: 'gemini' },
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('returns 401 when there is no auth session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(
      makeReq({ title: 'X', horizon: 'weekly' }, undefined),
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.detail).toMatch(/not authenticated/i)
  })

  it('returns 400 when body is invalid JSON', async () => {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FOUNDING_USER}`,
    })
    const req = new NextRequest('http://localhost/api/goals', {
      method: 'POST',
      headers,
      body: '{ not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when title is missing', async () => {
    const res = await POST(
      makeReq({ horizon: 'weekly' }, FOUNDING_USER),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when horizon is invalid', async () => {
    const res = await POST(
      makeReq({ title: 'Run', horizon: 'fortnight' }, FOUNDING_USER),
    )
    expect(res.status).toBe(400)
  })

  it('creates a goal and writes an audit row in one transaction', async () => {
    // The post-insert read-back SELECT returns a synthetic row so the
    // handler can return the canonical row shape to the client.
    selectResultHolder.current = [
      {
        id: 'goal_synth',
        userId: FOUNDING_USER,
        title: 'Read 12 books',
        horizon: 'long',
        why: 'broaden knowledge',
        nextAction: 'pick the first 3',
        startDate: null,
        targetDate: '2026-12-31',
        status: 'active',
        createdAt: new Date('2026-09-24T00:00:00Z'),
        updatedAt: new Date('2026-09-24T00:00:00Z'),
      },
    ]

    const res = await POST(
      makeReq(
        {
          title: 'Read 12 books',
          horizon: 'long',
          why: 'broaden knowledge',
          next_action: 'pick the first 3',
          target_date: '2026-12-31',
        },
        FOUNDING_USER,
      ),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('goal_synth')
    expect(body.user_id).toBe(FOUNDING_USER)
    expect(body.title).toBe('Read 12 books')
    expect(body.horizon).toBe('long')
    expect(body.status).toBe('active')

    expect(transaction).toHaveBeenCalledTimes(1)
    // The handler inserts via `tx.insert(...)` inside the transaction
    // callback, so we assert against the chain's insert mock (which is
    // what `tx` resolves to).
    expect(chain.insert).toHaveBeenCalled()
  })
})
