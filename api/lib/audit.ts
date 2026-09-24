/**
 * Shared audit-log + ID helpers for CRUD route handlers.
 *
 * Source of truth: migration/discovery/03-nextjs-architecture.md Section 8
 * Task 11 ("All mutations must write to `audit_log` in the same
 * transaction").
 *
 * Design notes:
 *   - `newId(prefix)` produces IDs of the form `goal_<12hex>`,
 *     `commit_<12hex>`, etc. — matching the legacy FastAPI
 *     `backend/server.py:54` (`new_id(prefix)`) so any URL or audit
 *     trail a user has saved stays valid after the migration.
 *   - `writeAudit(tx, ...)` is the canonical writer. It accepts a
 *     Drizzle transaction (`tx`) so callers can include the audit row
 *     in the same atomic write as the mutation it describes.
 *   - We export `AUDIT_TYPES` (a frozen set of strings) so tests can
 *     pin the exact type labels emitted by each handler.
 */

import { randomUUID } from 'node:crypto'

import { auditLog } from '@/db/schema'

/* -------------------------------------------------------------------------- */
/* ID generation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Generate a fresh ID for a domain row. Format: `<prefix>_<12hex>`,
 * matching the legacy `new_id(prefix)` in backend/server.py:54.
 *
 * Examples:
 *   newId('goal')       -> "goal_a3f9e2c81b07"
 *   newId('commit')     -> "commit_5d2e84f0c91a"
 *   newId('block')      -> "block_29b01d47e6f5"
 *   newId('mile')       -> "mile_3c8e7af92014"
 *   newId('audit')      -> "audit_44e1c2b03a76"
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

/* -------------------------------------------------------------------------- */
/* Audit type labels (must match proposal-executor.ts's `confirm:<action>`    */
/* convention for `confirm:*` lines).                                          */
/* -------------------------------------------------------------------------- */

/**
 * Audit type strings emitted by the CRUD route handlers. Direct (non-
 * proposal) mutations use the `create:<entity>` / `update:<entity>` /
 * `delete:<entity>` shape so they're easy to filter in the audit UI.
 */
export const AUDIT_TYPES = {
  CREATE_GOAL: 'create:goal',
  UPDATE_GOAL: 'update:goal',
  DROP_GOAL: 'drop:goal',
  CREATE_COMMITMENT: 'create:commitment',
  UPDATE_COMMITMENT: 'update:commitment',
  COMPLETE_COMMITMENT: 'complete:commitment',
  DELETE_COMMITMENT: 'delete:commitment',
  CREATE_MILESTONE: 'create:milestone',
  UPDATE_MILESTONE: 'update:milestone',
  DELETE_MILESTONE: 'delete:milestone',
  CREATE_BLOCKER: 'create:blocker',
  UPDATE_BLOCKER: 'update:blocker',
  DELETE_BLOCKER: 'delete:blocker',
} as const

export type AuditType = (typeof AUDIT_TYPES)[keyof typeof AUDIT_TYPES]

/* -------------------------------------------------------------------------- */
/* writeAudit — canonical audit-log writer                                    */
/* -------------------------------------------------------------------------- */

/**
 * Write one audit_log row inside an existing Drizzle transaction so the
 * audit row is atomic with the mutation it describes.
 *
 * Pass the `tx` you started with `db.transaction(async (tx) => {...})`.
 * We accept `tx` as `any` because Drizzle's transaction handle type is
 * generic over the schema and we want callers in different files to
 * stay terse.
 *
 * `payload` is anything JSON-serialisable; we cast to `any` because the
 * `auditLog.payload` column is `jsonb` and Drizzle's inference there is
 * wide enough for the actual use case.
 */
export async function writeAudit(
  tx: any,
  args: {
    userId: string
    type: AuditType
    summary: string
    payload: Record<string, unknown>
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId('audit'),
    userId: args.userId,
    type: args.type,
    summary: args.summary,
    payload: args.payload as any,
    createdAt: new Date(),
  })
}

/* -------------------------------------------------------------------------- */
/* ISO date helpers (matching the Python `datetime.now(UTC).date().isoformat()`*/
/* behaviour) — exposed so route handlers can default `start_date` etc.       */
/* -------------------------------------------------------------------------- */

/** Today's date in ISO `YYYY-MM-DD` (UTC). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Validate a string is an ISO `YYYY-MM-DD` date or null/empty.
 * Returns the same string when valid, `null` when empty/null, or `undefined`
 * to signal "invalid" (caller returns 400).
 */
export function asIsoDateOrNull(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  // Cheap calendar check: Date.parse rejects `2026-02-31` etc.
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(ms)) return undefined
  // Reject timezone-shifted parses that round-trip the wrong day.
  const round = new Date(ms).toISOString().slice(0, 10)
  if (round !== value) return undefined
  return value
}
