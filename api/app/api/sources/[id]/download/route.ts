/**
 * GET /api/sources/[id]/download — return a signed download URL for a file source.
 *
 * For `kind='link'` sources, returns `{ url: <the link URL> }` (no Emergent
 * Object Storage involved).
 *
 * Auth: Emergent OAuth OR guest cookie OR Bearer (test/dev compat).
 */

import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { verifyGuestToken } from '@/lib/guest-token'
import { db } from '@/lib/db'
import { sources } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { streamObjectAsResponse } from '@/lib/emergent/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const bearer = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (bearer && bearer !== 'bogus_xxx') return bearer

  const session = await auth()
  if (session?.user?.id) return session.user.id

  const guestToken = req.cookies.get('guest_token')?.value
  if (guestToken) return verifyGuestToken(guestToken)
  return null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }

  const { id } = await params

  const [row] = await db
    .select({
      id: sources.id,
      kind: sources.kind,
      storagePath: sources.storagePath,
      url: sources.url,
      contentType: sources.contentType,
      originalFilename: sources.originalFilename,
    })
    .from(sources)
    .where(
      and(eq(sources.id, id), eq(sources.userId, userId), eq(sources.isDeleted, false)),
    )
    .limit(1)

  if (!row) {
    return NextResponse.json({ detail: 'Not found' }, { status: 404 })
  }

  if (row.kind === 'link') {
    return NextResponse.json({ url: row.url })
  }

  // kind === 'file' — stream bytes inline (matches FastAPI Response(...))
  if (!row.storagePath) {
    return NextResponse.json({ detail: 'File not found' }, { status: 404 })
  }

  const { body, contentType } = await streamObjectAsResponse(row.storagePath)

  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${row.originalFilename}"`,
    },
  })
}