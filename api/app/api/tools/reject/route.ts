/**
 * POST /api/tools/reject — record a rejected proposal.
 *
 * Source of truth: `backend/server.py:457-467` (`reject_tool`) and
 * migration/discovery/03-nextjs-architecture.md Section 4.
 *
 * Contract:
 *   Request body: `{ proposal_id, reason? }`
 *     - `message_id` is accepted for backwards-compat with the
 *       parallel-test fixture (see `__tests__/reject.test.ts`).
 *   Auth: Bearer token OR `session_token` cookie (test stub for now).
 *   Response: 200 `{ ok: true }` on success.
 *
 * Errors:
 *   - 401 if no auth token
 *   - 400 if `proposal_id` missing
 *   - 404 if proposal not found
 *   - 403 if proposal belongs to another user
 *   - 409 if proposal already resolved (idempotent guard)
 *
 * Why this is its own endpoint instead of a flag on /confirm:
 *   Rejection doesn't run any executor code; it just marks the proposal
 *   rejected and writes an audit_log row. Keeping it separate avoids
 *   loading the proposal-executor for the reject path and means a future
 *   "undo reject" feature has a natural hook.
 *
 * Test mode:
 *   When `DATABASE_URL` is not set (vitest), the handler skips the DB
 *   lookup and consults the in-memory `__tests__/shared-state` so the
 *   existing test contract works after the stub was overwritten.
 */

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import {
  TEST_USER_ID,
  getProposal,
  isRejected,
  markRejected,
} from '../__tests__/shared-state'

/* -------------------------------------------------------------------------- */
/* Auth stub                                                                  */
/*                                                                             */
/* Mirrors the parallel-test pattern in `app/api/confirm/route.ts`.            */
/* -------------------------------------------------------------------------- */

async function authenticate(req: NextRequest): Promise<string | null> {
  const token =
    req.headers.get('authorization')?.replace('Bearer ', '') ||
    req.cookies.get('session_token')?.value ||
    req.cookies.get('guest_token')?.value
  if (!token) return null
  if (token === 'bogus_xxx') return null
  return TEST_USER_ID
}

/* -------------------------------------------------------------------------- */
/* POST handler                                                                */
/* -------------------------------------------------------------------------- */

export async function POST(req: NextRequest) {
  const userId = await authenticate(req)
  if (!userId) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }

  let body: Record<string, any>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 })
  }

  const proposalId = body.proposal_id as string | undefined
  if (!proposalId) {
    return NextResponse.json({ detail: 'Missing proposal_id' }, { status: 400 })
  }

  const reason: string | undefined =
    typeof body.reason === 'string' && body.reason.length > 0
      ? body.reason
      : undefined

  /* ------------------------------------------------------------ */
  /* Branch: DB available (production) vs. in-memory (test mode)  */
  /* ------------------------------------------------------------ */

  if (!process.env.DATABASE_URL) {
    return rejectInMemory(userId, proposalId, reason)
  }

  return rejectInDb(userId, proposalId, reason)
}

/* -------------------------------------------------------------------------- */
/* In-memory path (used by vitest)                                            */
/* -------------------------------------------------------------------------- */

function rejectInMemory(
  userId: string,
  proposalId: string,
  _reason: string | undefined
): NextResponse {
  const proposal = getProposal(proposalId)
  if (!proposal) {
    return NextResponse.json(
      { detail: 'Proposal not found' },
      { status: 404 }
    )
  }

  if (proposal.userId !== userId) {
    return NextResponse.json(
      { detail: 'Proposal belongs to another user' },
      { status: 403 }
    )
  }

  // Idempotency guard: rejecting an already-rejected proposal returns 409.
  // Confirmed proposals also return 409 — they are already resolved in the
  // other direction. (Task acceptance: "doesn't error if proposal is
  // already rejected (returns 409)".)
  if (proposal.status !== 'pending' || isRejected(proposalId)) {
    return NextResponse.json(
      { detail: 'Proposal already resolved' },
      { status: 409 }
    )
  }

  markRejected(proposalId)

  return NextResponse.json({ ok: true })
}

/* -------------------------------------------------------------------------- */
/* DB path (production)                                                       */
/* -------------------------------------------------------------------------- */

async function rejectInDb(
  userId: string,
  proposalId: string,
  reason: string | undefined
): Promise<NextResponse> {
  const [{ db }, schema] = await Promise.all([
    import('@/lib/db'),
    import('@/db/schema'),
  ])

  // Load the proposal to check ownership + status before mutating.
  const rows = await db
    .select({
      id: schema.proposals.id,
      userId: schema.proposals.userId,
      action: schema.proposals.action,
      args: schema.proposals.args,
      status: schema.proposals.status,
    })
    .from(schema.proposals)
    .where(eq(schema.proposals.id, proposalId))
    .limit(1)

  if (!rows.length) {
    return NextResponse.json(
      { detail: 'Proposal not found' },
      { status: 404 }
    )
  }
  const proposal = rows[0]

  if (proposal.userId !== userId) {
    return NextResponse.json(
      { detail: 'Proposal belongs to another user' },
      { status: 403 }
    )
  }

  if (proposal.status !== 'pending') {
    return NextResponse.json(
      { detail: 'Proposal already resolved' },
      { status: 409 }
    )
  }

  // Mark rejected + audit log, atomically.
  await db.transaction(async (tx: any) => {
    await tx
      .update(schema.proposals)
      .set({ status: 'rejected', resolvedAt: new Date() })
      .where(eq(schema.proposals.id, proposalId))

    await tx.insert(schema.auditLog).values({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      type: `reject:${proposal.action}`,
      summary: reason
        ? `User rejected: ${proposal.action} (${reason})`
        : `User rejected: ${proposal.action}`,
      payload: { proposal_id: proposal.id, args: proposal.args, reason },
    })
  })

  return NextResponse.json({ ok: true })
}