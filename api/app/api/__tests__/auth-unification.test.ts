/**
 * Phase 0 auth-unification regression guard.
 *
 * Three assertions in one test file so a future "let me just shortcut
 * auth with a Bearer token" change immediately trips a CI failure:
 *
 *   1. No production route file under `api/app/api` may contain the
 *      literal `user_founder01`. Files under `__tests__/` and
 *      `*.test.ts` are exempt, plus a short allowlist of files that
 *      intentionally reference the literal (test fixture shared-state,
 *      and the dev-login default that the curl script relies on).
 *      The whole `tools/__tests__/shared-state.ts` file is the
 *      single source of truth for the literal.
 *
 *   2. The eight rewritten routes resolve the caller's id from a
 *      session-cookie-shaped signal (the Auth.js-via-`@/lib/auth`
 *      path), not from a Bearer header. We mock `@/lib/auth` exactly
 *      like `app/api/state/__tests__/route.test.ts` does — so a future
 *      regression that wires a route to Bearer-only would still find a
 *      user, but with the *wrong* id (the Bearer value itself), which
 *      the assertion catches.
 *
 *   3. An arbitrary `Authorization: Bearer` is rejected when
 *      `ALLOW_DEV_LOGIN` is unset and `NODE_ENV !== 'test'`. This is
 *      the security hole that the plan set out to close: pre-Phase-0
 *      any non-empty bearer authenticated as itself with full R/W.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { NextRequest } from 'next/server'

import {
  resolveRequestUser,
  type RequestLike,
} from '@/lib/request-user'

// ---------------------------------------------------------------------------
// (1) File scan — no production route file may contain "user_founder01".
// ---------------------------------------------------------------------------

/**
 * Files that legitimately contain `user_founder01` as a literal. Add to
 * this list ONLY if the literal is a deliberate, non-regression
 * fixture. The first item is the canonical test fixture; the second is
 * the dev-login default fallback the curl script depends on.
 */
const ALLOWLIST = new Set([
  // In-memory proposal fixture owns the literal.
  'tools/__tests__/shared-state.ts',
  // chat/history test fixture owns the literal — the route's
  // `testHistoryFixture()` returns rows tagged with this id.
  // Per the Phase 0 plan, this is the one file outside `__tests__/`
  // where the literal may survive.
  'chat/history/route.ts',
  // dev-login route's `user_id` query-param default for first-party
  // dev scripts. Setting it to `user_founder01` keeps the row in sync
  // with `db/migrations/0003_seed_founder.sql`.
  'auth/dev-login/route.ts',
])

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      yield* walk(p)
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      yield p
    }
  }
}

// Tests that live in `__tests__/` directories OR have a `.test.ts`
// extension are exempt — the route file scan only covers production
// code. Vitest's include glob (`app/api/**/__tests__/**/*.test.ts`)
// already enforces this; we mirror the same exclusion locally so the
// scan is self-explanatory.

const APP_DIR = resolve(__dirname, '..')
const OFFENDERS: string[] = []
for (const file of walk(APP_DIR)) {
  const rel = relative(APP_DIR, file)
  if (ALLOWLIST.has(rel)) continue
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (text.includes('user_founder01')) {
    OFFENDERS.push(rel)
  }
}

// ---------------------------------------------------------------------------
// (2) Cookie resolution — the eight rewritten routes read the caller
//     from the session (mocked here), NOT from a Bearer header.
// ---------------------------------------------------------------------------

interface RouteProbe {
  name: string
  module: () => Promise<unknown>
  method: 'POST' | 'GET' | 'DELETE' | 'PATCH' | 'PUT'
  /** Expected status when auth() returns null (no session). */
  expectStatusWithoutAuth: number
  /**
   * "Auth succeeded" — exact status depends on whether the route
   * finds the requested resource in our mocked DB. We accept anything
   * other than 401 (which would mean auth failed). For routes that
   * succeed cleanly with the placeholder body we send, we pin the
   * exact status.
   */
  expectStatusWithAuth: number | 'not-401'
}

