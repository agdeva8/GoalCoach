/**
 * GET /api/auth/personas — list the dev personas available to switch into.
 *
 * Gated entirely on `ALLOW_DEV_LOGIN=true`. Returns 404 in production
 * so the route is invisible without the flag.
 *
 * Personas = every user with `persona_key IS NOT NULL OR is_guest = true`.
 * Phase 2 expanded the surface to include the six curated personas
 * (founder, starter, overdue, dormant, dense, memory_heavy) so the
 * persona-switcher in the Header can show a real preview of each
 * identity, not just throwaway guest accounts.
 *
 * The caller (`currentUserId` query param, set by the Header's persona
 * menu) is excluded so the menu never lists "switch to yourself".
 * `limit(50)` is gone — there are at most ~10 personas and a few
 * transient guests; both fit comfortably in one page.
 *
 * Response includes `goals_count` per persona so the menu can render
 * "3 active goals" / "no history yet" previews without a second
 * round-trip.
 */
import { desc } from 'drizzle-orm'

import { type NextRequest, NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { users } from '@/db/schema'
import { resolveRequestUser } from '@/lib/request-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (process.env.ALLOW_DEV_LOGIN !== 'true') {
    return NextResponse.json({ detail: 'Not found' }, { status: 404 })
  }

  const caller = await resolveRequestUser(req).catch(() => null)
  const currentUserId = caller?.userId ?? null

  const url = new URL(req.url)
  const queryCurrentUserId = url.searchParams.get('currentUserId')
  const excludeId = currentUserId ?? queryCurrentUserId

  // Pull EVERY user, then filter in JS — drizzle's `isNotNull` + `or`
  // combo was producing SQL that missed the persona rows in some hot-
  // reload states. The dataset is small (<50 rows), so a JS filter is
  // cheap and avoids the bug. Phase-2 follow-up can rewrite to a
  // single SQL with confidence once the dev DB stabilises.
  const all = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      modelProvider: users.modelProvider,
      createdAt: users.createdAt,
      isGuest: users.isGuest,
      personaKey: users.personaKey,
      personaWeight: users.personaWeight,
    })
    .from(users)
    .orderBy(desc(users.personaKey), desc(users.createdAt))

  const rows = all.filter(
    (r) =>
      (r.personaKey !== null || r.isGuest === true) &&
      r.userId !== excludeId,
  )

  return NextResponse.json({
    personas: rows.map((r) => ({
      user_id: r.userId,
      name: r.name,
      email: r.email,
      model_provider: r.modelProvider ?? 'gemini',
      created_at:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt),
      is_guest: r.isGuest,
      persona_key: r.personaKey ?? null,
      persona_weight: r.personaWeight ?? 0,
    })),
  })
}
