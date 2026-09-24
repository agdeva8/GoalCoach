/**
 * Preferences tests — ported from backend_test.py TestPreferences
 * Tests: set valid provider, set invalid provider
 */
import { describe, it, expect } from 'vitest'
import { PUT } from '../route'
import { NextRequest } from 'next/server'

const SESSION_TOKEN = 'test_session_founder01'

function makePutRequest(body: object) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SESSION_TOKEN}`,
  })
  return new NextRequest('http://localhost/api/preferences', {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
}

describe('TestPreferences', () => {
  it('test_set_valid', async () => {
    for (const prov of ['anthropic', 'openai', 'gemini']) {
      const req = makePutRequest({ model_provider: prov })
      const res = await PUT(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.model_provider).toBe(prov)
    }
  })

  it('test_set_invalid', async () => {
    const req = makePutRequest({ model_provider: 'nope' })
    const res = await PUT(req)
    expect(res.status).toBe(400)
  })
})
