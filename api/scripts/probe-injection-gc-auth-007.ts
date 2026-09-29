#!/usr/bin/env tsx
/**
 * Probe: does migrateGuestRowsToUser's loop survive if a guest ID contains
 * SQL meta-characters? We bypass the normal ID generators (which restrict
 * to `[a-z0-9_]`) and seed one directly. The point is NOT that production
 * does this — current callers don't — but to confirm the escape mechanism
 * in auth.ts:259-263 is the only thing standing between us and injection.
 */
import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  // Various SQL meta-character payloads. randomUUID produces hex + dashes,
  // but the bug description asserts "-- can appear in a UUID segment" — verify
  // that claim too.
  const uuidWithDashes = `user_${Math.random().toString(36).slice(2)}` // not a real UUID, will be ~same shape
  // Force a payload that includes the chars the bug description worries about.
  const evil = `'; DROP TABLE users; --`
  // Trust the random-Base36 output: it ends up matching `[a-z0-9]+` so
  // that proves the *current* generators are safe but tells us nothing
  // about the loop's robustness. Insert an evil row pointing at a
  // user_id-style literal that we'd never produce in code but a
  // misconfigured admin migration could:
  const guestId = "evil_user'; DROP TABLE users; --"
  const newId = "user_newp_attacker_admin"

  console.log(`[probe] guest ID literal: ${JSON.stringify(guestId)}`)

  // Try to insert a user whose id contains the literal string.
  // Postgres can store most strings. Escape the single quotes for SQL.
  const sqlLit = guestId.replace(/'/g, "''")
  try {
    await pool.query(
      `INSERT INTO users (id, is_guest, model_provider) VALUES ('${sqlLit}', TRUE, 'gemini')`,
    )
    console.log('[probe] inserted evil-id user')
  } catch (e) {
    console.log(`[probe] insert evil-id failed: ${(e as Error).message}`)
  }

  // Now replay the auth.ts:258-264 UPDATE loop with this id. The .replace()
  // double-escapes the quote, so Postgres sees a single quote literal that
  // closes cleanly. Result: the row IS reassigned. But what about a payload
  // that includes line comments `--`? randomUUID uses dashes between hex
  // groups -- but those aren't at the start of a line. Let's instead test
  // by simulating a column reference injection.
  const guestId2 = `guest_x\`; UPDATE users SET model_provider='evil' WHERE '1'='1`
  console.log(`[probe] second guest ID: ${JSON.stringify(guestId2)}`)
  const sqlLit2 = guestId2.replace(/'/g, "''")
  try {
    await pool.query(`INSERT INTO users (id, is_guest, model_provider) VALUES ('${sqlLit2}', TRUE, 'gemini')`)
    console.log('[probe] inserted injection-attempt user')
  } catch (e) {
    console.log(`[probe] insert 2 failed: ${(e as Error).message}`)
  }

  // Cleanup
  for (const id of [guestId, guestId2]) {
    try { await pool.query(`DELETE FROM users WHERE id = $1`, [id]) } catch {}
  }
  await pool.end()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
