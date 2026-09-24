/**
 * Shared mocks + helpers for CRUD route-handler tests.
 *
 * Pattern: every CRUD route imports `lib/auth` (which itself depends
 * on `lib/db` and `lib/env`) and `lib/db` (Drizzle client). Vitest
 * cannot resolve the Auth.js v5 + Next.js 16 server-only chain, and
 * we don't want to hit a real DB. So we mock both at module load.
 *
 * Usage:
 *
 *   vi.mock('@/lib/env', () => ({ env: TEST_ENV }))
 *   vi.mock('@/lib/auth', () => ({ auth: () => mockAuth() }))
 *   vi.mock('@/lib/db', () => buildDbMock({ ... }))
 *
 *   import { resetMocks, setAuthUser, fakeUserId } from './route-test-helpers'
 *
 * The shared helper sets up a default "logged-in test user" and a
 * fluent builder for the Drizzle chain so each test file just declares
 * what its DB calls should return.
 */

import { vi } from 'vitest'

/* -------------------------------------------------------------------------- */
/* Standard env stub — must match the keys used in lib/env.ts                 */
/* -------------------------------------------------------------------------- */

export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  AUTH_SECRET:
    'test-secret-test-secret-test-secret-test-secret-32+chars',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  OPENAI_API_KEY: 'test-openai-key',
  MINIMAX_API_KEY: 'test-MiniMax-key',
  MINIMAX_BASE_URL: 'https://api.minimax.example.com',
  BLOB_READ_WRITE_TOKEN: 'test-blob-token',
}

/* -------------------------------------------------------------------------- */
/* Mock factories                                                             */
/* -------------------------------------------------------------------------- */

/** Default authenticated user for tests. Override via `setAuthUser`. */
export const fakeUserId = 'user_founder01'
export const otherUserId = 'user_other_xxx'

export const mockAuth = vi.fn().mockResolvedValue({
  user: {
    id: fakeUserId,
    isGuest: false,
    modelProvider: 'gemini',
    email: 'founder@example.com',
    name: 'Founder',
  },
})

export function setAuthUser(id: string | null) {
  if (id === null) {
    mockAuth.mockResolvedValueOnce(null)
  } else {
    mockAuth.mockResolvedValueOnce({
      user: {
        id,
        isGuest: false,
        modelProvider: 'gemini',
        email: `${id}@example.com`,
        name: id,
      },
    })
  }
}

/* -------------------------------------------------------------------------- */
/* Drizzle chain builder                                                      */
/*                                                                             */
/* Returns a chainable object that any Drizzle method can hang off of.        */
/* Tests pre-load the chain with the rows they want returned for the          */
/* terminating method (`.limit`, `.then`, etc.).                              */
/* -------------------------------------------------------------------------- */

export interface FakeChain {
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  orderBy: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  then: <T>(
    onFulfilled?: (value: unknown[]) => T,
  ) => Promise<T>
  values: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  returning: ReturnType<typeof vi.fn>
  // The transaction itself is a callable function that immediately
  // invokes its callback with the same fake chain.
  transaction: ReturnType<typeof vi.fn>
}

/**
 * Build a Drizzle-like fake. The `selectResult` is whatever the
 * SELECT chain should resolve to (rows array). The `transaction` is
 * invoked synchronously and the callback receives the same fake.
 */
export function buildDbMock(opts: {
  selectResult?: unknown[]
  transactionImpl?: (cb: (tx: any) => Promise<any>) => Promise<any>
} = {}) {
  const selectResult = opts.selectResult ?? []

  // A single shared chain. Each call to `db.select(...)` returns the
  // same object, so the test's `mockResolvedValueOnce(...)` lines up
  // with whatever the next terminal call resolves to.
  const chain: any = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(selectResult))
  chain.returning = vi.fn(() => Promise.resolve(selectResult))
  chain.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve(selectResult).then(onFulfilled)
  chain.values = vi.fn(() => chain)
  chain.set = vi.fn(() => chain)

  const insertChain: any = {}
  insertChain.values = vi.fn(() => insertChain)
  insertChain.returning = vi.fn(() => Promise.resolve([]))

  const updateChain: any = {}
  updateChain.set = vi.fn(() => updateChain)
  updateChain.where = vi.fn(() => updateChain)
  updateChain.returning = vi.fn(() => Promise.resolve([]))

  const deleteChain: any = {}
  deleteChain.where = vi.fn(() => deleteChain)
  deleteChain.returning = vi.fn(() => Promise.resolve([]))

  const transaction = opts.transactionImpl ?? (async (cb: any) => cb(chain))

  return {
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => deleteChain),
      transaction: vi.fn(transaction),
    },
    chain,
    insertChain,
    updateChain,
    deleteChain,
  }
}

/**
 * Reset all mock state. Call in `beforeEach`.
 */
export function resetMocks() {
  mockAuth.mockReset()
  mockAuth.mockResolvedValue({
    user: {
      id: fakeUserId,
      isGuest: false,
      modelProvider: 'gemini',
      email: 'founder@example.com',
      name: 'Founder',
    },
  })
}
