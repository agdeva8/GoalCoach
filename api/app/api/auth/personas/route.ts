/**
 * GET /api/auth/personas — list the saved guest personas on this DB.
 *
 * Gated entirely on `ALLOW_DEV_LOGIN=true`. Returns 404 in production
 * so the route is invisible without the flag.
 *
 * Body: { personas: [{ user_id, name, created_at, is_guest }] }
 *
 * Personas = any `users` row with `is_guest = true`, ordered by most
 * recently created. Useful for the persona-switcher dropdown in the
 * Header so the user can swap between test identities without going
 * through the OAuth host. Excludes the user_sessions rows deliberately
 * — personas are stateless identities, persisted on this DB only.
 *
 * Why this isn't part of the regular `users` API: dev-only, dev-
 * local convenience, never exposed to a real account.
 */
import { desc, eq } from 'drizzle-orm'

import { type NextRequest, NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { users } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  if (process.env.ALLOW_DEV_LOGIN !== 'true') {
    return NextResponse.json({ detail: 'Not found' }, { status: 404 })
  }
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      modelProvider: users.modelProvider,
      createdAt: users.createdAt,
      isGuest: users.isGuest,
    })
    .from(users)
    .where(eq(users.isGuest, true))
    .orderBy(desc(users.createdAt))
    .limit(50)

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
    })),
  })
}
