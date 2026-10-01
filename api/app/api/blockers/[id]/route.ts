/**
 * /api/blockers/[id] — PUT (replace) or DELETE a blocker.
 *
 * Source of truth: backend/server.py:862-874 (`update_blocker` /
 * `delete_blocker`). The legacy API used PUT (full replace) rather
 * than PATCH (partial merge); we honor that here.
 *
 * PUT body (zod-validated; 400 on failure):
 *   {
 *     title:      string         // required
 *     start_date: YYYY-MM-DD     // required
 *     end_date?:  YYYY-MM-DD     // defaults to start_date
 *     note?:      string         // default ''
 *   }
 *
 * Auth: Auth.js session OR guest_token cookie.
 * Ownership: 404 if the row doesn't exist or isn't owned by the user.
 *
 * Responses:
 *   200 { blocker } on PUT success
 *   200 { ok: true } on DELETE success
 *   400 invalid body
 *   401 unauthenticated
 *   404 not found / not owned
 */

import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  authenticateRoute,
  badRequestResponse,
  notFoundResponse,
} from '@/lib/auth-route'
import { AUDIT_TYPES, writeAudit } from '@/lib/audit'
import { db } from '@/lib/db'
import { blockers } from '@/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UpdateBlockerBody = z.object({
  title: z.string().trim().min(1),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  note: z.string().optional().default(''),
})

/* -------------------------------------------------------------------------- */
/* PUT                                                                        */
/* -------------------------------------------------------------------------- */

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  const { id } = await ctx.params
  if (!id) return badRequestResponse('Missing blocker id')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequestResponse('Invalid JSON body')
  }

  const parsed = UpdateBlockerBody.safeParse(body)
  if (!parsed.success) {
    return badRequestResponse(parsed.error.issues[0]?.message ?? 'Invalid body')
  }
  const input = parsed.data
  const endDate = input.end_date ?? input.start_date
  const note = input.note ?? ''

  const existing = await db
    .select({ id: blockers.id, title: blockers.title })
    .from(blockers)
    .where(and(eq(blockers.id, id), eq(blockers.userId, auth.userId!)))
    .limit(1)
  if (!existing.length) return notFoundResponse('Blocker not found')

  await db.transaction(async (tx: any) => {
    await tx
      .update(blockers)
      .set({
        title: input.title,
        startDate: input.start_date,
        endDate,
        note,
      })
      .where(eq(blockers.id, id))
    await writeAudit(tx, {
      userId: auth.userId!,
      type: AUDIT_TYPES.UPDATE_BLOCKER,
      summary: `Updated blocker '${existing[0].title}'`,
      payload: {
        blocker_id: id,
        title: input.title,
        start_date: input.start_date,
        end_date: endDate,
        note,
      },
    })
  })

  const row = await db
    .select()
    .from(blockers)
    .where(eq(blockers.id, id))
    .limit(1)

  return NextResponse.json({ blocker: row[0] ? serialize(row[0]) : null })
}

/* -------------------------------------------------------------------------- */
/* DELETE                                                                     */
/* -------------------------------------------------------------------------- */

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRoute(req)
  if (auth.error) return auth.error

  const { id } = await ctx.params
  if (!id) return badRequestResponse('Missing blocker id')

  const existing = await db
    .select({ id: blockers.id, title: blockers.title })
    .from(blockers)
    .where(and(eq(blockers.id, id), eq(blockers.userId, auth.userId!)))
    .limit(1)
  if (!existing.length) return notFoundResponse('Blocker not found')

  await db.transaction(async (tx: any) => {
    await tx.delete(blockers).where(eq(blockers.id, id))
    await writeAudit(tx, {
      userId: auth.userId!,
      type: AUDIT_TYPES.DELETE_BLOCKER,
      summary: `Deleted blocker '${existing[0].title}'`,
      payload: { blocker_id: id },
    })
  })

  return NextResponse.json({ ok: true })
}

function serialize(row: any) {
  return {
    id: row.id,
    user_id: row.userId,
    title: row.title,
    start_date: row.startDate,
    end_date: row.endDate,
    note: row.note,
    created_at:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  }
}
