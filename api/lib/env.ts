/**
 * Boot-time, zod-validated process.env loader.
 *
 * Source of truth for which env vars exist: migration/discovery/03-nextjs-
 * architecture.md Section 6 (Emergent-only world).
 *
 * Why this lives in `lib/env.ts` (server-only) and not `lib/env.shared.ts`:
 *   - `process.env` is server-side. Bundling it into a client component
 *     leaks `DATABASE_URL`, `EMERGENT_LLM_KEY`, etc. to the browser. Vercel's
 *     build will inline any module that touches `process.env`, so the only
 *     safe pattern is a separate file that runs only on the server.
 *   - `import { env } from '@/lib/env'` is therefore legal from Route
 *     Handlers, Server Actions, Server Components, and `lib/` modules.
 *     Do NOT import it from anything in `app/` that has `'use client'`.
 *
 * Required keys throw at boot (via top-level `env = EnvSchema.parse(...)`).
 * This is intentional — the architecture plan requires "Validate at boot
 * via `lib/env.ts` (zod) so a missing key crashes immediately rather than
 * at first request." Catching it at process start makes the deploy fail
 * fast in CI before it ever serves a request.
 */

import 'server-only'

import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

// Load .env from the project root in non-production environments. Vercel
// (production) injects env vars directly so this is a no-op there.
if (process.env.NODE_ENV !== 'production') {
  loadEnv({ path: '.env' })
}

const EnvSchema = z.object({
  // Runtime
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // Database (Neon). DATABASE_URL is required at runtime for the serverless
  // driver; DATABASE_URL_UNPOOLED is required only for migrations / drizzle-kit
  // (see drizzle.config.ts).
  DATABASE_URL: z.string().url(),
  DATABASE_URL_UNPOOLED: z.string().url().optional(),
  DATABASE_URL_DRIVER: z
    .enum(['neon-http', 'neon-ws', 'pg', 'auto'])
    .default('auto'),

  // Emergent — single key for auth + LLM + storage.
  // Starts with `sk-emergent-` per the Emergent proxy contract.
  EMERGENT_LLM_KEY: z.string().min(1),

  // Emergent integrations proxy URL. Defaults to
  // https://integrations.emergentagent.com — see lib/emergent/*.ts.
  INTEGRATION_PROXY_URL: z.string().url().optional(),

  // For 10-min guest_token HMAC signing.
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be >= 32 chars'),
  AUTH_URL: z.string().url().optional(),

  // ETL-only (db/migrate-from-mongo.ts). Optional in the Next.js runtime
  // because the migration script is the only thing that needs them.
  MONGODB_URL: z.string().url().optional(),
  MONGO_URL: z.string().url().optional(),
  DB_NAME: z.string().min(1).optional(),
  MONGO_DB_NAME: z.string().min(1).optional(),

  // Optional
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
  throw new Error(
    `[env] Invalid or missing environment variables:\n${issues}\n` +
      `See migration/discovery/03-nextjs-architecture.md Section 6 ` +
      `and .env.example for the full list.`
  )
}

export const env = parsed.data

export type Env = z.infer<typeof EnvSchema>