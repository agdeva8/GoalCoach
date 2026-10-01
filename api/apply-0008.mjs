import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env' })
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const sql = readFileSync('./db/migrations/0008_motivation_pipeline.sql', 'utf8')
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) { throw new Error('No DATABASE_URL') }
console.log('Connecting…')
const client = new Client({ connectionString: url })
await client.connect()
console.log('Connected.')
try {
  await client.query(sql)
  console.log('OK — 0008 applied')
  const r = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'motivation_%' ORDER BY table_name")
  console.log('Tables present:', r.rows.map(x => x.table_name).join(', '))
} finally {
  await client.end()
}
