/**
 * Unit tests for lib/cache.ts — the in-process write-through cache.
 *
 * These tests are deliberately framework-free (no drizzle, no Next):
 * cache.ts is a pure data-structure module whose only external dep is
 * `server-only`. Anything that depends on the DB or the route layer is
 * exercised by the dashboard-state and state-route integration tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cacheKey,
  cacheStats,
  clearCache,
  DEFAULT_TTL_MS,
  invalidateForRequest,
  invalidateUser,
  readThrough,
  writeThrough,
} from '@/lib/cache'

const ALICE = 'user_alice'
const BOB = 'user_bob'

let loader: ReturnType<typeof vi.fn>
let aliceValue: unknown
let bobValue: unknown

beforeEach(() => {
  clearCache()
  loader = vi.fn()
  aliceValue = { id: 'a1', goals: 3 }
  bobValue = { id: 'b1', goals: 7 }
})

afterEach(() => {
  vi.useRealTimers()
})

/* -------------------------------------------------------------------------- */
/* readThrough                                                               */
/* -------------------------------------------------------------------------- */

describe('readThrough', () => {
  it('loads on miss, stores, and returns the cached value on hit', async () => {
    loader.mockResolvedValue(aliceValue)
    const k = cacheKey(ALICE, 'state')

    const first = await readThrough(k, loader)
    expect(first).toBe(aliceValue)
    expect(loader).toHaveBeenCalledTimes(1)

    const second = await readThrough(k, loader)
    expect(second).toBe(aliceValue)
    expect(loader).toHaveBeenCalledTimes(1) // still 1 — hit served from cache

    const s = cacheStats()
    expect(s.hits).toBe(1)
    expect(s.misses).toBe(1)
    expect(s.loads).toBe(1)
  })

  it('separates namespaces per user', async () => {
    loader.mockImplementation((req: { who?: 'a' | 'b' }) =>
      req.who === 'a' ? Promise.resolve(aliceValue) : Promise.resolve(bobValue),
    )
    const a = readThrough(cacheKey(ALICE, 'state'), () =>
      loader({ who: 'a' }),
    )
    const b = readThrough(cacheKey(BOB, 'state'), () => loader({ who: 'b' }))
    expect(await a).toBe(aliceValue)
    expect(await b).toBe(bobValue)
  })

  it('expires after ttlMs — next read reloads', async () => {
    vi.useFakeTimers()
    loader.mockResolvedValue(aliceValue)
    const k = cacheKey(ALICE, 'state')

    await readThrough(k, loader, 1_000)
    expect(loader).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(999)
    await readThrough(k, loader, 1_000)
    expect(loader).toHaveBeenCalledTimes(1) // still fresh

    vi.advanceTimersByTime(2)
    await readThrough(k, loader, 1_000)
    expect(loader).toHaveBeenCalledTimes(2) // expired → reload
  })

  it('single-flight: concurrent reads of the same key share one loader', async () => {
    let resolveLoader!: (v: unknown) => void
    loader.mockImplementation(
      () =>
        new Promise((res) => {
          resolveLoader = res
        }),
    )
    const k = cacheKey(ALICE, 'state')

    const p1 = readThrough(k, loader)
    const p2 = readThrough(k, loader)
    const p3 = readThrough(k, loader)

    resolveLoader(aliceValue)
    const [v1, v2, v3] = await Promise.all([p1, p2, p3])
    expect([v1, v2, v3]).toEqual([aliceValue, aliceValue, aliceValue])
    expect(loader).toHaveBeenCalledTimes(1)
    expect(cacheStats().loads).toBe(1)
  })

  it('does not store when an invalidation races the loader (epoch guard)', async () => {
    let resolveLoader!: (v: unknown) => void
    loader.mockImplementation(
      () =>
        new Promise((res) => {
          resolveLoader = res
        }),
    )
    const k = cacheKey(ALICE, 'state')

    const pending = readThrough(k, loader)

    // Raced write: someone else mutated and invalidated before we
    // resolved. A real implementation uses scheduleWriteThroughRefresh
    // for this; here we drive it directly.
    invalidateUser(ALICE)

    resolveLoader(aliceValue) // stale value — pre-write
    await pending

    // After the race the entry must NOT exist; a fresh read must miss.
    loader.mockResolvedValue(bobValue)
    const fresh = await readThrough(k, loader)
    expect(fresh).toBe(bobValue)
    expect(cacheStats().staleLoadsDropped).toBe(1)
  })

  it('propagates loader errors and leaves the cache cold', async () => {
    loader.mockRejectedValueOnce(new Error('boom'))
    const k = cacheKey(ALICE, 'state')

    await expect(readThrough(k, loader)).rejects.toThrow('boom')
    expect(cacheStats().loads).toBe(1)
    expect(cacheStats().size).toBe(0) // nothing stored

    loader.mockResolvedValue(aliceValue)
    expect(await readThrough(k, loader)).toBe(aliceValue)
    expect(cacheStats().loads).toBe(2)
  })
})