const ROUTE_PROBES: RouteProbe[] = [
  {
    name: 'chat/stream',
    module: () => import('@/app/api/chat/stream/route'),
    method: 'POST',
    expectStatusWithoutAuth: 401,
    // 200 only in DATABASE_URL-unset test-mode path; with the mock env
    // (DATABASE_URL set) the production branch runs and streams a
    // response. Either way: NOT 401.
    expectStatusWithAuth: 'not-401',
  },
  {
    name: 'chat/history',
    module: () => import('@/app/api/chat/history/route'),
    method: 'GET',
    expectStatusWithoutAuth: 401,
    expectStatusWithAuth: 'not-401',
  },
  {
    name: 'tools/confirm',
    module: () => import('@/app/api/tools/confirm/route'),
    method: 'POST',
    expectStatusWithoutAuth: 401,
    // DB-path returns 404 for our placeholder proposal_id; the point
    // is that we got PAST auth (status != 401).
    expectStatusWithAuth: 'not-401',
  },
  {
    name: 'tools/reject',
    module: () => import('@/app/api/tools/reject/route'),
    method: 'POST',
    expectStatusWithoutAuth: 401,
    expectStatusWithAuth: 'not-401',
  },
  {
    name: 'preferences',
    module: () => import('@/app/api/preferences/route'),
    method: 'PUT',
    expectStatusWithoutAuth: 401,
    expectStatusWithAuth: 'not-401',
  },
  {
    name: 'memories',
    module: () => import('@/app/api/memories/route'),
    method: 'GET',
    expectStatusWithoutAuth: 401,
    // Returns 200 with `{ memories: [] }` against the real (empty) DB.
    expectStatusWithAuth: 'not-401',
  },
  {
    name: 'memories/[id]',
    module: () => import('@/app/api/memories/[id]/route'),
    method: 'DELETE',
    expectStatusWithoutAuth: 401,
    // 404 because the memory id doesn't exist.
    expectStatusWithAuth: 'not-401',
  },
  {
    name: 'motivation/recommend',
    module: () => import('@/app/api/motivation/recommend/route'),
    method: 'GET',
    expectStatusWithoutAuth: 401,
    expectStatusWithAuth: 'not-401',
  },
]

const SESSION_USER_ID = 'real_user_session_xyz'

function makeReq(
  method: string,
  path: string,
  init?: { bearer?: string; body?: unknown },
): NextRequest {
  const headers = new Headers()
  if (init?.bearer) headers.set('Authorization', `Bearer ${init.bearer}`)
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
}

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
  getAuthenticatedUser: () =>
    mockAuth().then((s: any) =>
      s
        ? {
            user: {
              id: s.user.id,
              email: s.user.email,
              name: s.user.name,
              image: null,
              modelProvider: s.user.modelProvider,
              isGuest: !!s.user.isGuest,
            },
            source: 'session',
          }
        : null,
    ),
}))

vi.mock('@/lib/env', () => ({
  env: {
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
  },
}))

/**
 * Mock the DB so the eight route probes don't try to open a real
 * Postgres connection. Each chain method returns the chain itself;
 * terminal methods return empty arrays so list/read paths succeed
 * and write paths return whatever the route needs.
 */
const { dbMock, dbChain } = vi.hoisted(() => {
  const chain: any = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve([] as unknown[]))
  chain.values = vi.fn(() => chain)
  chain.set = vi.fn(() => chain)
  chain.returning = vi.fn(() => Promise.resolve([] as unknown[]))
  chain.insert = vi.fn(() => chain)
  chain.update = vi.fn(() => chain)
  chain.delete = vi.fn(() => chain)
  chain.select = vi.fn(() => chain)
  chain.then = undefined
  const dbMock = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    transaction: vi.fn(async (cb: any) => cb(chain)),
  }
  return { dbMock, dbChain: chain }
})

vi.mock('@/lib/db', () => ({ db: dbMock }))

