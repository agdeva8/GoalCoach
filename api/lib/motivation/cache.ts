/**
 * Motivation agent — cache read/write + served-count.
 *
 * Extracted from `recommend.ts` so both the SWR entry (`recommend.ts`) and
 * the pipeline graph (`graph.ts`) can share it without a circular import.
 */

import 'server-only'

import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import { motivationCache, motivationServedLog } from '@/db/schema'

import { CACHE_TTL_MS, STALE_TTL_MS } from './config'
import type { Bucket, RecommendationItem } from './schema'

export interface CacheReadResult {
  status: 'hit' | 'stale' | 'miss'
  items: RecommendationItem[]
  generated_at: string
}

export async function readCache(args: {
  userId: string
  bucket: Bucket
  stateHash: string
}): Promise<CacheReadResult> {
  const now = new Date()
  const staleCutoff = new Date(now.getTime() - STALE_TTL_MS)
  try {
    const rows = await db
      .select({
        items: motivationCache.items,
        generatedAt: motivationCache.generatedAt,
        expiresAt: motivationCache.expiresAt,
      })
      .from(motivationCache)
      .where(
        and(
          eq(motivationCache.userId, args.userId),
          eq(motivationCache.bucket, args.bucket),
          eq(motivationCache.stateHash, args.stateHash),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return { status: 'miss', items: [], generated_at: '' }
    const items = parseItems(row.items)
    const generated_at = row.generatedAt.toISOString()
    if (row.expiresAt > now) {
      return { status: 'hit', items, generated_at }
    }
    if (row.generatedAt > staleCutoff) {
      return { status: 'stale', items, generated_at }
    }
    return { status: 'miss', items: [], generated_at: '' }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[motivation] cache read failed:', err)
    return { status: 'miss', items: [], generated_at: '' }
  }
}

export async function writeCache(args: {
  userId: string
  bucket: Bucket
  stateHash: string
  items: RecommendationItem[]
}): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS)
  await db
    .insert(motivationCache)
    .values({
      userId: args.userId,
      bucket: args.bucket,
      stateHash: args.stateHash,
      items: args.items,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [
        motivationCache.userId,
        motivationCache.bucket,
        motivationCache.stateHash,
      ],
      set: {
        items: args.items,
        generatedAt: new Date(),
        expiresAt,
      },
    })
}

export async function bumpServedCount(userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  try {
    await db
      .insert(motivationServedLog)
      .values({ userId, servedOn: today, count: 1 })
      .onConflictDoUpdate({
        target: [motivationServedLog.userId, motivationServedLog.servedOn],
        set: { count: sql`${motivationServedLog.count} + 1` },
      })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[motivation] served log write failed:', err)
  }
}

export function parseItems(raw: unknown): RecommendationItem[] {
  if (!Array.isArray(raw)) return []
  const out: RecommendationItem[] = []
  for (const it of raw) {
    if (
      it &&
      typeof it === 'object' &&
      typeof (it as { id?: unknown }).id === 'string' &&
      typeof (it as { url?: unknown }).url === 'string'
    ) {
      out.push(it as RecommendationItem)
    }
  }
  return out
}
