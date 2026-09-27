/**
 * DELETE /api/memories/[id] — drop a memory.
 *
 * The memory row is hard-deleted. The underlying `sources` row
 * (for photo memories) is left intact so the file storage path is
 * still reusable elsewhere.
 */
import { and, eq } from 'drizzle-orm'

import { type NextRequest, NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { memories } from '@/db/schema'
import { resolveRequestUser } from '@/lib/request-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* -------------------------------------------------------------------------- */
/* Auth — delegated to lib/request-user.ts (Phase 0 unified resolver).        */
/* The previous implementation only read the Authorization Bearer header,    */
/* which the browser never sent — every Memories DELETE 401'd from the UI.   */
/* -------------------------------------------------------------------------- */

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await resolveRequestUser(req)
  if (!caller) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }
  const userId = caller.userId
  const { id } = await params
  const deleted = await db
    .delete(memories)
    .where(and(eq(memories.userId, userId), eq(memories.id, id)))
    .returning()
  if (deleted.length === 0) {
    return NextResponse.json({ detail: 'Memory not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, deleted: deleted[0].id })
}
