/**
 * /api/milestones/[id] PATCH / DELETE.
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
const MILE_ID = 'mile_a1b2c3d4e5f6'
const { mockAuth, chain, transaction, selectResultHolder } = mocks

function patchReq(body: object): NextRequest {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${FOUNDING_USER}`,
  })
  return new NextRequest(`http://localhost/api/milestones/${MILE_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
}

function deleteReq(): NextRequest {
  return new NextRequest(`http://localhost/api/milestones/${MILE_ID}`, {
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

describe('PATCH /api/milestones/[id]', () => {
  beforeEach(resetMocks)
  afterEach(() => vi.restoreAllMocks())

  it('returns 401 without auth', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const headers = new Headers({ 'Content-Type': 'application/json' })
    const req = new NextRequest(`http://localhost/api/milestones/${MILE_ID}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ title: 'New' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: MILE_ID }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when not owned', async () => {
    selectResultHolder.current = []
    const res = await PATCH(patchReq({ title: 'New' }), {
      params: Promise.resolve({ id: MILE_ID }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 on empty body', async () => {
    selectResultHolder.current = [{ id: MILE_ID, title: 'Old' }]
    const res = await PATCH(patchReq({}), {
      params: Promise.resolve({ id: MILE_ID }),
    })
    expect(res.status).toBe(400)
  })

  it('updates a milestone + writes audit', async () => {
    selectResultHolder.current = [{ id: MILE_ID, title: 'Old' }]
    const res = await PATCH(patchReq({ title: 'New' }), {
      params: Promise.resolve({ id: MILE_ID }),
    })
    expect(res.status).toBe(200)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(chain.update).toHaveBeenCalled()
  })
})

describe('DELETE /api/milestones/[id]', () => {
  beforeEach(resetMocks)
  afterEach(() => vi.restoreAllMocks())

  it('returns 401 without auth', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const req = new NextRequest(`http://localhost/api/milestones/${MILE_ID}`, {
      method: 'DELETE',
    })
    const res = await DELETE(req, { params: Promise.resolve({ id: MILE_ID }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when not owned', async () => {
    selectResultHolder.current = []
    const res = await DELETE(deleteReq(), {
      params: Promise.resolve({ id: MILE_ID }),
    })
    expect(res.status).toBe(404)
  })

  it('deletes milestone + writes audit', async () => {
    selectResultHolder.current = [{ id: MILE_ID, title: 'Old' }]
    const res = await DELETE(deleteReq(), {
      params: Promise.resolve({ id: MILE_ID }),
    })
    expect(res.status).toBe(200)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(chain.delete).toHaveBeenCalled()
  })
})
