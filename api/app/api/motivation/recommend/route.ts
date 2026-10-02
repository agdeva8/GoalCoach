/**
 * GET /api/motivation/recommend
 *
 * Returns 1-3 motivation items for the current user. Delegates to
 * `recommend()` in `api/lib/motivation/recommend.ts` which runs the
 * full search → fetch → critique → picker → frame pipeline with a
 * 24h cache. The route blocks on the cold-miss path (no hand-curated
 * catalogue fallback for MVP); the `maxDuration` export bounds the
 * user-visible wait.
 *
 * The card-side contract is `{ bucket, items, generated_at, cache }`.
 * `MotivationCard` polls every 10s while `cache === 'stale'` (a
 * background refresh is in flight) and retries up to 2 more times
 * with backoff on errors / `cache: 'miss'`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, lt } from 'drizzle-orm'

import { db } from '@/lib/db'
import { goals, commitments } from '@/db/schema'
import { resolveRequestUser } from '@/lib/request-user'

import {
  type Bucket,
  computeStateHash,
  extractLackingSignals,
  recommend,
} from '@/lib/motivation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * Cold-miss calls block on the pipeline (up to ~25s typical, 35s
 *  timeout). Bound the route at 60s to leave headroom for retries and
 *  cold-start latency. Vercel's default is 10s on Hobby, 60s on Pro
 *  for Node runtimes — pinning this explicitly so production doesn't
 *  silently truncate the request.
 */
export const maxDuration = 60

/**
 * Dev-only remap: bearer auth (`Authorization: Bearer dev_*`) creates
 * a synthetic userId that does NOT exist in the `users` table, which
 * makes any FK-protected write (motivation_cache, motivation_rejects,
 * motivation_served_log) fail. In production this branch is dead code
 * — `caller.source === 'bearer'` is gated on `ALLOW_DEV_LOGIN` /
 * `NODE_ENV === 'test'`, both of which must be off in prod.
 *
 * Remap any bearer-sourced caller to the founder id so persistence
 * layers exercise end-to-end during dev. The card-side cache and
 * reject log will be polluted across dev users; that's acceptable —
 * they're dev-only.
 */
const FOUNDER_ID = 'user_founder01'

function resolvePersistableUserId(
  caller: { userId: string; source: 'session' | 'guest' | 'bearer' },
): string {
  if (caller.source === 'bearer') return FOUNDER_ID
  return caller.userId
}

/* -------------------------------------------------------------------------- */
/* Bucket detection — same logic the v0 route used, kept verbatim so the     */
/* front-end's "Picked from what you're working on" promise still holds.     */
/* -------------------------------------------------------------------------- */

async function detectBucket(userId: string): Promise<Bucket> {
  const today = new Date().toISOString().slice(0, 10)

  const overdue = await db
    .select({ id: commitments.id })
    .from(commitments)
    .where(
      and(
        eq(commitments.userId, userId),
        eq(commitments.status, 'open'),
        lt(commitments.due, today),
      ),
    )
    .limit(50)
  if (overdue.length > 0) return 'overdue'

  const activeGoals = await db
    .select({ id: goals.id, updatedAt: goals.updatedAt })
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, 'active')))
    .limit(50)
  if (activeGoals.length === 0) return 'stuck'

  // Dormant = has active goals but no goal activity for 21+ days.
  // Anchored on goals.updatedAt (ticks on every commitment / milestone
  // write that touches the goal).
  const dormantCutoff = new Date(Date.now() - 21 * 86400000)
  const hasActiveRecent = activeGoals.some(
    (g) => g.updatedAt && g.updatedAt >= dormantCutoff,
  )
  if (!hasActiveRecent) return 'dormant'

  return 'stuck'
}

/* -------------------------------------------------------------------------- */
/* GET                                                                        */
/* -------------------------------------------------------------------------- */

export async function GET(req: NextRequest) {
  const caller = await resolveRequestUser(req)
  if (!caller) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }
  const userId = resolvePersistableUserId(caller)

  const url = new URL(req.url)
  const count = Math.min(3, Math.max(1, Number(url.searchParams.get('n')) || 3))
  // `?refresh=true` is set by the manual refresh button in
  // MotivationCard — bypasses the cache read so the user gets a
  // fresh LLM-curated row, not a stale or catalogue fallback. The
  // SWR poller never sets this (it polls without a query string).
  // The dedup map still ensures a force-refresh and a stray poll
  // arriving 200ms apart share one pipeline.
  const forceRefresh = url.searchParams.get('refresh') === 'true'

  let bucket: Bucket = 'stuck'
  try {
    bucket = await detectBucket(userId)
  } catch {
    bucket = 'stuck'
  }

  // Extract lacking signals and compute the cache key. The signal
  // extract is best-effort — a DB hiccup shouldn't take down the
  // recommendation; we fall through to the orchestrator with whatever
  // we have, which itself falls through to `emptyFallback` on
  // failure.
  const signals = await extractLackingSignals({ userId, bucket }).catch(
    () => ({ bucket, themes: [] }),
  )
  const stateHash = computeStateHash(signals)

  // Cold-miss calls block on the pipeline (up to ~25s typical, 35s
  // timeout). The route's `maxDuration = 60` bounds the request at
  // the platform layer.
  const response = await recommend({
    userId,
    bucket,
    stateHash,
    n: count,
    forceRefresh,
  })
  return NextResponse.json(response)
}
