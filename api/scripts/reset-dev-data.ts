#!/usr/bin/env tsx
/**
 * Dev-only — wipes the dev DB back to a clean founder baseline.
 *
 * Hard-gated on `process.env.ALLOW_DEV_LOGIN === 'true'`. Refuses to
 * run otherwise so this script can never be invoked against production
 * or any other live environment by accident.
 *
 * What "clean" means here:
 *   - Every `is_guest = true` row is deleted, plus their cascaded child
 *     rows (goals, milestones, commitments, blockers, messages, audit,
 *     sources, memories, proposals, conversations, timetable_blocks).
 *   - The two stray real-looking accounts the dev login button created
 *     during testing are deleted.
 *   - `user_founder01` is rebuilt from scratch so its `id`, `email`,
 *     `name`, `is_guest = false`, and `created_at` line up with what
 *     `app/api/auth/dev-login/route.ts` and the chat stream tests expect.
 *
 * Dry-run by default. Prints a per-user breakdown so the agent can
 * eyeball the blast radius before flipping `--confirm`. The agent has
 * pre-authorised `--confirm` for this slice; humans reviewing the
 * reset output should run dry-run first.
 *
 * Re-runnable. Subsequent runs are no-ops because the dry-run report
 * will show no guest users and no child rows. A second run with
 * `--confirm` after seeding personas will delete the persona rows too
 * — that's the intent: this script is the reset point for the whole
 * dev DB.
 *
 * Why not `import { db } from '@/lib/db'`: that module pulls in
 * `lib/env.ts` which has an `import 'server-only'` guard and crashes
 * when invoked from a CLI script outside the Next.js server runtime.
 * We open a `pg` pool directly so the script can run via `tsx`.
 *
 * Usage:
 *   pnpm tsx scripts/reset-dev-data.ts              # dry run
 *   pnpm tsx scripts/reset-dev-data.ts --confirm    # wipe + reseed founder
 */

import 'dotenv/config'

import pg from 'pg'

const ALLOW = process.env.ALLOW_DEV_LOGIN
const DATABASE_URL = process.env.DATABASE_URL
const FOUNDER_ID = 'user_founder01'

if (!DATABASE_URL) {
  console.error('[reset] DATABASE_URL is not set. Aborting.')
  process.exit(2)
}

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

interface UserSummary {
  id: string
  name: string | null
  is_guest: boolean
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
}

async function summariseUsers(): Promise<UserSummary[]> {
  const result = await pool.query<{
    id: string
    name: string | null
    is_guest: boolean
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
      COALESCE(tb.cnt, 0)      AS timetable_blocks
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
    ORDER BY u.created_at ASC
  `,
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
  }))
}

function fmtRow(s: UserSummary): string {
  const flag = s.is_guest ? 'guest' : 'REAL '
  return [
    `  ${flag} ${s.id}`,
    `name="${s.name ?? ''}"`,
    `goals=${s.goals}`,
    `milestones=${s.milestones}`,
    `commitments=${s.commitments}`,
    `blockers=${s.blockers}`,
    `messages=${s.messages}`,
    `proposals=${s.proposals}`,
    `audit=${s.audit}`,
    `sources=${s.sources}`,
    `memories=${s.memories}`,
    `conversations=${s.conversations}`,
    `timetable_blocks=${s.timetable_blocks}`,
  ].join('  ')
}

function printSummary(rows: UserSummary[]): void {
  console.log(`[reset] ${rows.length} user(s) found:`)
  for (const r of rows) console.log(fmtRow(r))
  const totals = rows.reduce(
    (acc, r) => ({
      goals: acc.goals + r.goals,
      milestones: acc.milestones + r.milestones,
      commitments: acc.commitments + r.commitments,
      blockers: acc.blockers + r.blockers,
      messages: acc.messages + r.messages,
      proposals: acc.proposals + r.proposals,
      audit: acc.audit + r.audit,
      sources: acc.sources + r.sources,
      memories: acc.memories + r.memories,
      conversations: acc.conversations + r.conversations,
      timetable_blocks: acc.timetable_blocks + r.timetable_blocks,
    }),
    {
      goals: 0,
      milestones: 0,
      commitments: 0,
      blockers: 0,
      messages: 0,
      proposals: 0,
      audit: 0,
      sources: 0,
      memories: 0,
      conversations: 0,
      timetable_blocks: 0,
    },
  )
  console.log('[reset] totals:', JSON.stringify(totals))
}

async function wipeAndReseedFounder(): Promise<void> {
  // Ordered deletion so FKs are respected without depending on
  // ON DELETE CASCADE for the founders' own rows. We start from the
  // deepest child (sources / audit / memories / timetable_blocks /
  // proposals / messages / conversations) and work up to users.
  console.log('[reset] wiping guest + stray real accounts + founder rows...')
  await pool.query(`DELETE FROM users WHERE is_guest = true`)
  // Stray accounts the dev-login button created during exploratory
  // testing. Both are real-looking OAuth accounts the user no longer
  // wants on the dev DB.
  await pool.query(
    `DELETE FROM users WHERE id IN ('user_3ef522ac8105', 'user_634ced887623')`,
  )
  // Wipe founder's child rows explicitly so the next INSERT can reuse
  // the same id without cascade surprises.
  const founderDeletes = [
    'timetable_blocks',
    'conversations',
    'proposals',
    'messages',
    'audit_log',
    'sources',
    'memories',
    'blockers',
    'commitments',
    'milestones',
    'goals',
    'user_sessions',
    'state_overrides',
    'accounts',
  ] as const
  for (const table of founderDeletes) {
    await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [FOUNDER_ID])
  }
  await pool.query(`DELETE FROM users WHERE id = $1`, [FOUNDER_ID])

  console.log(`[reset] re-creating ${FOUNDER_ID}...`)
  await pool.query(
    `
    INSERT INTO users (id, email, name, image, model_provider, is_guest, persona_key, persona_weight, created_at)
    VALUES ($1, $2, $3, NULL, 'gemini', false, 'founder', 10, NOW())
    ON CONFLICT (id) DO NOTHING
  `,
    [FOUNDER_ID, 'founder@sutra.local', 'Dev User'],
  )
  // Seed a general conversation so the chat UI has a thread to attach
  // to on the very first message — mirrors what the migration
  // backfill does for existing rows.
  await pool.query(
    `
    INSERT INTO conversations (id, user_id, kind, title, status, created_at, last_message_at)
    VALUES ($1, $2, 'general', '', 'open', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `,
    [`conv_general_${FOUNDER_ID}`, FOUNDER_ID],
  )
  console.log(
    `[reset] founder ${FOUNDER_ID} reseeded with persona_key='founder', persona_weight=10.`,
  )
}

async function main(): Promise<void> {
  if (ALLOW !== 'true') {
    console.error(
      '[reset] ALLOW_DEV_LOGIN must be "true" to run this script. Refusing to wipe the DB.',
    )
    process.exit(2)
  }

  const args = process.argv.slice(2)
  const confirm = args.includes('--confirm')

  console.log('[reset] scanning DB...')
  const rows = await summariseUsers()
  printSummary(rows)

  if (!confirm) {
    console.log('[reset] DRY RUN — pass --confirm to apply.')
    await pool.end()
    return
  }

  await wipeAndReseedFounder()

  console.log('[reset] post-reset scan:')
  const after = await summariseUsers()
  printSummary(after)
  console.log('[reset] done.')
  await pool.end()
}

main().catch(async (e) => {
  console.error('[reset] FATAL', e)
  try {
    await pool.end()
  } catch {
    /* ignore secondary errors */
  }
  process.exit(1)
})