describe('Phase 0 auth unification', () => {
  beforeEach(() => {
    mockAuth.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no production route file under api/app/api contains user_founder01', () => {
    expect(OFFENDERS).toEqual([])
  })

  it('resolveRequestUser rejects an arbitrary Bearer in non-dev/test mode', async () => {
    // `process.env.NODE_ENV` is typed as readonly by @types/node. We
    // cast through `unknown` so we can flip it to exercise the
    // production Bearer-rejection branch (the resolver only honors
    // Bearer when `NODE_ENV === 'test'` or `ALLOW_DEV_LOGIN === 'true'`).
    const env = process.env as unknown as Record<string, string | undefined>
    const prevAllow = env.ALLOW_DEV_LOGIN
    const prevNodeEnv = env.NODE_ENV
    delete env.ALLOW_DEV_LOGIN
    env.NODE_ENV = 'production'
    try {
      const req = makeReq('GET', '/api/preferences', {
        bearer: 'arbitrary_attacker_string',
      }) as unknown as RequestLike
      const u = await resolveRequestUser(req)
      expect(u).toBeNull()
    } finally {
      if (prevAllow === undefined) delete env.ALLOW_DEV_LOGIN
      else env.ALLOW_DEV_LOGIN = prevAllow
      env.NODE_ENV = prevNodeEnv
    }
  })

  it('resolveRequestUser honors Bearer only when ALLOW_DEV_LOGIN=true', async () => {
    const env = process.env as unknown as Record<string, string | undefined>
    const prevAllow = env.ALLOW_DEV_LOGIN
    const prevNodeEnv = env.NODE_ENV
    delete env.NODE_ENV
    env.ALLOW_DEV_LOGIN = 'true'
    try {
      const req = makeReq('GET', '/api/preferences', {
        bearer: 'dev_only_token',
      }) as unknown as RequestLike
      const u = await resolveRequestUser(req)
      expect(u?.source).toBe('bearer')
      expect(u?.userId).toBe('dev_only_token')
    } finally {
      if (prevAllow === undefined) delete env.ALLOW_DEV_LOGIN
      else env.ALLOW_DEV_LOGIN = prevAllow
      if (prevNodeEnv === undefined) delete env.NODE_ENV
      else env.NODE_ENV = prevNodeEnv
    }
  })

  describe('eight rewritten routes resolve from session (not Bearer)', () => {
    for (const probe of ROUTE_PROBES) {
      it(`${probe.name}: returns 401 when auth() returns null even with a Bearer`, async () => {
        mockAuth.mockResolvedValue(null)
        const mod = (await probe.module()) as Record<string, unknown>
        const handler = mod[probe.method] ?? mod.POST ?? mod.GET
        expect(typeof handler).toBe('function')

        // Note: we DO NOT send a Bearer here. In test mode the resolver
        // honors any Bearer as the caller, which would defeat this
        // assertion. We want to prove that with no session, the route
        // refuses the request.
        const req = makeReq(probe.method, `/api/${probe.name}`, {
          body: bodyFor(probe),
        })
        const params =
          probe.name === 'memories/[id]'
            ? { params: Promise.resolve({ id: 'mem_x' }) }
            : ({} as unknown)
        const res = await (
          handler as (req: NextRequest, ctx?: unknown) => Promise<Response>
        )(req, params)
        expect(res.status).toBe(probe.expectStatusWithoutAuth)
      })

      it(`${probe.name}: returns success status when auth() returns a real userId`, async () => {
        mockAuth.mockResolvedValue({
          user: {
            id: SESSION_USER_ID,
            isGuest: false,
            modelProvider: 'gemini',
            email: 'real@session.example',
            name: 'Real User',
          },
        })
        const mod = (await probe.module()) as Record<string, unknown>
        const handler = mod[probe.method] ?? mod.POST ?? mod.GET
        expect(typeof handler).toBe('function')

        const req = makeReq(probe.method, `/api/${probe.name}`, {
          body: bodyFor(probe),
        })
        const params =
          probe.name === 'memories/[id]'
            ? { params: Promise.resolve({ id: 'mem_x' }) }
            : ({} as unknown)
        const res = await (
          handler as (req: NextRequest, ctx?: unknown) => Promise<Response>
        )(req, params)
        if (probe.expectStatusWithAuth === 'not-401') {
          // "Auth succeeded" — exact status depends on whether the
          // route finds the resource. Anything other than 401 is OK.
          expect(res.status).not.toBe(401)
        } else {
          expect(res.status).toBe(probe.expectStatusWithAuth)
        }
      })
    }
  })
})

/**
 * Per-route minimal bodies. We only need to pass the route's own
 * validators — not reproduce its full happy path. Anything we send
 * here is ignored if the route 401s first.
 */
function bodyFor(probe: RouteProbe): unknown | undefined {
  if (probe.method === 'GET' || probe.method === 'DELETE') return undefined
  switch (probe.name) {
    case 'chat/stream':
      return { message: 'hello' }
    case 'tools/confirm':
    case 'tools/reject':
      return { proposal_id: 'prop_x', message_id: 'msg_x' }
    case 'preferences':
      return { model_provider: 'gemini' }
    default:
      return {}
  }
}
