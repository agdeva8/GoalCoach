/**
 * GET /api/state — full dashboard state for the current user.
 *
 * Source of truth: backend/server.py:209-260 (`load_state` + `/state`)
 * and migration/discovery/03-nextjs-architecture.md Section 1
 * (the `api/state/route.ts` route handler).
 *
 * Response shape (snake_case keys — matches the legacy FastAPI surface
 * so the frontend can `useState(d)` directly):
 *
 *   {
 *     goals:           [...],
 *     commitments:     [...],
 *     milestones:      [...],
 *     blockers:        [...],
 *     sources:         [...],
 *     over_commitment: { level, message, conflicting, active_goals, open_commitments },
 *     audit_summary:   { total, recent: [{ id, type, summary, created_at }, ...] },
 *     generated_at:    "<iso8601>"
 *   }
 *
 * The `audit_summary` block is the new addition vs. the legacy backend:
 * the dashboard's "Honesty audit" panel renders `recent`. We expose
 * `total` so the UI can show "n more in audit…" affordances.
 *
 * Auth: Auth.js session OR legacy `guest_token` cookie. `auth()` from
 * `lib/auth-route.ts` handles both.
 */

import { NextRequest, NextResponse } from 'next/server'

import { authenticateRoute } from '@/lib/auth-route'
import { db } from '@/lib/db'
import { auditLog } from '@/db/schema'
import { loadState } from '@/lib/llm/state-builder'
import { eq, desc } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  // loadState hits 5 tables (goals, commitments, milestones, blockers,
  // sources) and computes the over-commitment chip server-side.
  const state = await loadState(auth.userId)

  // Audit summary — small enough to inline so the dashboard can render
  // a "recent activity" section without a second round-trip.
  const recentRows = await db
    .select({
      id: auditLog.id,
      type: auditLog.type,
      summary: auditLog.summary,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.userId, auth.userId))
    .orderBy(desc(auditLog.createdAt))
    .limit(10)

  return NextResponse.json({
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
  })
}
