/**
 * Tool confirm tests — ported from backend_test.py TestChatFlow sub-cases
 */
import { describe, it, expect } from 'vitest'
import { POST } from '../confirm/route'
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

describe('TestToolConfirm', () => {
  it('confirm_pending_proposal_returns_state', async () => {
    const req = makePostRequest('/api/tools/confirm', {
      message_id: 'msg_001',
      proposal_id: 'prop_001',
      proposal_title: 'Build a running habit this quarter',
    }, SESSION_TOKEN)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('result')
    expect(body).toHaveProperty('state')
  })

  it('confirm_already_resolved_is_409', async () => {
    const req = makePostRequest('/api/tools/confirm', {
      message_id: 'msg_001',
      proposal_id: 'prop_already_confirmed',
    }, SESSION_TOKEN)
    const res = await POST(req)
    expect(res.status).toBe(409)
  })
})
