#!/usr/bin/env tsx
/**
 * Adversarial repro for GC-AUTH-007: migrateGuestRowsToUser is non-transactional
 * and string-interpolates user IDs into UPDATE statements.
 *
 * Strategy:
 *  1. Insert a guest user + rows in 8 tables that the loop touches.
 *  2. Replay the EXACT SQL strings that auth.ts:258-264 builds, using the same
 *     single-quote escape. Inject a runtime failure midway through the loop
 *     (after `goals` UPDATE, before `audit_log` UPDATE) to simulate a partial
 *     migration.
 *  3. Inspect the post-failure state and report what data the guest left behind
 *     in the unmigrated tables.
 *  4. Then run the DELETE FROM users step (also unauthenticated) and observe
 *     whether ON DELETE CASCADE wipes the rows we never migrated.
 */

import 'dotenv/config'

import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const guestUserId = `user_repro_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`.slice(0, 64)
  const newUserId = `user_newp_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`.slice(0, 64)

  console.log(`[repro] guestUserId = ${guestUserId} (len=${guestUserId.length})`)
  console.log(`[repro] newUserId   = ${newUserId} (len=${newUserId.length})`)

  // Regex check: does the produced id contain any SQL meta-characters?
  // Both newId('user_<hex12>') and generateGuestUserId ('user_guest_<hex12>')
  // restrict chars to [a-z0-9_]; confirm.
  const metaChars = /['";\-\/]|--|\/\*|\*\//
  console.log(
    `[repro] guestId has SQL meta-chars? ${metaChars.test(guestUserId)} (chars: ${JSON.stringify([...guestUserId].filter(c => !/[a-z0-9_]/.test(c)))})`,
  )

  // 1. Create the guest user + the new user
  await pool.query(
    `INSERT INTO users (id, email, is_guest, model_provider) VALUES ($1, NULL, TRUE, 'gemini')`,
    [guestUserId],
  )
  await pool.query(
    `INSERT INTO users (id, email, is_guest, model_provider) VALUES ($1, NULL, FALSE, 'gemini')`,
    [newUserId],
  )

  // 2. Seed one row per table the loop touches
  const tables = ['goals', 'commitments', 'milestones', 'blockers', 'messages', 'audit_log', 'sources', 'state_overrides']
  const seededRows: Record<string, string> = {}

  // goals (id text PK, user_id FK, title required)
  seededRows.goals = `goal_repro_${Date.now()}`
  await pool.query(
    `INSERT INTO goals (id, user_id, title, horizon) VALUES ($1, $2, 'test goal', 'weekly')`,
    [seededRows.goals, guestUserId],
  )
  // commitments (id text PK, user_id FK, text required, goal_title default '')
  seededRows.commitments = `commit_repro_${Date.now()}`
  await pool.query(
    `INSERT INTO commitments (id, user_id, text, goal_title) VALUES ($1, $2, 'test commit', '')`,
    [seededRows.commitments, guestUserId],
  )
  // milestones (id text PK, user_id FK, title required)
  seededRows.milestones = `mile_repro_${Date.now()}`
  await pool.query(
    `INSERT INTO milestones (id, user_id, title) VALUES ($1, $2, 'test mile')`,
    [seededRows.milestones, guestUserId],
  )
  // blockers (id text PK, user_id FK, title required)
  seededRows.blockers = `block_repro_${Date.now()}`
  await pool.query(
    `INSERT INTO blockers (id, user_id, title, start_date, note) VALUES ($1, $2, 'test blocker', CURRENT_DATE, '')`,
    [seededRows.blockers, guestUserId],
  )
  // messages (need to know columns)
  const messagesCols = await pool.query<{ column_name: string; is_nullable: string }>(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='messages' ORDER BY ordinal_position`,
  )
  const reqMessagesCols: Record<string, string> = {}
  for (const c of messagesCols.rows) {
    if (c.is_nullable === 'NO') reqMessagesCols[c.column_name] = 'NOT NULL'
  }
  console.log('[repro] messages NOT NULL cols:', JSON.stringify(reqMessagesCols))
  // messages (FK to conversations)
  await pool.query(
    `INSERT INTO conversations (id, user_id, kind, title, status) VALUES ($1, $2, 'general', 'General', 'open') ON CONFLICT (id) DO NOTHING`,
    [`conv_general_${guestUserId}`, guestUserId],
  )
  seededRows.messages = `msg_repro_${Date.now()}`
  await pool.query(
    `INSERT INTO messages (id, user_id, role, content, conversation_id) VALUES ($1, $2, 'user', 'test msg', $3)`,
    [seededRows.messages, guestUserId, `conv_general_${guestUserId}`],
  )
  // audit_log
  seededRows.audit_log = `audit_repro_${Date.now()}`
  await pool.query(
    `INSERT INTO audit_log (id, user_id, type, summary, payload) VALUES ($1, $2, 'test', 'repro summary', '{}'::jsonb)`,
    [seededRows.audit_log, guestUserId],
  )
  // sources
  seededRows.sources = `src_repro_${Date.now()}`
  await pool.query(
    `INSERT INTO sources (id, user_id, kind, original_filename, content_type) VALUES ($1, $2, 'link', 'repro.html', 'text/html')`,
    [seededRows.sources, guestUserId],
  )
  // state_overrides (id text PK, user_id FK)
  seededRows.state_overrides = `stov_repro_${Date.now()}`
  await pool.query(
    `INSERT INTO state_overrides (id, user_id) VALUES ($1, $2)`,
    [seededRows.state_overrides, guestUserId],
  )

  console.log('[repro] seeded rows in 8 tables:', JSON.stringify(seededRows))

  // 3. PRE-state: every table has its row bound to the GUEST user
  for (const t of tables) {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE user_id = $1`, [
      guestUserId,
    ])
    console.log(`[before]  ${t}: ${r.rows[0].n} rows owned by guest`)
  }

  // 4. Replay the EXACT buggy loop from auth.ts:258-264. To simulate the
  //    "kill the process between goals (idx 0) and audit_log (idx 5) UPDATE"
  //    scenario from the bug's reproduction recipe, we throw AFTER the
  //    goal/commit/milestone/blocker UPDATEs but BEFORE the rest.
  let migratedCount = 0
  try {
    for (const t of tables) {
      const stmt = `UPDATE ${t} SET user_id = '${newUserId.replace(/'/g, "''")}' WHERE user_id = '${guestUserId.replace(/'/g, "''")}'`
      console.log(`[loop]     ${stmt.slice(0, 100)}...`)
      await pool.query(stmt)
      migratedCount++
      if (t === 'blockers') {
        // Simulated failure: process killed between blockers (idx 3) and messages (idx 4)
        throw new Error('SIGKILL mid-loop (simulated between blockers and messages)')
      }
    }
  } catch (e) {
    console.log(`[crash]   loop aborted after ${migratedCount} UPDATEs: ${(e as Error).message}`)
  }

  // 5. POST-state: which tables have been reassigned, which still point at guest?
  console.log(`\n[after crash, BEFORE DELETE]`)
  for (const t of tables) {
    const guestN = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE user_id = $1`, [guestUserId])).rows[0].n
    const newN = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE user_id = $1`, [newUserId])).rows[0].n
    console.log(`  ${t.padEnd(18)} guest=${guestN}  new=${newN}  ${guestN > 0 ? 'ORPHANED (still guest)' : newN > 0 ? 'MIGRATED' : '???'}`)
  }

  // 6. Now run the two DELETE steps that the loop WOULD HAVE run if it
  //    hadn't crashed. These use the parameterized `sql` template, so they
  //    don't depend on the loop completing. The DELETE FROM users cascades
  //    to ALL rows still pointing at the guest user, including unmigrated
  //    tables.
  console.log(`\nrunning DELETE FROM users WHERE id = $guestUserId (CASCADE wipes unmigrated rows)`)
  await pool.query(`DELETE FROM users WHERE id = $1 AND is_guest = TRUE`, [guestUserId])
  await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [guestUserId])

  console.log(`\n[after DELETE FROM users + cascade]`)
  for (const t of tables) {
    const guestN = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE user_id = $1`, [guestUserId])).rows[0].n
    const newN = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE user_id = $1`, [newUserId])).rows[0].n
    console.log(`  ${t.padEnd(18)} guest=${guestN}  new=${newN}  ${guestN + newN === 1 ? 'survived exactly 1 row ✓' : `DATA LOSS — original row(s) gone (was 1, now ${guestN + newN})`}`)
  }

  console.log(`\nverdict:`)
  const survivors = await Promise.all(
    tables.map(t =>
      pool
        .query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE user_id = $1`, [newUserId])
        .then(r => r.rows[0].n),
    ),
  )
  const losses = tables.filter((_, i) => survivors[i] === 0)
  console.log(`  survived (now owned by new user): ${tables.filter((_, i) => survivors[i] === 1).join(', ') || '(none)'}`)
  console.log(`  LOST (guest rows deleted by cascade, never migrated): ${losses.join(', ') || '(none)'}`)

  // Cleanup test rows
  await pool.query(`DELETE FROM goals WHERE id = $1`, [seededRows.goals])
  await pool.query(`DELETE FROM users WHERE id = $1`, [newUserId])
  console.log(`\n[repro] cleanup done`)
  await pool.end()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
