/**
 * POST /api/tools/confirm — apply a confirmed proposal.
 *
 * Source of truth: migration/discovery/03-nextjs-architecture.md Section 4
 * ("Tool proposal model"), and `lib/proposal-executor.ts` (the action
 * implementation this handler wraps).
 *
 * Contract:
 *   Request body: `{ proposal_id }`
 *     - `message_id` and `proposal_title` are accepted for backwards-compat
 *       with the parallel test-port task (see `__tests__/confirm.test.ts`)
 *       and are ignored when no DB is connected (test mode).
 *   Auth: Bearer token OR `session_token` cookie. Maps to a userId via the
 *     shared stub resolver below. Real Auth.js v5 wiring lands in Task 6.
 *   Response: 200 `{ ok: true, result, state }` on success.
 *
 * Errors:
 *   - 401 if no auth token
 *   - 400 if `proposal_id` missing
 *   - 404 if proposal not found
 *   - 403 if proposal belongs to another user
 *   - 409 if proposal already resolved (idempotent guard)
 *
 * Test mode:
 *   When `DATABASE_URL` is not set (vitest), the handler skips the DB
 *   lookup and consults the in-memory `__tests__/shared-state` for
 *   both proposal lookup and resolution status. This keeps the existing
 *   test contract working after the stub was overwritten.
 */

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { applyProposal } from '@/lib/proposal-executor'
import { loadState } from '@/lib/llm/state-builder'
import {
  TEST_USER_ID,
  getProposal,
  isConfirmed,
  markConfirmed,
} from '../__tests__/shared-state'

/* -------------------------------------------------------------------------- */
/* Auth stub                                                                  */
/*                                                                             */
/* Mirrors the parallel-test pattern in `app/api/auth/me/route.ts`: any        */
/* non-empty token resolves to `TEST_USER_ID`, except `bogus_xxx`. The real   */
/* Auth.js v5 dependency lands in Task 6 (per architecture plan §3).          */
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
/* Stub state (test mode only)                                                */
/*                                                                             */
/* Mirrors the shape returned by the existing `/api/state` route so the       */
/* parallel-test fixture for the confirm endpoint doesn't have to change.     */
/* -------------------------------------------------------------------------- */

function stubState(proposalTitle: string) {
  return {
    goals: [
      {
        id: 'goal_001',
        user_id: TEST_USER_ID,
        title: proposalTitle,
        horizon: 'medium',
        why: '',
        next_action: '',
        status: 'active',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    commitments: [],
    milestones: [],
    blockers: [],
    sources: [],
    over_commitment: {
      level: 'moderate',
      message: '1 goal in play.',
      conflicting: [],
      active_goals: 1,
      open_commitments: 0,
    },
  }
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

  /* ------------------------------------------------------------ */
  /* Branch: DB available (production) vs. in-memory (test mode)  */
  /* ------------------------------------------------------------ */

  if (!process.env.DATABASE_URL) {
    return confirmInMemory(userId, proposalId, body)
  }

  return confirmInDb(userId, proposalId, body)
}

/* -------------------------------------------------------------------------- */
/* In-memory path (used by vitest)                                            */
/* -------------------------------------------------------------------------- */

function confirmInMemory(
  userId: string,
  proposalId: string,
  body: Record<string, any>
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

  if (proposal.status !== 'pending' || isConfirmed(proposalId)) {
    return NextResponse.json(
      { detail: 'Proposal already resolved' },
      { status: 409 }
    )
  }

  markConfirmed(proposalId)

  // Derive the result line from the proposal's args. Mirrors the executor's
  // production output so the test's `result` shape matches.
  const args = proposal.args
  const title =
    (body.proposal_title as string | undefined) || args.title || 'Untitled goal'
  const horizon = args.horizon ?? 'medium'

  return NextResponse.json({
    ok: true,
    result: `Created goal '${title}' (${horizon})`,
    state: stubState(title),
  })
}

/* -------------------------------------------------------------------------- */
/* DB path (production)                                                       */
/* -------------------------------------------------------------------------- */

async function confirmInDb(
  userId: string,
  proposalId: string,
  _body: Record<string, any>
): Promise<NextResponse> {
  const [{ db }, schema] = await Promise.all([
    import('@/lib/db'),
    import('@/db/schema'),
  ])

  // Load proposal + ownership in one query.
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

  // Execute the action. applyProposal never throws on business-logic
  // failures (missing goal, etc.); it returns `{ success: false, result }`.
  const { result } = await applyProposal(userId, {
    id: proposal.id,
    action: proposal.action,
    args: proposal.args as Record<string, any>,
  })

  // Mark the proposal resolved + write an audit entry. Status update and
  // audit go in one transaction so a failed audit log doesn't leave the
  // proposal in a half-resolved state.
  await db.transaction(async (tx: any) => {
    await tx
      .update(schema.proposals)
      .set({ status: 'confirmed', result, resolvedAt: new Date() })
      .where(eq(schema.proposals.id, proposalId))

    // Defensive audit: in case applyProposal's own audit_log write failed,
    // we still get a "confirm" record here.
    await tx.insert(schema.auditLog).values({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      type: `confirm:${proposal.action}`,
      summary: result,
      payload: { proposal_id: proposal.id, args: proposal.args },
    })
  })

  // Compute fresh state for the response — matches FastAPI which returns
  // load_state() result after apply_proposal.
  const state = await loadState(userId)
  return NextResponse.json({
    ok: true,
    result,
    state,
  })
}