/**
 * Tool reject tests — ported from backend_test.py TestChatFlow sub-cases
 */
import { describe, it, expect } from 'vitest'
import { POST } from '../reject/route'
import { NextRequest } from 'next/server'

const SESSION_TOKEN = 'test_session_founder01'

function makePostRequest(path: string, body: object, token?: string) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('TestToolReject', () => {
  it('reject_pending_proposal_returns_ok', async () => {
    const req = makePostRequest('/api/tools/reject', {
      message_id: 'msg_001',
      proposal_id: 'prop_002',
    }, SESSION_TOKEN)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('reject_missing_fields_is_400', async () => {
    const req = makePostRequest('/api/tools/reject', {}, SESSION_TOKEN)
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
