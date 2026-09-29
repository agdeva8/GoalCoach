#!/usr/bin/env tsx
/**
 * Dev-only — delete `is_guest = true` users that have zero goals.
 *
 * Hard-gated on `process.env.ALLOW_DEV_LOGIN === 'true'`. Refuses to
 * run otherwise so this script can never be invoked against
 * production or any other live environment by accident. (Matches the
 * guard on `scripts/reset-dev-data.ts` and `scripts/seed-personas.ts`.)
 *
 * The intent is narrower than `reset-dev-data.ts`:
 *   - Only touches `is_guest = true` rows.
 *   - Only deletes the subset that have no goals (matching what the
 *     dev Personas switcher surfaces as "guests with 0 goals").
 *   - Leaves the founder (`user_founder01`), the seeded personas
 *     (`user_persona_*`, all `is_guest = false`), and any non-empty
 *     guest account alone.
 *   - Relies on the same `ON DELETE CASCADE` the reset script
 *     uses for guest deletes, so child rows (goals, milestones,
 *     commitments, blockers, messages, audit_log, sources,
 *     memories, proposals, conversations, timetable_blocks,
 *     user_sessions, state_overrides, accounts) go with the user.
 *
 * Dry-run by default. The agent has pre-authorised `--confirm` for
 * this slice; humans reviewing the output should run dry-run first.
 *
 * Idempotent. Re-runs are no-ops once the empty guests are gone.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-empty-guests.ts              # dry run
 *   pnpm tsx scripts/cleanup-empty-guests.ts --confirm    # wipe
 */

import 'dotenv/config'

import pg from 'pg'

const ALLOW = process.env.ALLOW_DEV_LOGIN
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('[cleanup] DATABASE_URL is not set. Aborting.')
  process.exit(2)
}

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

interface EmptyGuestSummary {
  id: string
  name: string | null
  is_guest: boolean
  created_at: Date
  milestones: number
  commitments: number
  blockers: number
  messages: number
  proposals: number
  audit: number
  sources: number
  memories: number
  conversations: number
  timetable_blocks: number
  user_sessions: number
  state_overrides: number
  accounts: number
}

function childCountRows() {
  return `
    COALESCE(ms.cnt, 0)      AS milestones,
    COALESCE(c.cnt, 0)       AS commitments,
    COALESCE(b.cnt, 0)       AS blockers,
    COALESCE(m.cnt, 0)       AS messages,
    COALESCE(p.cnt, 0)       AS proposals,
    COALESCE(a.cnt, 0)       AS audit,
    COALESCE(s.cnt, 0)       AS sources,
    COALESCE(mem.cnt, 0)     AS memories,
    COALESCE(conv.cnt, 0)    AS conversations,
    COALESCE(tb.cnt, 0)      AS timetable_blocks,
    COALESCE(us.cnt, 0)      AS user_sessions,
    COALESCE(so.cnt, 0)      AS state_overrides,
    COALESCE(ac.cnt, 0)      AS accounts
  `
}

function childCountJoins() {
  return `
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM milestones GROUP BY user_id) ms  ON ms.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM commitments GROUP BY user_id) c  ON c.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM blockers GROUP BY user_id) b     ON b.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM messages GROUP BY user_id) m     ON m.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM proposals GROUP BY user_id) p    ON p.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM audit_log GROUP BY user_id) a    ON a.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM sources GROUP BY user_id) s      ON s.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM memories GROUP BY user_id) mem   ON mem.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM conversations GROUP BY user_id) conv ON conv.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM timetable_blocks GROUP BY user_id) tb ON tb.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM user_sessions GROUP BY user_id) us   ON us.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM state_overrides GROUP BY user_id) so  ON so.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM accounts GROUP BY user_id) ac       ON ac.user_id = u.id
  `
}

async function listEmptyGuests(): Promise<EmptyGuestSummary[]> {
  const result = await pool.query<{
    id: string
    name: string | null
    is_guest: boolean
    created_at: Date
    milestones: string
    commitments: string
    blockers: string
    messages: string
    proposals: string
    audit: string
    sources: string
    memories: string
    conversations: string
    timetable_blocks: string
    user_sessions: string
    state_overrides: string
    accounts: string
  }>(
    `
    SELECT
      u.id,
      u.name,
      u.is_guest,
      u.created_at,
      ${childCountRows()}
    FROM users u
    ${childCountJoins()}
    WHERE u.is_guest = true
      AND NOT EXISTS (SELECT 1 FROM goals g WHERE g.user_id = u.id)
    ORDER BY u.created_at ASC
  `,
  )
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    is_guest: r.is_guest,
    created_at: r.created_at,
    milestones: Number(r.milestones),
    commitments: Number(r.commitments),
    blockers: Number(r.blockers),
    messages: Number(r.messages),
    proposals: Number(r.proposals),
    audit: Number(r.audit),
    sources: Number(r.sources),
    memories: Number(r.memories),
    conversations: Number(r.conversations),
    timetable_blocks: Number(r.timetable_blocks),
    user_sessions: Number(r.user_sessions),
    state_overrides: Number(r.state_overrides),
    accounts: Number(r.accounts),
  }))
}

function fmtChildTotal(s: EmptyGuestSummary): string {
  // Count only true child rows; user_sessions / state_overrides are
  // always present for any login, so they're expected and not
  // interesting in the summary headline.
  const interesting =
    s.milestones +
    s.commitments +
    s.blockers +
    s.messages +
    s.proposals +
    s.audit +
    s.sources +
    s.memories +
    s.conversations +
    s.timetable_blocks
  return interesting === 0 ? 'empty' : `child=${interesting}`
}

function printSummary(rows: EmptyGuestSummary[]): void {
  console.log(`[cleanup] ${rows.length} empty-guest user(s) found:`)
  for (const r of rows) {
    console.log(`  ${fmtChildTotal(r).padEnd(10)} ${r.id}  name="${r.name ?? ''}"`)
  }
}

async function deleteEmptyGuests(rows: EmptyGuestSummary[]): Promise<void> {
  if (rows.length === 0) {
    console.log('[cleanup] nothing to delete.')
    return
  }
  console.log(`[cleanup] deleting ${rows.length} empty-guest user(s)...`)
  // CASCADE handles child rows; we're explicit only to surface the row
  // count in the output and keep the SQL obvious.
  const result = await pool.query(
    `DELETE FROM users WHERE id = ANY($1::text[])`,
    [rows.map((r) => r.id)],
  )
  console.log(`[cleanup] DELETE returned rowCount=${result.rowCount}.`)
}

async function main(): Promise<void> {
  if (ALLOW !== 'true') {
    console.error(
      '[cleanup] ALLOW_DEV_LOGIN must be "true" to run this script. Refusing to touch the DB.',
    )
    process.exit(2)
  }

  const args = process.argv.slice(2)
  const confirm = args.includes('--confirm')

  console.log('[cleanup] scanning DB for empty-guest users...')
  const before = await listEmptyGuests()
  printSummary(before)

  if (!confirm) {
    console.log('[cleanup] DRY RUN — pass --confirm to apply.')
    await pool.end()
    return
  }

  await deleteEmptyGuests(before)

  console.log('[cleanup] post-cleanup scan:')
  const after = await listEmptyGuests()
  printSummary(after)
  console.log('[cleanup] done.')
  await pool.end()
}

main().catch(async (e) => {
  console.error('[cleanup] FATAL', e)
  try {
    await pool.end()
  } catch {
    /* ignore secondary errors */
  }
  process.exit(1)
})
