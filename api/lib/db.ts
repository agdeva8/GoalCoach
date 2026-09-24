/**
 * Drizzle client for GoalCoach.
 *
 * Per migration/discovery/03-nextjs-architecture.md Section 2, we use the
 * Neon serverless driver in production / on Vercel (where it integrates
 * natively with the edge / node serverless runtimes) and fall back to
 * `pg` for local development where running real network round-trips
 * against Neon from a long-lived process is wasteful.
 *
 * Driver selection is keyed off `DATABASE_URL_DRIVER`:
 *   - "neon-http"   -> @neondatabase/serverless, HTTP fetch transport
 *                      (cheapest, no connection pool; fine for one-shot
 *                      request handlers)
 *   - "neon-ws"     -> @neondatabase/serverless, WebSocket transport
 *                      (supports transactions + prepared statements)
 *   - "pg"          -> node-postgres via Pool (local dev default)
 *   - "auto" (default) -> "neon-ws" when DATABASE_URL contains
 *                         `.neon.` or `.neon.tech`, otherwise "pg"
 *
 * Why the pg fallback: devs running `pnpm dev` against a local Postgres
 * (or a non-Neon branch) shouldn't have to install / configure the Neon
 * client to get a working hot reload.
 */

import { neon, neonConfig, Pool as NeonPool } from '@neondatabase/serverless'
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http'
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { Pool as PgPool } from 'pg'
import ws from 'ws'

import { env } from '@/lib/env'
import * as schema from '@/db/schema'

export type DbDriver = 'neon-http' | 'neon-ws' | 'pg'

function resolveDriver(): DbDriver {
  const explicit = env.DATABASE_URL_DRIVER
  if (explicit === 'neon-http' || explicit === 'neon-ws' || explicit === 'pg') {
    return explicit
  }
  // auto
  if (env.DATABASE_URL.includes('.neon.tech') || env.DATABASE_URL.includes('.neon.')) {
    return 'neon-ws'
  }
  return 'pg'
}

function buildDb() {
  const driver = resolveDriver()

  switch (driver) {
    case 'neon-http': {
      const sql = neon(env.DATABASE_URL)
      return { db: drizzleHttp(sql, { schema, casing: 'snake_case' }), driver }
    }
    case 'neon-ws': {
      // Neon WS driver needs the `ws` shim in Node.js (browsers have it
      // natively). Lazy-load to avoid bundling `ws` for HTTP-only routes.
      neonConfig.webSocketConstructor = ws
      const pool = new NeonPool({ connectionString: env.DATABASE_URL })
      return { db: drizzleWs(pool, { schema, casing: 'snake_case' }), driver }
    }
    case 'pg': {
      const pool = new PgPool({ connectionString: env.DATABASE_URL })
      return { db: drizzlePg(pool, { schema, casing: 'snake_case' }), driver }
    }
  }
}

const built = buildDb()

/** Drizzle ORM client. Use this everywhere — never instantiate another. */
export const db = built.db

/** The driver this client was built with, for telemetry / health checks. */
export const dbDriver: DbDriver = built.driver

export { schema }

/**
 * Close the underlying connection pool.
 *
 * For `neon-http` (HTTP fetch transport) there is no pool to close and
 * this is a no-op. For `pg` and `neon-ws` we end the underlying Pool so
 * the script can exit cleanly without "unclean disconnect" warnings in
 * Postgres logs. Call from scripts at shutdown; in the Next.js runtime
 * the process lifetime owns the pool and you generally don't need this.
 */
export async function closeDb(): Promise<void> {
  const client = (db as any).$client
  if (client && typeof client.end === 'function') {
    await client.end()
  }
}
