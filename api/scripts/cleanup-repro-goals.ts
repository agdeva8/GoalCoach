#!/usr/bin/env tsx
/**
 * Dev-only — delete goal rows whose title matches the repro pollution
 * pattern (^repro goal <digits>$). Surgical: leaves seeded legit
 * titles alone.
 *
 * Hard-gated on `process.env.ALLOW_DEV_LOGIN === 'true'` (matches
 * the rest of the dev scripts).
 *
 * The match pattern is anchored to `^repro goal \d+$` so it cannot
 * accidentally catch any canonically-named goals from
 * `scripts/seed-personas.ts`. CASCADE on `goal_id` in
 * milestones, commitments, sources cleans children.
 *
 * Dry-run by default. Pass `--confirm` to apply.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-repro-goals.ts              # dry run
 *   pnpm tsx scripts/cleanup-repro-goals.ts --confirm    # delete
 */

import 'dotenv/config'

import pg from 'pg'

const ALLOW = process.env.ALLOW_DEV_LOGIN
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('[cleanup] DATABASE_URL is not set. Aborting.')
  process.exit(2)
}

if (ALLOW !== 'true') {
  console.error(
    '[cleanup] ALLOW_DEV_LOGIN must be "true" to run this script. Refusing to touch the DB.',
  )
  process.exit(2)
}

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

interface PollutionSummary {
  user_id: string
  name: string | null
  is_guest: boolean | null
  polluted_goals: number
  total_goals: number
}

async function summarisePollution(): Promise<PollutionSummary[]> {
  const result = await pool.query<{
    user_id: string
    name: string | null
    is_guest: boolean | null
    polluted: string
    total: string
  }>(
    `
    SELECT
      g.user_id,
      u.name,
      u.is_guest,
      COUNT(*) FILTER (WHERE g.title ~ '^repro goal \\d+$') AS polluted,
      COUNT(*) AS total
    FROM goals g
    LEFT JOIN users u ON u.id = g.user_id
    GROUP BY g.user_id, u.name, u.is_guest
    HAVING COUNT(*) FILTER (WHERE g.title ~ '^repro goal \\d+$') > 0
    ORDER BY COUNT(*) FILTER (WHERE g.title ~ '^repro goal \\d+$') DESC
  `,
  )
  return result.rows.map((r) => ({
    user_id: r.user_id,
    name: r.name,
    is_guest: r.is_guest,
    polluted_goals: Number(r.polluted),
    total_goals: Number(r.total),
  }))
}

async function totalPollutedRows(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM goals WHERE title ~ '^repro goal \\d+$'`,
  )
  return Number(result.rows[0].count)
}

async function childBreakdownForPollutedPollutedGoals(): Promise<{
  milestones: number
  commitments: number
  sources: number
}> {
  // Count the child rows that will go away when CASCADE fires.
  const r = await pool.query<{
    milestones: string
    commitments: string
    sources: string
  }>(
    `
    SELECT
      (SELECT COUNT(*) FROM milestones WHERE goal_id IN (SELECT id FROM goals WHERE title ~ '^repro goal \\d+$')) AS milestones,
      (SELECT COUNT(*) FROM commitments WHERE goal_id IN (SELECT id FROM goals WHERE title ~ '^repro goal \\d+$')) AS commitments,
      (SELECT COUNT(*) FROM sources    WHERE goal_id IN (SELECT id FROM goals WHERE title ~ '^repro goal \\d+$')) AS sources
  `,
  )
  return {
    milestones: Number(r.rows[0].milestones),
    commitments: Number(r.rows[0].commitments),
    sources: Number(r.rows[0].sources),
  }
}

function printSummary(rows: PollutionSummary[], totalPolluted: number, children: { milestones: number; commitments: number; sources: number }): void {
  console.log(`[cleanup] ${rows.length} user(s) hold repro-polluted goal titles:`)
  for (const r of rows) {
    console.log(
      `  ${r.polluted_goals.toString().padStart(4)} polluted / ${r.total_goals.toString().padStart(4)} total  ${r.user_id}  name="${r.name ?? ''}"  is_guest=${r.is_guest ?? 'unknown'}`,
    )
  }
  console.log(`[cleanup] total polluted goal rows: ${totalPolluted}`)
  console.log(
    `[cleanup] children that will CASCADE with them: milestones=${children.milestones}, commitments=${children.commitments}, sources=${children.sources}`,
  )
}

async function deletePolluted(): Promise<void> {
  // Goal-level delete. Child rows on milestones / commitments /
  // sources cascade via FK.
  const result = await pool.query(
    `DELETE FROM goals WHERE title ~ '^repro goal \\d+$'`,
  )
  console.log(`[cleanup] DELETE goals returned rowCount=${result.rowCount}.`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const confirm = args.includes('--confirm')

  console.log('[cleanup] scanning DB for repro-polluted goals...')
  const rows = await summarisePollution()
  const totalPolluted = await totalPollutedRows()
  const children = await childBreakdownForPollutedPollutedGoals()
  printSummary(rows, totalPolluted, children)

  if (!confirm) {
    console.log('[cleanup] DRY RUN — pass --confirm to apply.')
    await pool.end()
    return
  }

  await deletePolluted()

  console.log('[cleanup] post-cleanup scan:')
  const after = await summarisePollution()
  const totalAfter = await totalPollutedRows()
  const remaining = await totalPollutedRows()
  if (remaining === 0 && after.length === 0) {
    console.log('  (no polluted goals remain) ✓')
  } else {
    console.log(`  ${remaining} polluted rows still in DB across ${after.length} user(s):`)
    for (const r of after) {
      console.log(`    ${r.user_id}  ${r.polluted_goals} polluted`)
    }
  }
  console.log(`[cleanup] done. ${totalPolluted} repro goals removed; ${totalAfter} remain (should be 0).`)
  await pool.end()
}

main().catch(async (e) => {
  console.error('[cleanup] FATAL', e)
  try {
    await pool.end()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
