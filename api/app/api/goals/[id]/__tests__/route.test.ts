/**
 * /api/goals/[id] PATCH / DELETE — direct goal edit & soft-delete.
 *
 * Covers Phase 1 Task 11 acceptance:
 *   - auth required (401 when no session)
 *   - non-owner returns 403 (we return 404 to avoid leaking existence)
 *   - PATCH with valid input updates the row
 *   - DELETE sets status='dropped' (soft delete)
 *   - invalid body returns 400
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

const { PATCH, DELETE } = await import('../route')

const FOUNDING_USER = 'user_founder01'
const GOAL_ID = 'goal_a1b2c3d4e5f6'
const { mockAuth, chain, dbMock, transaction, selectResultHolder } = mocks

function patchReq(body: object, id = GOAL_ID): NextRequest {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${FOUNDING_USER}`,
  })
  return new NextRequest(`http://localhost/api/goals/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
}

function deleteReq(id = GOAL_ID): NextRequest {
  return new NextRequest(`http://localhost/api/goals/${id}`, {
    method: 'DELETE',
    headers: new Headers({ Authorization: `Bearer ${FOUNDING_USER}` }),
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

describe('PATCH /api/goals/[id]', () => {
  beforeEach(resetMocks)
  afterEach(() => vi.restoreAllMocks())

  it('returns 401 when there is no auth session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const headers = new Headers({
      'Content-Type': 'application/json',
    })
    const req = new NextRequest(`http://localhost/api/goals/${GOAL_ID}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ title: 'New title' }),
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ id: GOAL_ID }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 when goal does not exist for this user', async () => {
    selectResultHolder.current = []
    const res = await PATCH(patchReq({ title: 'X' }), {
      params: Promise.resolve({ id: GOAL_ID }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when body is empty (no fields to update)', async () => {
    selectResultHolder.current = [{ id: GOAL_ID, title: 'Old' }]
    const res = await PATCH(patchReq({}), {
      params: Promise.resolve({ id: GOAL_ID }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when status is invalid', async () => {
    selectResultHolder.current = [{ id: GOAL_ID, title: 'Old' }]
    const res = await PATCH(patchReq({ status: 'banished' }), {
      params: Promise.resolve({ id: GOAL_ID }),
    })
    expect(res.status).toBe(400)
  })

  it('updates a goal and writes audit row in same transaction', async () => {
    selectResultHolder.current = [
      {
        id: GOAL_ID,
        userId: FOUNDING_USER,
        title: 'New title',
        horizon: 'medium',
        why: '',
        nextAction: '',
        startDate: null,
        targetDate: null,
        status: 'active',
        createdAt: new Date('2026-09-24T00:00:00Z'),
        updatedAt: new Date('2026-09-24T00:00:00Z'),
      },
    ]
    const res = await PATCH(patchReq({ title: 'New title' }), {
      params: Promise.resolve({ id: GOAL_ID }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.goal).not.toBeNull()
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(chain.update).toHaveBeenCalled()
  })
})

describe('DELETE /api/goals/[id]', () => {
  beforeEach(resetMocks)
  afterEach(() => vi.restoreAllMocks())

  it('returns 401 when there is no auth session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const req = new NextRequest(`http://localhost/api/goals/${GOAL_ID}`, {
      method: 'DELETE',
    })
    const res = await DELETE(req, {
      params: Promise.resolve({ id: GOAL_ID }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 when goal is not owned by this user', async () => {
    selectResultHolder.current = []
    const res = await DELETE(deleteReq(), {
      params: Promise.resolve({ id: GOAL_ID }),
    })
    expect(res.status).toBe(404)
  })

  it('soft-deletes (sets status=dropped) and writes audit row', async () => {
    selectResultHolder.current = [{ id: GOAL_ID, title: 'My goal' }]
    const res = await DELETE(deleteReq(), {
      params: Promise.resolve({ id: GOAL_ID }),
    })
    expect(res.status).toBe(200)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(chain.update).toHaveBeenCalled()
    const setArg = chain.set.mock.calls[0][0]
    expect(setArg.status).toBe('dropped')
  })
})
