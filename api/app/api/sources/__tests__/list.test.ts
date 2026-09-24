/**
 * GET /api/sources — integration tests.
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

const MOCK_ROWS = [
  {
    id: 'src_001',
    user_id: 'user_founder01',
    goal_id: 'goal_abc',
    goal_title: 'My Goal',
    kind: 'file',
    storage_path: 'goalcoach/uploads/user_founder01/doc.pdf',
    original_filename: 'doc.pdf',
    content_type: 'application/pdf',
    size: 2048,
    url: '',
    is_deleted: false,
    created_at: new Date('2026-01-01T00:00:00Z'),
  },
  {
    id: 'src_002',
    user_id: 'user_founder01',
    goal_id: 'goal_abc',
    goal_title: 'My Goal',
    kind: 'link',
    storage_path: '',
    original_filename: 'https://example.com/article',
    content_type: 'text/uri-list',
    size: 0,
    url: 'https://example.com/article',
    is_deleted: false,
    created_at: new Date('2026-01-02T00:00:00Z'),
  },
]

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(MOCK_ROWS)),
          })),
          limit: vi.fn(() => Promise.resolve(MOCK_ROWS)),
        })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(MOCK_ROWS)),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })) })),
  },
}))

import { GET } from '../route'
import { NextRequest } from 'next/server'

const { mockAuth, mockGuestToken } = mocks

const SESSION_TOKEN = 'test_session_founder01'

function makeGetRequest(url: string, token?: string) {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return new NextRequest(`http://localhost${url}`, { headers })
}

describe('GET /api/sources', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: 'user_founder01', isGuest: false, modelProvider: 'gemini' } })
    mockGuestToken.mockReturnValue(null)
  })
  afterEach(() => { vi.clearAllMocks() })

  it('rejects unauthenticated requests with 401', async () => {
    mockAuth.mockResolvedValueOnce({ user: null })
    const res = await GET(makeGetRequest('/api/sources'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with an array', async () => {
    const res = await GET(makeGetRequest('/api/sources', SESSION_TOKEN))
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it('maps camelCase DB columns to snake_case API shape', async () => {
    const res = await GET(makeGetRequest('/api/sources', SESSION_TOKEN))
    const data = await res.json()
    expect(data[0]).toHaveProperty('original_filename')
    expect(data[0]).toHaveProperty('content_type')
    expect(data[0]).toHaveProperty('storage_path')
    expect(data[0]).toHaveProperty('goal_id')
    expect(data[0]).toHaveProperty('is_deleted')
    expect(data[0]).toHaveProperty('created_at')
  })

  it('contains both file and link kinds', async () => {
    const res = await GET(makeGetRequest('/api/sources', SESSION_TOKEN))
    const kinds = (await res.json()).map((s: any) => s.kind)
    expect(kinds).toContain('file')
    expect(kinds).toContain('link')
  })
})