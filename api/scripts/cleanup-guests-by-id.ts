#!/usr/bin/env tsx
/**
 * Dev-only — delete specific `users` rows by id list.
 *
 * Hard-gated on `process.env.ALLOW_DEV_LOGIN === 'true'` (matches the
 * rest of the dev scripts: `cleanup-empty-guests.ts`,
 * `reset-dev-data.ts`, `seed-personas.ts`).
 *
 * Use this when the UI shows a small set of guest-style rows you
 * want gone but that don't match the broader "is_guest = true AND
 * no goals" filter (e.g. leftover test fixtures like `user_repro_*`,
 * or guest rows that already accumulated child data). Pass the
 * ids as a comma-separated argv.
 *
 * Relies on the same `ON DELETE CASCADE` for `user_id` FKs the
 * other guest-cleanup scripts use, so child rows
 * (goals, milestones, commitments, blockers, messages,
 * audit_log, sources, memories, proposals, conversations,
 * timetable_blocks, user_sessions, state_overrides, accounts)
 * go with the user row.
 *
 * Dry-run by default. Pass `--confirm` to apply.
 *
 * Idempotent. Re-runs are no-ops once the rows are gone.
 *
 * Why not `import { db } from '@/lib/db'`: that module pulls in
 * `lib/env.ts` which has an `import 'server-only'` guard and
 * crashes when invoked from a CLI script outside the Next.js
 * server runtime. We open a `pg` pool directly so the script
 * can run via `tsx`.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-guests-by-id.ts u1,u2,u3              # dry run
 *   pnpm tsx scripts/cleanup-guests-by-id.ts u1,u2,u3 --confirm    # delete
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

interface TargetSummary {
  id: string
  name: string | null
  is_guest: boolean | null
  goals: number
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

function parseIds(argv: string[]): string[] {
  const positional = argv.filter((a) => !a.startsWith('--'))
  if (positional.length < 1) {
    console.error('[cleanup] usage: pnpm tsx scripts/cleanup-guests-by-id.ts id1,id2[,id3,...] [--confirm]')
    process.exit(2)
  }
  const raw = positional[0]
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (ids.length === 0) {
    console.error('[cleanup] no ids parsed from argv.')
    process.exit(2)
  }
  // Defensive: enforce ids look like text identifiers (no SQLi surface).
  for (const id of ids) {
    if (!/^[A-Za-z0-9_:-]+$/.test(id)) {
      console.error(`[cleanup] refusing suspicious id: ${JSON.stringify(id)}`)
      process.exit(2)
    }
  }
  return Array.from(new Set(ids))
}

async function summarise(ids: string[]): Promise<TargetSummary[]> {
  const result = await pool.query<{
    id: string
    name: string | null
    is_guest: boolean | null
    goals: string
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
      COALESCE(g.cnt, 0)       AS goals,
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
    FROM users u
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM goals GROUP BY user_id) g         ON g.user_id = u.id
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
    WHERE u.id = ANY($1::text[])
    ORDER BY u.id ASC
  `,
    [ids],
  )
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    is_guest: r.is_guest,
    goals: Number(r.goals),
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

function fmtChildTotal(s: TargetSummary): string {
  const interesting =
    s.goals +
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

function printReport(found: TargetSummary[], requested: string[]): void {
  console.log(`[cleanup] requested ${requested.length} id(s); found ${found.length} in DB:`)
  for (const r of found) {
    console.log(
      `  ${fmtChildTotal(r).padEnd(10)} ${r.id}  name="${r.name ?? ''}"  is_guest=${r.is_guest ?? 'unknown'}`,
    )
  }
  const missing = requested.filter(
    (id) => !found.some((f) => f.id === id),
  )
  if (missing.length > 0) {
    console.log(`[cleanup] not found in DB (already gone, or wrong id):`)
    for (const id of missing) console.log(`  ${id}`)
  }
}

async function deleteIds(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    console.log('[cleanup] nothing to delete.')
    return
  }
  const result = await pool.query(
    `DELETE FROM users WHERE id = ANY($1::text[])`,
    [ids],
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

  const argv = process.argv.slice(2)
  const confirm = argv.includes('--confirm')
  const ids = parseIds(argv)

  console.log(`[cleanup] scanning DB for ${ids.length} id(s)...`)
  const found = await summarise(ids)
  printReport(found, ids)

  if (!confirm) {
    console.log('[cleanup] DRY RUN — pass --confirm to apply.')
    await pool.end()
    return
  }

  const foundIds = found.map((r) => r.id)
  await deleteIds(foundIds)

  console.log('[cleanup] post-cleanup scan:')
  const after = await summarise(ids)
  printReport(after, ids)
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
