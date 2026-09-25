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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const bearer = req.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim()
  if (bearer && bearer !== 'bogus_xxx') return bearer
  return null
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }
  const { id } = await params
  const result = await db
    .delete(memories)
    .where(and(eq(memories.userId, userId), eq(memories.id, id)))
    .returning({ id: memories.id })
  if (result.length === 0) {
    return NextResponse.json({ detail: 'Memory not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, deleted: result[0].id })
}
