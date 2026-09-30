/**
 * GET /api/motivation/recommend
 *
 * Returns 1-3 motivation items for the current user. When the
 * `MOTIVATION_AGENT_ENABLED` flag is off (dev/test default at MVP)
 * the route returns hand-curated catalogue items directly. When the
 * flag is on, the route delegates to `recommend()` in
 * `api/lib/motivation/recommend.ts` which runs the full search →
 * fetch → critique → picker → frame pipeline with a 60m cache and a
 * deterministic fallback to the catalogue on any failure.
 *
 * The card-side contract is unchanged: `{ bucket, items,
 * generated_at, cache }`. `MotivationCard` ignores the new `cache`
 * field; it exists for ops/telemetry.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, lt } from 'drizzle-orm'

import { db } from '@/lib/db'
import { goals, commitments } from '@/db/schema'
import { resolveRequestUser } from '@/lib/request-user'

import {
  MOTIVATION_AGENT_ENABLED,
  type Bucket,
  catalogueFallbackFrame,
  pickFromCatalogue,
  computeStateHash,
  extractLackingSignals,
  recommend,
} from '@/lib/motivation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  const userId = caller.userId

  const url = new URL(req.url)
  const count = Math.min(3, Math.max(1, Number(url.searchParams.get('n')) || 3))

  let bucket: Bucket = 'stuck'
  try {
    bucket = await detectBucket(userId)
  } catch {
    bucket = 'stuck'
  }

  // Compute the state hash here so the catalogue fast-path can write
  // a cache row too (when the flag flips on later, the same hash will
  // hit the cache from past catalogue writes).
  const signals = await extractLackingSignals({ userId, bucket }).catch(
    () => ({ bucket, themes: [] }),
  )
  const stateHash = computeStateHash(signals)

  // Fast path — when the agent is off (MVP default), skip the
  // orchestrator and return the catalogue directly. The orchestrator
  // itself would short-circuit to the same shape, but going direct
  // saves the cache lookup roundtrip on every dev refresh.
  if (!MOTIVATION_AGENT_ENABLED) {
    const seeds = pickFromCatalogue(bucket, count)
    const items = seeds.map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      author: s.author,
      url: s.url,
      duration: s.duration,
      frame: catalogueFallbackFrame(s, bucket),
      excerpt: s.excerpt,
      score_total: 0,
    }))
    return NextResponse.json({
      bucket,
      items,
      generated_at: new Date().toISOString(),
      cache: 'miss' as const,
    })
  }

  // Agent path — delegate to the orchestrator.
  const response = await recommend({
    userId,
    bucket,
    stateHash,
    n: count,
  })
  return NextResponse.json(response)
}
