/**
 * Daily log — the coach's memory of the day (Iteration 10, effect 5.3).
 *
 * One row per (user_id, log_date), upserted by `PUT /api/daily_log`. Carries
 * the Today tab's section-level free text plus JSON snapshots of that day's
 * commitment ticks/notes and blocker skips.
 *
 * The merge logic is factored into pure functions (`mergeDailyLog`,
 * `withCommitmentNote`) so it can be unit-tested without a DB. The DB
 * wrappers are thin.
 */

import 'server-only'

import { and, desc, eq, gte } from 'drizzle-orm'

import { db } from '@/lib/db'
import { dailyLog } from '@/db/schema'

export interface DailyCommitmentEntry {
  commitment_id: string
  completed: boolean
  note: string
}

export interface DailyBlockerEntry {
  blocker_id: string
  skipped: boolean
  note: string
}

export interface DailyLogRow {
  date: string
  text: string
  commitments: DailyCommitmentEntry[]
  blockers: DailyBlockerEntry[]
  updated_at: string
}

export interface DailyLogPatch {
  text?: string
  commitments?: DailyCommitmentEntry[]
  blockers?: DailyBlockerEntry[]
}

/** Pure merge: apply a partial patch over an existing row (or start fresh). */
export function mergeDailyLog(
  existing: DailyLogRow | null,
  date: string,
  patch: DailyLogPatch,
  updatedAtIso: string,
): DailyLogRow {
  return {
    date,
    text: patch.text ?? existing?.text ?? '',
    commitments: patch.commitments ?? existing?.commitments ?? [],
    blockers: patch.blockers ?? existing?.blockers ?? [],
    updated_at: updatedAtIso,
  }
}

/** Pure: add/update one commitment's note (and optionally completed flag). */
export function withCommitmentNote(
  entries: DailyCommitmentEntry[],
  commitmentId: string,
  note: string,
  completed?: boolean,
): DailyCommitmentEntry[] {
  const idx = entries.findIndex((e) => e.commitment_id === commitmentId)
  if (idx === -1) {
    return [...entries, { commitment_id: commitmentId, completed: completed ?? false, note }]
  }
  const next = entries.slice()
  next[idx] = {
    ...next[idx],
    note,
    ...(completed === undefined ? {} : { completed }),
  }
  return next
}

function toRow(r: {
  logDate: string
  text: string
  commitments: unknown
  blockers: unknown
  updatedAt: Date | string
}): DailyLogRow {
  return {
    date: r.logDate,
    text: r.text,
    commitments: (r.commitments as DailyCommitmentEntry[]) ?? [],
    blockers: (r.blockers as DailyBlockerEntry[]) ?? [],
    updated_at:
      r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  }
}

export async function getDailyLog(
  userId: string,
  date: string,
): Promise<DailyLogRow | null> {
  const rows = await db
    .select()
    .from(dailyLog)
    .where(and(eq(dailyLog.userId, userId), eq(dailyLog.logDate, date)))
    .limit(1)
  return rows[0] ? toRow(rows[0]) : null
}

export async function getDailyLogsSince(
  userId: string,
  sinceDate: string,
): Promise<DailyLogRow[]> {
  const rows = await db
    .select()
    .from(dailyLog)
    .where(and(eq(dailyLog.userId, userId), gte(dailyLog.logDate, sinceDate)))
    .orderBy(desc(dailyLog.logDate))
  return rows.map(toRow)
}

/** Upsert a daily log, merging the patch over any existing row. */
export async function upsertDailyLog(
  userId: string,
  date: string,
  patch: DailyLogPatch,
): Promise<DailyLogRow> {
  const existing = await getDailyLog(userId, date)
  const merged = mergeDailyLog(existing, date, patch, new Date().toISOString())

  await db
    .insert(dailyLog)
    .values({
      userId,
      logDate: date,
      text: merged.text,
      commitments: merged.commitments,
      blockers: merged.blockers,
    })
    .onConflictDoUpdate({
      target: [dailyLog.userId, dailyLog.logDate],
      set: {
        text: merged.text,
        commitments: merged.commitments,
        blockers: merged.blockers,
        updatedAt: new Date(),
      },
    })

  return merged
}

/** Effect 5.2 — merge one commitment's note into today's daily log. */
export async function mergeCommitmentNote(
  userId: string,
  date: string,
  commitmentId: string,
  note: string,
  completed?: boolean,
): Promise<DailyLogRow> {
  const existing = await getDailyLog(userId, date)
  const base = existing?.commitments ?? []
  return upsertDailyLog(userId, date, {
    commitments: withCommitmentNote(base, commitmentId, note, completed),
  })
}