/* -------------------------------------------------------------------------- */
/* writeThrough                                                              */
/* -------------------------------------------------------------------------- */

describe('writeThrough', () => {
  it('stores the value so the next read returns it without loading', async () => {
    const k = cacheKey(ALICE, 'state')
    writeThrough(k, aliceValue)

    expect(loader).not.toHaveBeenCalled()
    expect(await readThrough(k, loader)).toBe(aliceValue)
    expect(loader).not.toHaveBeenCalled()
    expect(cacheStats().writes).toBe(1)
  })

  it('bumps the epoch so a pre-write in-flight load does not overwrite', async () => {
    let resolveLoader!: (v: unknown) => void
    loader.mockImplementation(
      () =>
        new Promise((res) => {
          resolveLoader = res
        }),
    )
    const k = cacheKey(ALICE, 'state')

    const stale = readThrough(k, loader)
    writeThrough(k, aliceValue) // newer writer wins
    resolveLoader(bobValue) // stale value arrives after the write
    await stale

    // The fresh value must still be there, not bobValue.
    expect(await readThrough(k, loader)).toBe(aliceValue)
    expect(cacheStats().staleLoadsDropped).toBe(1)
  })
})

/* -------------------------------------------------------------------------- */
/* Invalidation                                                              */
/* -------------------------------------------------------------------------- */

describe('invalidateUser', () => {
  it('drops every namespace for the user, leaves others untouched', async () => {
    loader.mockImplementation((ns: string) =>
      Promise.resolve(ns === 'state' ? aliceValue : bobValue),
    )
    await readThrough(cacheKey(ALICE, 'state'), () => loader('state'))
    await readThrough(cacheKey(ALICE, 'coach'), () => loader('coach'))
    await readThrough(cacheKey(BOB, 'state'), () => loader('state'))
    expect(cacheStats().size).toBe(3)

    invalidateUser(ALICE)
    expect(cacheStats().size).toBe(1) // BOB's entry survives

    loader.mockClear()
    loader.mockResolvedValue(aliceValue)
    await readThrough(cacheKey(ALICE, 'state'), loader)
    expect(loader).toHaveBeenCalledTimes(1) // alice had to reload
  })

  it('clears any in-flight loaders for the invalidated namespace', async () => {
    let resolveLoader!: (v: unknown) => void
    loader.mockImplementation(
      () =>
        new Promise((res) => {
          resolveLoader = res
        }),
    )
    const k = cacheKey(ALICE, 'state')

    const stale = readThrough(k, loader) // starts a load under alice
    expect(cacheStats().inFlight).toBe(1)

    invalidateUser(ALICE)
    expect(cacheStats().inFlight).toBe(0) // the in-flight slot is gone

    // A new caller must NOT reuse the doomed promise — they start fresh.
    loader.mockResolvedValueOnce(bobValue)
    const fresh = readThrough(k, loader)
    resolveLoader(aliceValue) // the old promise eventually settles
    await stale
    const freshVal = await fresh
    expect(freshVal).toBe(bobValue)
  })
})

describe('invalidateForRequest', () => {
  it('fires for POST/PUT/PATCH/DELETE and stays quiet for GET/HEAD/OPTIONS', () => {
    loader.mockResolvedValue(aliceValue)

    return (async () => {
      await readThrough(cacheKey(ALICE, 'state'), loader)
      expect(cacheStats().size).toBe(1)

      for (const m of ['GET', 'HEAD', 'OPTIONS', undefined, '']) {
        invalidateForRequest(m, ALICE)
        expect(cacheStats().size).toBe(1) // untouched
      }

      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
        invalidateForRequest(m, ALICE)
        await readThrough(cacheKey(ALICE, 'state'), loader) // repopulate
        expect(cacheStats().size).toBe(1)
        invalidateForRequest(m, ALICE)
        expect(cacheStats().size).toBe(0) // each mutating method drops it
        await readThrough(cacheKey(ALICE, 'state'), loader)
      }
      expect(loader.mock.calls.length).toBeGreaterThanOrEqual(8)
    })()
  })
})

