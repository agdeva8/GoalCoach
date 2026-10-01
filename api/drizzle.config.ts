import { defineConfig } from 'drizzle-kit'
import { config as loadEnv } from 'dotenv'

// Load .env from project root so drizzle-kit picks up DATABASE_URL / DATABASE_URL_UNPOOLED
// when running `pnpm db:generate` / `pnpm db:migrate` locally.
loadEnv({ path: '.env' })

// Prefer unpooled URL if provided; otherwise fallback to DATABASE_URL.
const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    'Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set. drizzle-kit needs a ' +
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
