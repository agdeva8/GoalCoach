#!/usr/bin/env tsx
/**
 * Seed a single pending `add_commitment` proposal for the TOCTOU race
 * repro. Connects directly via pg (same DATABASE_URL as the running
 * Next.js server) so we can reproduce without standing up an LLM call.
 *
 * Idempotent: re-uses the same proposal id if the row already exists,
 * but resets it to status='pending' so each run of the repro starts
 * from a clean state.
 */
/* env is supplied via DATABASE_URL on the command line */
import pg from 'pg'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}

const USER_ID = 'user_test_race_001'
const PROPOSAL_ID = `prop_race_${Date.now()}`
const CONVERSATION_ID = `conv_race_${USER_ID}`
const MESSAGE_ID = `msg_race_${Date.now()}`
const COMMIT_TEXT = `race-test-${Date.now()}`

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  try {
    // Ensure user row.
    await pool.query(
      `INSERT INTO users (id, email, name, is_guest, model_provider)
       VALUES ($1, $1 || '@dev.local', 'Race Test', false, 'gemini')
       ON CONFLICT (id) DO NOTHING`,
      [USER_ID],
    )

    // Ensure conversation row.
    await pool.query(
      `INSERT INTO conversations (id, user_id, title, created_at)
       VALUES ($1, $2, 'Race Repro', NOW())
       ON CONFLICT (id) DO NOTHING`,
      [CONVERSATION_ID, USER_ID],
    )

    // Ensure message row.
    await pool.query(
      `INSERT INTO messages (id, conversation_id, user_id, role, content, created_at)
       VALUES ($1, $2, $3, 'assistant', 'race repro', NOW())`,
      [MESSAGE_ID, CONVERSATION_ID, USER_ID],
    )

    // Drop any prior commitments from earlier runs of the repro.
    await pool.query(
      `DELETE FROM commitments WHERE user_id = $1 AND text LIKE 'race-test-%'`,
      [USER_ID],
    )

    // Drop any prior proposals from earlier runs (we want a fresh id
    // each time so committed rows can't accidentally cover the prior
    // race).
    await pool.query(
      `DELETE FROM proposals WHERE user_id = $1 AND id LIKE 'prop_race_%'`,
      [USER_ID],
    )

    // Insert the pending proposal.
    await pool.query(
      `INSERT INTO proposals
         (id, message_id, conversation_id, user_id, action, args, status, created_at)
       VALUES ($1, $2, $3, $4, 'add_commitment',
               $5::jsonb, 'pending', NOW())`,
      [
        PROPOSAL_ID,
        MESSAGE_ID,
        CONVERSATION_ID,
        USER_ID,
        JSON.stringify({ text: COMMIT_TEXT }),
      ],
    )

    console.log(JSON.stringify({
      user_id: USER_ID,
      proposal_id: PROPOSAL_ID,
      commit_text: COMMIT_TEXT,
    }))
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
