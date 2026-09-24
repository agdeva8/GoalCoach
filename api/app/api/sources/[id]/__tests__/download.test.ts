/**
 * GET /api/sources/[id]/download — integration tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGuestToken: vi.fn(),
  mockGetSignedDownloadUrl: vi.fn(),
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
vi.mock('@/lib/storage', () => ({ getSignedDownloadUrl: mocks.mockGetSignedDownloadUrl }))

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
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) }),
  },
}))

import { GET } from '../download/route'
import { NextRequest } from 'next/server'

const { mockAuth, mockGuestToken, mockGetSignedDownloadUrl } = mocks

const SESSION_TOKEN = 'test_session_founder01'

function makeDownloadRequest(id: string, token?: string) {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return new NextRequest(`http://localhost/api/sources/${id}/download`, { headers })
}

const FILE_ROW = [{
  id: 'src_file', kind: 'file',
  storagePath: 'goalcoach/uploads/user_founder01/doc.pdf',
  url: '', contentType: 'application/pdf', originalFilename: 'doc.pdf',
}]

const LINK_ROW = [{
  id: 'src_link', kind: 'link',
  storagePath: '', url: 'https://example.com/article',
  contentType: 'text/uri-list', originalFilename: 'Example Article',
}]

describe('GET /api/sources/[id]/download', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: 'user_founder01', isGuest: false, modelProvider: 'gemini' } })
    mockGuestToken.mockReturnValue(null)
    mockGetSignedDownloadUrl.mockResolvedValue('https://integrations.emergentagent.com/objstore/api/v1/storage/objects/doc.pdf')
  })
  afterEach(() => { vi.clearAllMocks() })

  it('rejects unauthenticated requests with 401', async () => {
    mockAuth.mockResolvedValueOnce({ user: null })
    const res = await GET(makeDownloadRequest('src_abc123'), { params: Promise.resolve({ id: 'src_abc123' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent source', async () => {
    // Default mock returns [].
    const res = await GET(makeDownloadRequest('src_notfound', SESSION_TOKEN), { params: Promise.resolve({ id: 'src_notfound' }) })
    expect(res.status).toBe(404)
  })

  it('returns signed URL + metadata for a file source', async () => {
    const { db } = await import('@/lib/db')
    ;(db as any).select = vi.fn(() => makeSelectChain(FILE_ROW))

    const res = await GET(makeDownloadRequest('src_file', SESSION_TOKEN), { params: Promise.resolve({ id: 'src_file' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://integrations.emergentagent.com/objstore/api/v1/storage/objects/doc.pdf')
    expect(body.content_type).toBe('application/pdf')
    expect(body.filename).toBe('doc.pdf')
    expect(mockGetSignedDownloadUrl).toHaveBeenCalledWith('goalcoach/uploads/user_founder01/doc.pdf')
  })

  it('returns { url } for a link source without calling storage', async () => {
    const { db } = await import('@/lib/db')
    ;(db as any).select = vi.fn(() => makeSelectChain(LINK_ROW))

    const res = await GET(makeDownloadRequest('src_link', SESSION_TOKEN), { params: Promise.resolve({ id: 'src_link' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://example.com/article')
    expect(mockGetSignedDownloadUrl).not.toHaveBeenCalled()
  })
})