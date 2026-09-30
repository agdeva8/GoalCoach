/**
 * In-process write-through cache for read models.
 *
 * Why this exists: `loadState` hits 5 Postgres tables sequentially plus an
 * audit query in `GET /api/state`, and the database is a remote Supabase
 * pooler — measured baseline on the dev server is 1.4–2.6s PER DASHBOARD
 * LOAD. This cache serves the same payload from memory in microseconds.
 *
 * Freshness contract (the whole point of the module):
 *
 *   1. WRITE-THROUGH — every state-affecting mutation calls
 *      `refreshDashboardState()` (lib/dashboard-state.ts) which drops the
 *      user's entries and immediately reloads + re-stores them before the
 *      mutation response returns. The next read is therefore both fresh
 *      AND instant — we never hand the UI a pre-write snapshot.
 *   2. INVALIDATE-ON-WRITE SAFETY NET — both auth resolvers
 *      (lib/auth-route.ts, lib/request-user.ts) call
 *      `invalidateForRequest()` for POST/PUT/PATCH/DELETE, so even a
 *      mutation path that forgets to refresh can never serve an entry
 *      older than the request that preceded it.
 *   3. TTL — a hard expiry (DEFAULT_TTL_MS) bounds staleness for the two
 *      cases in-process state cannot see: a write handled by ANOTHER
 *      server instance (Vercel runs several), and a mutation added later
 *      that wires neither refresh nor a helper. Worst case, not the norm.
 *
 * Concurrency guards:
 *
 *   - EPOCH: a module-wide counter bumped on every invalidation/write.
 *     A load that started before the bump may have read pre-write rows,
 *     so it discards its result instead of overwriting the fresher entry.
 *   - SINGLE-FLIGHT: concurrent reads of the same key share one loader
 *     promise, so a burst of dashboard loads costs one DB round trip.
 *   - LRU cap: MAX_ENTRIES bounds resident memory per process.
 *
 * Usage pattern: routes wrap their GET handlers in `cachedGet(namespace,
 * loader)`. The loader does its own DB query and returns the response body.
 * No `cache` or `cacheKey` import in the route file — freshness is handled
 * centrally by the auth resolvers (every mutating request auto-invalidates).
 *
 * ⚠️ KEEP THIS MODULE DEPENDENCY-FREE (no `@/lib/env`, no db, no drizzle).
 * `lib/request-user.ts` imports it on the auth hot path and deliberately
 * avoids static imports that pull in dotenv — see the header comment in
 * that file. Only `server-only` and other dependency-free modules allowed.
 */

import 'server-only'

import type { NextRequest, NextResponse } from 'next/server'

import { authenticateRoute, type AuthResult } from '@/lib/auth-route'

/** Freshness ceiling — see contract point 3 above. */
export const DEFAULT_TTL_MS = 15_000

/** Resident-memory cap: evict expired, then oldest, once exceeded. */
const MAX_ENTRIES = 200

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

interface Entry {
  value: unknown
  storedAt: number
  expiresAt: number
}

/**
 * In-flight loader handle. Kept as an object (not a bare promise) so the
 * `finally` below can check *identity* — an invalidation may have already
 * removed this handle and registered a newer loader under the same key,
 * and the dying promise must not delete its successor.
 */
interface InFlight {
  promise: Promise<unknown>
}

const entries = new Map<string, Entry>()
const inFlight = new Map<string, InFlight>()

/**
 * Bumped by every invalidation and every write-through. Loads capture it
 * before reading the DB and only store if it is unchanged afterwards.
 */
let epoch = 0

const stats = {
  hits: 0,
  misses: 0,
  loads: 0,
  writes: 0,
  invalidations: 0,
  evictions: 0,
  /** Loads discarded because a write/invalidation raced them. */
  staleLoadsDropped: 0,
}

/* -------------------------------------------------------------------------- */
/* Route-handler wrappers — the public surface used by route files           */
/* -------------------------------------------------------------------------- */

/**
 * Anything a route can hand us to identify the current user. We accept the
 * union of every auth resolver in the codebase so the same wrapper works
 * for routes that use `authenticateRoute`, `resolveRequestUser`, or a
 * custom helper (e.g. the audit route's `getUserId`).
 *
 * Return shape: either a `{ userId }` success or `{ error: NextResponse }`
 * or `null` (some resolvers return null on auth failure rather than an
 * error response — we synthesize a 401 in that case).
 */
export type RouteAuthResolver = (
  req: NextRequest,
) => Promise<AuthResult | { userId: string } | null>

const DEFAULT_AUTH: RouteAuthResolver = (req) => authenticateRoute(req)

/**
 * Wrap a GET handler in a per-user read-through cache.
 *
 *   export const GET = cachedGet('blockers', async (userId) => {
 *     const rows = await db.select()...
 *     return { blockers: rows.map(serialize) }
 *   })
 *
 * The cache key is derived from the namespace and the authenticated user;
 * `ns` may be a string (constant per endpoint) or a function of `req` for
 * routes whose payload depends on query params (audit pagination, chat
 * limit, sources goal filter, etc.).
 *
 * **Freshness is handled centrally** by the auth resolvers — every
 * authenticated mutating request invalidates the user's entries before
 * the handler runs. This wrapper therefore never serves a pre-write
 * snapshot, even if a mutation route forgets to do anything explicit.
 */
