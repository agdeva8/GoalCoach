/**
 * Chat SSE tests — ported from backend_test.py TestChatFlow
 * Tests: multi-goal stream, delta events, tool proposals, history
 */
import { describe, it, expect, vi } from 'vitest'

// Stub env BEFORE importing the chat route (which transitively imports
// the env validator via `@/lib/auth` → `@/lib/env`).
vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-test-secret-32+chars',
    EMERGENT_LLM_KEY: 'sk-emergent-test',
    INTEGRATION_PROXY_URL: 'https://integrations.emergentagent.com',
  },
}))

// The audit + audit/export routes import `@/lib/auth` (top-level) and
// call `cookies()` from `next/headers`. In the vitest environment
// `cookies()` throws "called outside a request scope" unless we mock
// the auth module to short-circuit. The audit endpoints only check the
// session — they don't need the DB to return realistic rows for these
// smoke tests; we only assert on shape.
vi.mock('@/lib/auth', () => ({
  auth: () =>
    Promise.resolve({
      user: {
        id: 'user_founder01',
        isGuest: false,
        modelProvider: 'gemini',
        email: 'test@example.com',
        name: 'Test User',
      },
    }),
  getAuthenticatedUser: () =>
    Promise.resolve({
      user: {
        id: 'user_founder01',
        isGuest: false,
        modelProvider: 'gemini',
        email: 'test@example.com',
        name: 'Test User',
      },
      source: 'session',
    }),
}))

vi.mock('@/lib/db', () => {
  const auditRow = {
    id: 'audit_1',
    userId: 'user_founder01',
    type: 'confirm:create_goal',
    summary: 'Created goal',
    payload: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }
  const buildChain = (rows: unknown[]) => {
    const chain: any = {}
    chain.from = vi.fn(() => chain)
    chain.where = vi.fn(() => chain)
    // `.orderBy()` is the terminal for queries like `db.select().from().where().orderBy()`
    // (audit/export). When the route ALSO chains `.limit()` after `.orderBy()`
    // (audit), attach a `.limit` method to the resolved promise so both
    // shapes work without two different mocks.
    chain.orderBy = vi.fn(() => {
      const p = Promise.resolve(rows) as any
      p.limit = vi.fn(() => Promise.resolve(rows))
      return p
    })
    chain.limit = vi.fn(() => Promise.resolve(rows))
    return chain
  }
  return {
    db: {
      select: vi.fn(() => buildChain([auditRow])),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([auditRow])) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })) })),
      delete: vi.fn(),
      transaction: vi.fn(),
    },
  }
})

import { POST as chatPost } from '../stream/route'
import { GET as historyGet } from '../../chat/history/route'
import { POST as confirmPost } from '../../tools/confirm/route'
import { POST as rejectPost } from '../../tools/reject/route'
import { GET as auditGet } from '../../audit/route'
import { GET as exportGet } from '../../audit/export/route'
import { NextRequest } from 'next/server'

const SESSION_TOKEN = 'test_session_founder01'

function chatReq(body: object) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SESSION_TOKEN}`,
  })
  return new NextRequest('http://localhost/api/chat/stream', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function authedGet(url: string) {
  return new NextRequest(`http://localhost${url}`, {
    headers: new Headers({ Authorization: `Bearer ${SESSION_TOKEN}` }),
  })
}

function confirmReq(body: object) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SESSION_TOKEN}`,
  })
  return new NextRequest('http://localhost/api/tools/confirm', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function rejectReq(body: object) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SESSION_TOKEN}`,
  })
  return new NextRequest('http://localhost/api/tools/reject', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function parseSSE(text: string) {
  const events: any[] = []
  const lines = text.split('\n')
  let buf = ''
  for (const line of lines) {
    if (line === '') {
      if (buf.startsWith('data: ')) {
        try { events.push(JSON.parse(buf.slice(6))) } catch {}
      }
      buf = ''
    } else {
      buf += line + '\n'
    }
  }
  return events
}

describe('TestChatFlow', () => {
  let messageId: string | null = null
  let proposals: any[] = []

  it('test_chat_stream_multi_goal', async () => {
    const prompt =
      'I want to start three things: get a running habit going this quarter, ship a side-project MVP in 2 months, and read 12 books this year. Where do I start?'

    const res = await chatPost(chatReq({ message: prompt }))
    expect(res.status).toBe(200)

    const text = await res.text()
    const events = parseSSE(text)
    expect(events.length).toBeGreaterThan(0)

    const types = events.map((e) => e.type)
    expect(types).toContain('done')

    const deltas = events.filter((e) => e.type === 'delta')
    expect(deltas.length).toBeGreaterThanOrEqual(1)

    const toolsEv = events.find((e) => e.type === 'tools')
    expect(toolsEv).toBeDefined()
    expect(toolsEv?.proposals).toBeDefined()
    expect(toolsEv?.proposals.length).toBeGreaterThan(0)

    messageId = toolsEv?.message_id ?? null
    proposals = toolsEv?.proposals ?? []
  })

  it('test_confirm_first_proposal_persists_goal', async () => {
    const createGoalProp = proposals.find((p) => p.action === 'create_goal')
    expect(createGoalProp).toBeDefined()

    const res = await confirmPost(confirmReq({
      message_id: messageId,
      proposal_id: createGoalProp.id,
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('state')
    const titles = body.state.goals.map((g: any) => g.title)
    expect(titles).toContain(createGoalProp.args.title)
  })

  it('test_reject_second_proposal', async () => {
    const remaining = proposals.filter(
      (p) => p.action === 'create_goal' && p.args?.title !== 'Build a running habit this quarter',
    )
    if (remaining.length === 0) return

    const prop = remaining[0]
    const res = await rejectPost(rejectReq({ message_id: messageId, proposal_id: prop.id }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('test_double_confirm_conflict', async () => {
    const createGoalProp = proposals.find((p) => p.action === 'create_goal')
    if (!createGoalProp) return

    const res = await confirmPost(confirmReq({
      message_id: messageId,
      proposal_id: createGoalProp.id,
    }))
    expect(res.status).toBe(409)
  })

  it('test_history_persisted', async () => {
    const res = await historyGet(authedGet('/api/chat/history'))
    expect(res.status).toBe(200)
    const msgs = await res.json()
    expect(msgs.length).toBeGreaterThanOrEqual(2)
    const roles = msgs.map((m: any) => m.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
  })

  it('test_audit_logged', async () => {
    const res = await auditGet(authedGet('/api/audit'))
    expect(res.status).toBe(200)
    const events = await res.json()
    const types = events.map((e: any) => e.type)
    expect(types.some((t: string) => t.startsWith('confirm:'))).toBe(true)
  })

  it('test_audit_export', async () => {
    const res = await exportGet(authedGet('/api/audit/export'))
    expect(res.status).toBe(200)
    const d = await res.json()
    expect(d).toHaveProperty('state')
    expect(d).toHaveProperty('conversation')
    expect(d).toHaveProperty('audit_log')
  })
})
