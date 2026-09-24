/**
 * POST /api/sources/upload — multipart file upload → Emergent Object Storage + DB
 *
 * Auth: Emergent OAuth `session_token` cookie OR legacy `guest_token`
 * cookie OR `Authorization: Bearer <token>` (test/dev compat).
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

import { auth } from '@/lib/auth'
import { verifyGuestToken } from '@/lib/guest-token'
import { db } from '@/lib/db'
import { sources, goals } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { uploadFile } from '@/lib/storage'
import { extractText } from '@/lib/sources'

const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'md', 'txt', 'csv', 'json', 'png', 'jpg', 'jpeg', 'docx',
])

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Resolve the authenticated user ID from the request.
 * Order:
 *   1. Authorization Bearer token (test/dev compat)
 *   2. Emergent OAuth OR guest cookie (shared helper)
 *   3. Bare guest cookie (DB-free path)
 * Returns null if no valid credentials are present.
 */
async function resolveUserId(req: NextRequest): Promise<string | null> {
  const bearer = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (bearer && bearer !== 'bogus_xxx') return bearer

  const session = await auth()
  if (session?.user?.id) return session.user.id

  const guestToken = req.cookies.get('guest_token')?.value
  if (guestToken) return verifyGuestToken(guestToken)
  return null
}

export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ detail: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ detail: 'No file provided' }, { status: 400 })
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { detail: 'File too large (max 20MB)' },
      { status: 413 },
    )
  }

  const filename = file.name || 'file'
  const ext = filename.split('.').slice(-1)[0]?.toLowerCase() ?? ''
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { detail: `Unsupported file type: .${ext}` },
      { status: 400 },
    )
  }

  const goalId = String(formData.get('goal_id') ?? '')

  // Read file bytes once (cannot re-read a File/Blob in browser-like streams)
  const buffer = Buffer.from(await file.arrayBuffer())

  // Upload to Emergent Object Storage (via the lib/storage shim).
  const { pathname } = await uploadFile(
    userId,
    filename,
    buffer,
    file.type || 'application/octet-stream',
  )

  // Extract text excerpt
  const textExcerpt = await extractText(filename, buffer)

  // Resolve goal title if goal_id provided
  let goalTitle = ''
  if (goalId) {
    const [goalRow] = await db
      .select({ title: goals.title })
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
      .limit(1)
    goalTitle = goalRow?.title ?? ''
  }

  const id = `src_${randomUUID().replace(/-/g, '').slice(0, 12)}`

  const [row] = await db
    .insert(sources)
    .values({
      id,
      userId,
      goalId: goalId || null,
      goalTitle,
      kind: 'file',
      storagePath: pathname,
      originalFilename: filename,
      contentType: file.type || 'application/octet-stream',
      size: buffer.length,
      url: '',
      textExcerpt,
      isDeleted: false,
    })
    .returning()

  return NextResponse.json({
    id: row.id,
    user_id: row.userId,
    goal_id: row.goalId ?? '',
    goal_title: row.goalTitle,
    kind: row.kind,
    storage_path: row.storagePath,
    original_filename: row.originalFilename,
    content_type: row.contentType,
    size: row.size,
    url: row.url,
    is_deleted: row.isDeleted,
    created_at: row.createdAt.toISOString(),
  })
}