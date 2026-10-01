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

import type { NextRequest } from 'next/server'

import { cachedGet } from '@/lib/cache'
import { loadDashboardState } from '@/lib/dashboard-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-user dashboard read model. Freshness is enforced by the auth
// resolver's invalidateForRequest — every mutating request drops this
// entry before its handler runs, so a cache hit can never serve a
// pre-write snapshot.
export const GET = cachedGet('dashboard', (userId) => loadDashboardState(userId))

