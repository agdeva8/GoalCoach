#!/usr/bin/env tsx
/**
 * Dev-only diagnostic. Lists non-seed goal pollution so we can decide
 * a clean-up strategy. Hard-gated like the rest of the dev scripts.
 *
 * Usage:
 *   pnpm tsx scripts/probe-repro-pollution.ts
 */

import 'dotenv/config'

import pg from 'pg'

const ALLOW = process.env.ALLOW_DEV_LOGIN
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('[probe] DATABASE_URL is not set. Aborting.')
  process.exit(2)
}

if (ALLOW !== 'true') {
  console.error('[probe] ALLOW_DEV_LOGIN must be "true" to run. Aborting.')
  process.exit(2)
}

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function main(): Promise<void> {
  const totals = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM goals`)
  console.log(`[probe] total goals in DB: ${totals.rows[0].count}`)

  // Group by title pattern. Repro scripts tend to emit sequential titles
  // like "repro goal 22" or numbered smoke-test titles.
  const titles = await pool.query<{ title: string; n: string; sample_id: string }>(
    `
    SELECT title, COUNT(*) AS n, (ARRAY_AGG(id))[1] AS sample_id
    FROM goals
    GROUP BY title
    ORDER BY COUNT(*) DESC
    LIMIT 30
  `,
  )
  console.log('[probe] top 30 goal titles:')
  for (const r of titles.rows) {
    console.log(`  ${r.n.padStart(4)} ×  "${r.title}"  (e.g. ${r.sample_id})`)
  }

  // Which user_ids hold non-seed-titled goals? Bucket by user so we
  // can spot whether pollution lives on real personas or on ghost users.
  const byUser = await pool.query<{ user_id: string; n: string; name: string | null; is_guest: boolean | null }>(
    `
    SELECT g.user_id,
           COUNT(*) AS n,
           u.name,
           u.is_guest
    FROM goals g
    LEFT JOIN users u ON u.id = g.user_id
    GROUP BY g.user_id, u.name, u.is_guest
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `,
  )
  console.log('[probe] top 20 user_ids by goal count:')
  for (const r of byUser.rows) {
    console.log(
      `  ${r.n.padStart(4)} ×  ${r.user_id}  name="${r.name ?? ''}"  is_guest=${r.is_guest ?? 'unknown'}`,
    )
  }

  // Distinct user_ids whose goal titles look like repro pollution.
  // We use a permissive regex — anything that doesn't look like the
  // canonical seed titles from seed-personas.ts.
  const pollutedUserIds = await pool.query<{ user_id: string; n: string; name: string | null; is_guest: boolean | null }>(
    `
    SELECT g.user_id,
           COUNT(*) AS n,
           u.name,
           u.is_guest
    FROM goals g
    LEFT JOIN users u ON u.id = g.user_id
    WHERE g.title ~* 'repro|sample|smoke|debug|test ?goal|gc-|gc_|audit' OR
          g.title ~ '^goal[_-]?[0-9]+' OR
          g.title ~ '^[0-9]+$' OR
          LENGTH(g.title) <= 2
    GROUP BY g.user_id, u.name, u.is_guest
    ORDER BY COUNT(*) DESC
  `,
  )
  console.log('[probe] users holding polluted (repro-style) goal titles:')
  if (pollutedUserIds.rows.length === 0) {
    console.log('  (none)')
  } else {
    for (const r of pollutedUserIds.rows) {
      console.log(
        `  ${r.n.padStart(4)} ×  ${r.user_id}  name="${r.name ?? ''}"  is_guest=${r.is_guest ?? 'unknown'}`,
      )
    }
  }

  await pool.end()
}

main().catch(async (e) => {
  console.error('[probe] FATAL', e)
  try {
    await pool.end()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