/* -------------------------------------------------------------------------- */
/* Sanity                                                                    */
/* -------------------------------------------------------------------------- */

it('DEFAULT_TTL_MS is the documented 15-second safety net', () => {
  expect(DEFAULT_TTL_MS).toBe(15_000)
})

/* -------------------------------------------------------------------------- */
/* cachedGet wrapper                                                          */
/* -------------------------------------------------------------------------- */

import type { NextRequest } from 'next/server'

describe('cachedGet', () => {
  it('wraps a GET handler so repeated calls hit the cache', async () => {
    const loader = vi.fn().mockResolvedValue({ items: ['a', 'b'] })

    const { cachedGet } = await import('@/lib/cache')
    const handler = cachedGet('items', async (userId) => {
      expect(userId).toBe(ALICE)
      return loader(userId)
    })
    // Vitest sets NODE_ENV='test', so the default resolver accepts any
    // `Bearer <token>` as a userId. Use that instead of mocking auth.
    const req = {
      url: 'http://test/api/items',
      headers: { get: (h: string) => (h === 'authorization' ? `Bearer ${ALICE}` : null) },
      cookies: { get: () => undefined },
      method: 'GET',
    } as unknown as NextRequest

    const r1 = await handler(req)
    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ items: ['a', 'b'] })
    expect(loader).toHaveBeenCalledTimes(1)

    const r2 = await handler(req)
    expect(await r2.json()).toEqual({ items: ['a', 'b'] })
    expect(loader).toHaveBeenCalledTimes(1) // cache hit
  })

  it('derives the namespace from a request when given a function', async () => {
    const { cachedGet } = await import('@/lib/cache')
    const seen: string[] = []

    const handler = cachedGet(
      (req: NextRequest) => {
        const u = new URL(req.url)
        const id = u.searchParams.get('id') ?? 'none'
        return `widget:${id}`
      },
      async (userId, req) => {
        const u = new URL(req.url)
        seen.push(u.searchParams.get('id') ?? 'none')
        return { id: u.searchParams.get('id') }
      },
    )

    const req = (id: string) =>
      ({
        url: `http://test/api/widgets?id=${id}`,
        headers: { get: (h: string) => (h === 'authorization' ? `Bearer ${ALICE}` : null) },
        cookies: { get: () => undefined },
        method: 'GET',
      }) as unknown as NextRequest

    await handler(req('1'))
    await handler(req('2'))
    await handler(req('1')) // same as first → should hit cache
    expect(seen).toEqual(['1', '2']) // not 3 entries
  })

  it('returns a 401 when the resolver produces no userId', async () => {
    const { cachedGet } = await import('@/lib/cache')

    const handler = cachedGet(
      'secret',
      async () => ({ ok: true }),
      async () => null, // no user
    )
    const req = {
      url: 'http://test/api/secret',
      headers: { get: () => null },
      cookies: { get: () => undefined },
      method: 'GET',
    } as unknown as NextRequest

    const r = await handler(req)
    expect(r.status).toBe(401)
  })

  it('invalidateForRequest drops the wrapper-managed entry too', async () => {
    // Proves that route-level mutations invalidate wrapper-cached GETs
    // via the same central choke-point — no per-route wiring needed.
    const loader = vi.fn().mockResolvedValue({ ok: 1 })
    const { cachedGet, invalidateForRequest } = await import('@/lib/cache')
    const handler = cachedGet('ns', async () => loader())

    const req = {
      url: 'http://test/api/ns',
      headers: { get: (h: string) => (h === 'authorization' ? `Bearer ${ALICE}` : null) },
      cookies: { get: () => undefined },
      method: 'GET',
    } as unknown as NextRequest

    await handler(req)
    expect(loader).toHaveBeenCalledTimes(1)
    await handler(req)
    expect(loader).toHaveBeenCalledTimes(1) // hit

    invalidateForRequest('POST', ALICE) // simulate a mutation on the same user
    await handler(req)
    expect(loader).toHaveBeenCalledTimes(2) // reloaded
  })
})
