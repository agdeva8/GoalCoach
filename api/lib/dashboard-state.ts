/**
 * Dashboard read model — the cached `GET /api/state` payload.
 *
 * `GET /api/state` is the dashboard's single hot read: it aggregates
 * `loadState` (5 tables) plus the 10-row audit summary. This module owns
 * that payload as a cache-managed read model and is the write-through half
 * of lib/cache.ts:
 *
 *   READ   `getDashboardState(userId)`    — read-through; fresh entry in
 *          memory, otherwise computed once and stored (single-flight).
 *
 *   WRITE  `refreshDashboardState(userId)` — called by every
 *          state-affecting mutation AFTER its transaction commits: drops
 *          the user's entries, immediately reloads them from the DB, and
 *          stores the result. By the time the mutation response reaches
 *          the browser, the next dashboard read is a guaranteed fresh
 *          cache hit — no stale window, no extra round trip.
 *
 *   Misses never fail a mutation: `refreshDashboardState` returns `null`
 *   and leaves the cache COLD (it invalidates before loading), so the next
 *   read recomputes instead of serving pre-write data.
 *
 * Also see: `loadState` itself carries its own read-through entry
 * (lib/llm/state-builder.ts), which the chat context builder shares.
 */

import 'server-only'

import { after } from 'next/server'
import { desc, eq } from 'drizzle-orm'

import { invalidateUser, cacheKey, readThrough } from '@/lib/cache'
import { db } from '@/lib/db'
import { auditLog } from '@/db/schema'
import { loadState, type CoachState } from '@/lib/llm/state-builder'

/** Cache namespace — pairs with `cacheKey(userId, DASHBOARD_NS)`. */
export const DASHBOARD_NS = 'dashboard'

export interface DashboardState extends CoachState {
  audit_summary: {
    recent: Array<{
      id: string
      type: string
      summary: string | null
      created_at: string
    }>
  }
  /** When this snapshot was computed — NOT the response time when cached. */
  generated_at: string
}

/**
 * Canonical loader for the `GET /api/state` body. Kept byte-compatible with
 * the inline logic this route used to own (see the route's doc block for
 * the response contract): `loadState` first, then the 10 most recent audit
 * rows, then `generated_at` stamped at snapshot time.
 *
 * Sequential on purpose: `lib/app/api/state/__tests__/route.test.ts` mocks
 * the DB by table-arrival order, and the audit query only needs the same
 * round trips `loadState` already pays for in parallel internally.
 */
export async function loadDashboardState(
  userId: string,
): Promise<DashboardState> {
  const state = await loadState(userId)

  const recentRows = await db
    .select({
      id: auditLog.id,
      type: auditLog.type,
      summary: auditLog.summary,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.userId, userId))
    .orderBy(desc(auditLog.createdAt))
    .limit(10)

  return {
    ...state,
    audit_summary: {
      recent: recentRows.map((r) => ({
        id: r.id,
        type: r.type,
        summary: r.summary,
        created_at:
          r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : String(r.createdAt),
      })),
    },
    generated_at: new Date().toISOString(),
  }
}

/** Read-through accessor for `GET /api/state`. */
export function getDashboardState(userId: string): Promise<DashboardState> {
  return readThrough(cacheKey(userId, DASHBOARD_NS), () =>
    loadDashboardState(userId),
  )
}

/**
 * WRITE-THROUGH hook — call after a state-affecting transaction commits.
 *
 * Order matters: invalidate FIRST, so a failed reload leaves the cache cold
 * (next read recomputes) rather than holding a pre-write snapshot. The
 * reload that follows therefore always reads post-commit rows, and stores
 * both the dashboard entry and the shared `loadState` entry.
 *
 * Never throws — a mutation must not fail because the warm-up read did.
 * Returns the fresh payload for callers that also need it in their
 * response (e.g. tools/confirm), or `null` on reload failure.
 */
export async function refreshDashboardState(
  userId: string,
): Promise<DashboardState | null> {
  invalidateUser(userId)
  try {
    return await getDashboardState(userId)
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[cache] write-through refresh failed; left cold', err)
    }
    return null
  }
}

/**
 * Mutation-side hook: pre-warm the user's cache AFTER the response is
 * sent, so the next `GET /api/state` is a guaranteed fresh cache hit.
 *
 * Uses Next 16's `after()` so the user's request latency is unchanged —
 * the refresh runs once the response bytes are flushed (and the runtime
 * keeps the function alive via `waitUntil`). Falls back to a background
 * promise when no request lifecycle is available (build, vitest).
 *
 * Never throws — the mutation has already committed; a refresh failure
 * can only mean a stale read next time, not a failed write.
 */
export function scheduleWriteThroughRefresh(userId: string): void {
  const fire = () => {
    refreshDashboardState(userId).catch((err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[cache] write-through refresh failed', err)
      }
    })
  }
  try {
    after(fire)
  } catch {
    // No request lifecycle (vitest, build, etc.) — run best-effort in
    // the background. Cache invariants still hold: invalidate-first
    // inside refreshDashboardState means a failed reload is a cold miss,
    // never a stale hit.
    void fire()
  }
}
