import { defineConfig } from 'drizzle-kit'
import { config as loadEnv } from 'dotenv'

// Load .env from project root so drizzle-kit picks up DATABASE_URL_UNPOOLED
// when running `pnpm db:generate` / `pnpm db:migrate` locally.
loadEnv({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL_UNPOOLED
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL_UNPOOLED is not set. drizzle-kit needs the unpooled Neon ' +
      'connection string for schema generation and migrations.'
  )
}

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
})
