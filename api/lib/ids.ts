/**
 * Tiny ID generator — mirrors backend/server.py:53-54 `new_id(prefix)`.
 *
 * Format: `<prefix>_<hex12>` — 12 lowercase hex chars (~48 bits of
 * entropy). Matches what the Python code emitted and what
 * `db/migrate-from-mongo.ts` round-trips from Mongo, so the cutover
 * doesn't have to remap any IDs.
 */

import { randomUUID } from 'node:crypto'

export function newId(prefix: string): string {
  const hex = randomUUID().replace(/-/g, '').slice(0, 12)
  return `${prefix}_${hex}`
}