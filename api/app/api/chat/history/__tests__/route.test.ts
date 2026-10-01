/**
 * Smoke tests for GET /api/chat/history.
 *
 * Source of truth: migration/discovery/03-nextjs-architecture.md Section 4
 * ("Streaming pattern" / the chat route's `loadHistory` call).
 *
 * What we cover:
 *   1. Unauthenticated requests are 401 (no token).
 *   2. Bearer-authenticated requests return an array with both user and
 *      assistant role messages — i.e. the test-mode fixture is wired.
 *   3. The `?limit=N` query string narrows the response.
 *
 * Note: this test relies on the existing test-mode fixture in
 * `app/api/chat/history/route.ts` (`DATABASE_URL` is unset under
 * vitest, so the route returns a hard-coded two-message fixture).
 * That's the same path the existing chat-flow integration suite walks
 * via `test_history_persisted`.
 */

import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'

import { GET as historyGet } from '../route'

const SESSION_TOKEN = 'test_session_founder01'

function makeGet(path: string, token?: string, params?: Record<string, string>) {
  const url = new URL(`http://localhost${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return new NextRequest(url.toString(), { method: 'GET', headers })
}

describe('ChatHistory', () => {
  it('returns 401 when no auth is provided', async () => {
    const res = await historyGet(makeGet('/api/chat/history'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toHaveProperty('detail')
  })

  it('returns an array of messages including user + assistant roles', async () => {
    const res = await historyGet(makeGet('/api/chat/history', SESSION_TOKEN))
    expect(res.status).toBe(200)
    const msgs = await res.json()
    expect(Array.isArray(msgs)).toBe(true)
    expect(msgs.length).toBeGreaterThanOrEqual(2)

    const roles = msgs.map((m: { role: string }) => m.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
  })

  it('respects the ?limit query parameter', async () => {
    const res = await historyGet(
      makeGet('/api/chat/history', SESSION_TOKEN, { limit: '1' }),
    )
    expect(res.status).toBe(200)
    const msgs = await res.json()
    // Even with limit=1, the response should be a non-empty array.
    expect(Array.isArray(msgs)).toBe(true)
    expect(msgs.length).toBeLessThanOrEqual(1)
  })
})
