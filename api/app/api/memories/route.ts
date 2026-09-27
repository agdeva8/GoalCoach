/**
 * Memories API surface.
 *
 * GET  /api/memories            — list user's memories, newest first
 * POST /api/memories            — create a memory (Instagram URL or
 *                                photo via multipart upload that
 *                                piggybacks on the existing source
 *                                storage pipeline)
 * DELETE /api/memories/[id]     — soft-detach (we keep the row but
 *                                mark it removed in metadata so an
 *                                undo is feasible)
 *
 * Photos are a two-step flow:
 *   1. POST /api/sources/upload (existing route) returns a source row.
 *   2. POST /api/memories with { kind: 'photo', source_id, caption?, goal_id? }
 *      creates the memory that points at that source row.
 * This keeps the storage path uniform with the rest of the app and
 * lets us reuse the existing signed-download resolver.
 */
import { sql, eq, desc, and } from 'drizzle-orm'

import { type NextRequest, NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { memories, goals } from '@/db/schema'
import { resolveRequestUser } from '@/lib/request-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* -------------------------------------------------------------------------- */
/* Auth — delegated to lib/request-user.ts (Phase 0 unified resolver).        */
/* The previous implementation only read the Authorization Bearer header,    */
/* which the browser never sent — every Memories call 401'd from the UI.     */
/* -------------------------------------------------------------------------- */

/** Parse an instagram.com URL into its canonical shortcode. */
function extractInstagramShortcode(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.host.endsWith('instagram.com')) return null
    // Match patterns like /p/{shortcode}/, /reel/{shortcode}/, /reels/{shortcode}/
    const re = new RegExp('\\/+(?:p|reel|reels|tv)\\/([A-Za-z0-9_-]{6,32})\\/?')
    const m = u.pathname.match(re)
    if (m && m[1]) return m[1]
    return null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const caller = await resolveRequestUser(req)
  if (!caller) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }
  const userId = caller.userId
  const rows = await db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(desc(memories.createdAt))
    .limit(200)
  return NextResponse.json({
    memories: rows.map((m) => ({
      id: m.id,
      kind: m.kind,
      caption: m.caption,
      goal_id: m.goalId,
      goal_title: m.goalTitle,
      source_id: m.sourceId,
      external_url: m.externalUrl,
      instagram_shortcode: m.instagramShortcode,
      width: m.width,
      height: m.height,
      mime_type: m.mimeType,
      size_bytes: m.sizeBytes,
      created_at:
        m.createdAt instanceof Date
          ? m.createdAt.toISOString()
          : String(m.createdAt),
    })),
  })
}

export async function POST(req: NextRequest) {
  const caller = await resolveRequestUser(req)
  if (!caller) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
  }
  const userId = caller.userId

  const body = await req.json().catch(() => ({}))
  const kind: 'photo' | 'instagram' =
    body?.kind === 'instagram' ? 'instagram' : 'photo'

  let caption = String(body?.caption ?? '').trim().slice(0, 600)
  if (!caption) caption = ''

  // Optional goal linkage — resolve to current title + id so display
  // stays consistent if the goal is later renamed.
  let goalId: string | null = null
  let goalTitle = ''
  const incomingGoalId: string | undefined =
    typeof body?.goal_id === 'string' ? body.goal_id : undefined
  if (incomingGoalId) {
    const g = await db
      .select({ id: goals.id, title: goals.title })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.id, incomingGoalId)))
      .limit(1)
    if (g[0]) {
      goalId = g[0].id
      goalTitle = g[0].title
    }
  }

  const id = `mem_${randomSuffix()}`
  if (kind === 'instagram') {
    const url = String(body?.external_url ?? '').trim()
    if (!url) {
      return NextResponse.json(
        { detail: 'external_url required for instagram kind' },
        { status: 400 },
      )
    }
    const shortcode = extractInstagramShortcode(url)
    if (!shortcode) {
      return NextResponse.json(
        { detail: 'That doesn\'t look like an Instagram post URL.' },
        { status: 400 },
      )
    }
    await db.insert(memories).values({
      id,
      userId,
      kind: 'instagram',
      caption,
      goalId,
      goalTitle,
      sourceId: null,
      externalUrl: url,
      instagramShortcode: shortcode,
      width: null,
      height: null,
      mimeType: null,
      sizeBytes: null,
      metadata: {},
    })
    return NextResponse.json({
      ok: true,
      memory: { id, kind: 'instagram', shortcode },
    })
  }

  // photo kind — caller supplies the source_id from a prior
  // /api/sources/upload. Server trusts the id but rescopes the
  // memory to the calling user.
  const sourceId = String(body?.source_id ?? '').trim()
  if (!sourceId) {
    return NextResponse.json(
      { detail: 'source_id required for photo kind (run /api/sources/upload first)' },
      { status: 400 },
    )
  }
  await db.insert(memories).values({
    id,
    userId,
    kind: 'photo',
    caption,
    goalId,
    goalTitle,
    sourceId,
    externalUrl: null,
    instagramShortcode: null,
    width: null,
    height: null,
    mimeType: null,
    sizeBytes: null,
    metadata: {},
  })
  return NextResponse.json({
    ok: true,
    memory: { id, kind: 'photo', source_id: sourceId },
  })
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4)
}
