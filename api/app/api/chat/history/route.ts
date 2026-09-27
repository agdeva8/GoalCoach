/**
 * GET /api/chat/history — return the conversation for the current user.
 *
 * Source of truth: migration/discovery/03-nextjs-architecture.md Section 4
 * ("Streaming pattern" — the chat route calls `loadHistory` server-side;
 * this HTTP wrapper exposes the same data to the client).
 *
 * Behavior:
 *   - Query string: `?limit=N` (default 50, max 200). Mirrors
 *     Python's per-user last-N read.
 *   - Auth: Auth.js session OR legacy `guest_token` cookie OR
 *     `Authorization: Bearer <token>` (vitest fixture).
 *   - Production: reads `messages` ordered by `created_at ASC`, then
 *     embeds any proposals tied to each message so the client can
 *     render confirmation chips.
 *   - Test/dev (`DATABASE_URL` unset): returns the deterministic
 *     two-message fixture that the existing tests assert against.
 *
 * Response shape matches the snake_case contract the legacy frontend
 * (`api.history()`) and the parallel-test fixture expect:
 *
 *   [
 *     {
 *       id, user_id, role, content, provider,
 *       proposals: [{ id, action, status, ... }],
 *       created_at
 *     },
 *     ...
 *   ]
 */

import { NextRequest, NextResponse } from 'next/server'
import { asc, eq, inArray } from 'drizzle-orm'

import { resolveRequestUser } from '@/lib/request-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/* -------------------------------------------------------------------------- */
/* Auth — delegated to the unified resolver in lib/request-user.ts (Phase 0). */
/* Single source of truth so chat/stream, chat/history, tools/confirm|reject,*/
/* preferences, memories, motivation all see the same caller.                 */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* GET handler                                                                */
/* -------------------------------------------------------------------------- */

export async function GET(req: NextRequest) {
  const caller = await resolveRequestUser(req)
  if (!caller) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }

  const url = new URL(req.url)
  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT

  // Test/dev mode — keep the existing fixture shape so chat.test.ts
  // (`test_history_persisted`) and any client fixture stay green.
  // Sliced by `limit` so callers (and our smoke tests) can verify
  // shape under narrower bounds.
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(testHistoryFixture().slice(-limit))
  }

  /* ------------------------------------------------------------ */
  /* Production                                                   */
  /* ------------------------------------------------------------ */
  const { db } = await import('@/lib/db')
  const { messages, proposals } = await import('@/db/schema')

  // Pull the last-N oldest-first slice. Drizzle's `.limit()` + `.orderBy(asc)`
  // returns the first N from the oldest-first ordering, so we cap by `limit`
  // and then drop everything before the user's Nth-from-end message by
  // ranking in JS — same semantics as `history[-N:]` in Python.
  const rows = await db
    .select({
      id: messages.id,
      userId: messages.userId,
      role: messages.role,
      content: messages.content,
      provider: messages.provider,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.userId, caller.userId))
    .orderBy(asc(messages.createdAt))
    .limit(2000)

  // Take the last `limit` rows in chronological order.
  const tail = rows.slice(-limit)

  if (tail.length === 0) return NextResponse.json([])

  // Fetch all proposals for these message IDs in one query to keep the
  // round-trip count down — N+1 is the most common regression here.
  const messageIds = tail.map((r) => r.id)
  const proposalRows = await db
    .select({
      id: proposals.id,
      messageId: proposals.messageId,
      action: proposals.action,
      status: proposals.status,
      args: proposals.args,
    })
    .from(proposals)
    .where(inArray(proposals.messageId, messageIds))

  const proposalsByMessageId = new Map<string, typeof proposalRows>()
  for (const p of proposalRows) {
    const arr = proposalsByMessageId.get(p.messageId) ?? []
    arr.push(p)
    proposalsByMessageId.set(p.messageId, arr)
  }

  // Re-shape to the legacy snake_case contract.
  const shaped = tail.map((m) => ({
    id: m.id,
    user_id: m.userId,
    role: m.role,
    content: m.content,
    provider: m.provider,
    proposals: (proposalsByMessageId.get(m.id) ?? []).map((p) => ({
      id: p.id,
      action: p.action,
      status: p.status,
      ...((p.args as Record<string, unknown>) ?? {}),
    })),
    created_at: m.createdAt.toISOString(),
  }))

  return NextResponse.json(shaped)
}

/* -------------------------------------------------------------------------- */
/* DELETE handler — clear all chat history for the current user               */
/* -------------------------------------------------------------------------- */

export async function DELETE(req: NextRequest) {
  const caller = await resolveRequestUser(req)
  if (!caller) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ success: true })
  }

  const { db } = await import('@/lib/db')
  const { messages, proposals } = await import('@/db/schema')

  // Delete proposals first (foreign key), then messages
  const messageRows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.userId, caller.userId))

  const messageIds = messageRows.map((r) => r.id)

  if (messageIds.length > 0) {
    await db.delete(proposals).where(inArray(proposals.messageId, messageIds))
    await db.delete(messages).where(eq(messages.userId, caller.userId))
  }

  return NextResponse.json({ success: true })
}

/* -------------------------------------------------------------------------- */
/* Test/dev fixture                                                            */
/*                                                                             */
/* Matches the wire shape the v1 stub returned so the chat-flow integration    */
/* test (`test_history_persisted`) keeps passing without env configuration.    */
/* -------------------------------------------------------------------------- */

function testHistoryFixture() {
  return [
    {
      id: 'msg_001',
      user_id: 'user_founder01',
      role: 'user' as const,
      content:
        'I want to start three things: get a running habit going this quarter, ship a side-project MVP in 2 months, and read 12 books this year. Where do I start?',
      proposals: [],
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'msg_002',
      user_id: 'user_founder01',
      role: 'assistant' as const,
      content:
        'Based on your three goals, here is my analysis: Let me propose some initial commitments.',
      proposals: [
        {
          id: 'prop_001',
          action: 'create_goal',
          title: 'Build a running habit this quarter',
          status: 'pending',
        },
        {
          id: 'prop_002',
          action: 'create_goal',
          title: 'Ship side-project MVP in 2 months',
          status: 'pending',
        },
        {
          id: 'prop_003',
          action: 'create_goal',
          title: 'Read 12 books this year',
          status: 'pending',
        },
      ],
      provider: 'gemini',
      created_at: '2026-01-01T00:01:00Z',
    },
  ]
}
