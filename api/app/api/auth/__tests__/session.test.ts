/**
 * Emergent OAuth `/api/auth/session` smoke test.
 *
 * Verifies:
 *   - 400 when `session_id` is missing
 *   - 200 with a user payload + a `session_token` cookie when the
 *     Emergent round-trip succeeds (mocked).
 *   - 401 when the Emergent proxy rejects the session_id.
 *
 * The Emergent REST client (`lib/emergent/auth.ts`) is mocked so the
 * test never hits the real OAuth host.
 */

import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockExchangeSessionId = vi.fn()
const mockUpsertUserFromSession = vi.fn()
const mockSetSessionCookie = vi.fn()

vi.mock('@/lib/emergent/auth', () => ({
  exchangeSessionId: mockExchangeSessionId,
  setSessionCookie: mockSetSessionCookie,
  clearSessionCookie: vi.fn(),
  SESSION_TOKEN_COOKIE: 'session_token',
  SESSION_TOKEN_TTL_SECONDS: 7 * 24 * 60 * 60,
}))

vi.mock('@/lib/auth', () => ({
  upsertUserFromSession: mockUpsertUserFromSession,
  getAuthenticatedUser: vi.fn(),
  signOut: vi.fn(),
  auth: vi.fn(),
  SESSION_TOKEN_COOKIE: 'session_token',
}))

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/session (Emergent OAuth)', () => {
  it('returns 400 when session_id is missing', async () => {
    const { POST } = await import('@/app/api/auth/session/route')
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.detail).toMatch(/session_id/i)
  })

  it('exchanges session_id, upserts user, sets cookie, returns user shape', async () => {
    mockExchangeSessionId.mockResolvedValueOnce({
      id: 'emg_user_abc',
      email: 'ada@example.com',
      name: 'Ada',
      picture: 'https://example.com/p.png',
      session_token: 'session_token_value',
    })
    mockUpsertUserFromSession.mockResolvedValueOnce({
      id: 'user_emg_ada',
      email: 'ada@example.com',
      name: 'Ada',
      image: 'https://example.com/p.png',
      modelProvider: 'gemini',
      isGuest: false,
    })

    const { POST } = await import('@/app/api/auth/session/route')
    const res = await POST(makeRequest({ session_id: 'abc123' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.user_id).toBe('user_emg_ada')
    expect(body.user.email).toBe('ada@example.com')
    expect(body.user.is_guest).toBe(false)
    expect(mockExchangeSessionId).toHaveBeenCalledWith('abc123')
    expect(mockUpsertUserFromSession).toHaveBeenCalled()
    expect(mockSetSessionCookie).toHaveBeenCalledWith('session_token_value')
  })

  it('returns 401 when Emergent rejects the session_id', async () => {
    const err = new Error('Emergent auth rejected session_id (HTTP 401)') as Error & {
      status?: number
    }
    err.status = 401
    mockExchangeSessionId.mockRejectedValueOnce(err)

    const { POST } = await import('@/app/api/auth/session/route')
    const res = await POST(makeRequest({ session_id: 'bad' }))
    expect(res.status).toBe(401)
  })
})