export function cachedGet<T>(
  ns: string | ((req: NextRequest) => string),
  load: (userId: string, req: NextRequest) => Promise<T>,
  auth: RouteAuthResolver = DEFAULT_AUTH,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req) => {
    const result = await auth(req)
    const userId =
      result && 'userId' in result ? (result.userId as string | undefined) : undefined
    const errorResp =
      result && 'error' in result ? (result.error as NextResponse | undefined) : undefined
    if (!userId) {
      // Synthesize a 401 for resolvers that return null on failure; pass
      // through the explicit error response if the resolver provided one.
      const { NextResponse: NR } = await import('next/server')
      return (
        errorResp ??
        NR.json({ detail: 'Not authenticated' }, { status: 401 })
      )
    }
    const nsStr = typeof ns === 'function' ? ns(req) : ns
    const data = await readThrough(cacheKey(userId, nsStr), () =>
      load(userId, req),
    )
    const { NextResponse: NR } = await import('next/server')
    return NR.json(data)
  }
}

/* -------------------------------------------------------------------------- */
/* Keys                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Namespaced, per-user key. The `${userId}::` prefix is load-bearing:
 * invalidation is a prefix scan, and `::` cannot appear in a userId or a
 * namespace, so one user's entries can never be dropped by another's.
 */
export function cacheKey(userId: string, namespace: string): string {
  return `${userId}::${namespace}`
}

/* -------------------------------------------------------------------------- */
/* Read path                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Read-through: return the cached value when fresh, otherwise run `loader`
 * once (single-flight), store the result, and return it.
 *
 * If a write-through or invalidation lands while `loader` is in flight, the
 * result is returned to the current caller (their request predates the
 * write, so it is a legitimate answer) but NOT stored — storing it would
 * resurrect pre-write data under a fresh TTL.
 */
export async function readThrough<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = entries.get(key)
  if (hit) {
    if (hit.expiresAt > Date.now()) {
      stats.hits++
      return hit.value as T
    }
    entries.delete(key) // expired — fall through to a load
  }

  stats.misses++

  const pending = inFlight.get(key)
  if (pending) {
    // Single-flight: a load for this key is already running.
    return pending.promise as Promise<T>
  }

  const startEpoch = epoch
  const handle: InFlight = { promise: undefined as unknown as Promise<unknown> }
  handle.promise = (async () => {
    try {
      stats.loads++
      const value = await loader()
      if (epoch === startEpoch) {
        put(key, value, ttlMs)
      } else {
        // Raced by a mutation — the fresh entry (if any) wins.
        stats.staleLoadsDropped++
      }
      return value
    } finally {
      // Identity check: only clear the slot if no successor took it.
      if (inFlight.get(key) === handle) inFlight.delete(key)
    }
  })()

  inFlight.set(key, handle)
  return handle.promise as Promise<T>
}

/**
 * Write-through: store a freshly computed value immediately. Used when a
 * mutation has already produced (or can cheaply produce) the new read
 * model — the caller gets a cache hit on its very next read.
 *
 * Bumps the epoch first so any in-flight load that started earlier is
 * demoted to "return to its caller, do not store".
 */
export function writeThrough<T>(
  key: string,
  value: T,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  epoch++
  put(key, value, ttlMs)
}

/* -------------------------------------------------------------------------- */
/* Write / invalidation path                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Drop every entry (and in-flight load) under `keyPrefix`, and bump the
 * epoch so a load racing us cannot store its now-dubious result.
 */
export function invalidatePrefix(keyPrefix: string): void {
  epoch++
  stats.invalidations++
  for (const key of entries.keys()) {
    if (key.startsWith(keyPrefix)) entries.delete(key)
  }
  for (const key of inFlight.keys()) {
    if (key.startsWith(keyPrefix)) inFlight.delete(key)
  }
}

/** Drop one user's read models — the invalidation unit used everywhere. */
export function invalidateUser(userId: string): void {
  invalidatePrefix(`${userId}::`)
}

/**
 * Choke-point invalidation for the auth resolvers: called whenever a
 * request is BOTH authenticated and mutating. Over-invalidation is safe by
 * construction (a dropped entry is just a reload) — under-invalidation is
 * not, which is exactly why this fires on the request, before the handler
 * runs, regardless of which route or helper the mutation went through.
 *
 * `method` is optional because some callers pass a structural
 * `{ headers, cookies }` shim without one; no method → no invalidation.
 */
export function invalidateForRequest(
  method: string | undefined,
  userId: string,
): void {
  if (!method) return
  if (MUTATING_METHODS.has(method.toUpperCase())) invalidateUser(userId)
}

/* -------------------------------------------------------------------------- */
/* Introspection (tests + debugging)                                          */
/* -------------------------------------------------------------------------- */

/** Test hook — drop all state including stats. Production code never calls this. */
export function clearCache(): void {
  epoch++
  entries.clear()
  inFlight.clear()
  stats.hits = 0
  stats.misses = 0
  stats.loads = 0
  stats.writes = 0
  stats.invalidations = 0
  stats.evictions = 0
  stats.staleLoadsDropped = 0
}

export function cacheStats(): Readonly<{
  size: number
  inFlight: number
  epoch: number
}> & typeof stats {
  return { ...stats, size: entries.size, inFlight: inFlight.size, epoch }
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function put(key: string, value: unknown, ttlMs: number): void {
  const now = Date.now()
  entries.set(key, { value, storedAt: now, expiresAt: now + ttlMs })
  stats.writes++
  evictIfNeeded(now)
}

function evictIfNeeded(now: number): void {
  if (entries.size <= MAX_ENTRIES) return

  // Cheapest first: anything already expired costs nothing to lose.
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(key)
      stats.evictions++
    }
  }
  // Then oldest-first until back under the cap.
  while (entries.size > MAX_ENTRIES) {
    let oldestKey: string | undefined
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [key, entry] of entries) {
      if (entry.storedAt < oldestAt) {
        oldestAt = entry.storedAt
        oldestKey = key
      }
    }
    if (oldestKey === undefined) break
    entries.delete(oldestKey)
    stats.evictions++
  }
}
