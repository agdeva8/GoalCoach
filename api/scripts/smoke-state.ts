/**
 * Smoke test for the dashboard state + CRUD surface.
 *
 * Logs in as a test user, exercises every CRUD endpoint, then prints
 * the resulting state. Used as the Phase 1 acceptance script:
 * `pnpm tsx scripts/smoke-state.ts`.
 *
 * Steps performed:
 *   1. Hit POST /api/auth/guest to mint a fresh guest_token (HTTP-only
 *      cookie).
 *   2. Hit POST /api/goals to create a goal.
 *   3. Hit POST /api/commitments to create an open commitment.
 *   4. Hit POST /api/milestones to create a milestone.
 *   5. Hit POST /api/blockers to create a blocker.
 *   6. Hit GET  /api/state to dump the resulting dashboard.
 *   7. Hit PATCH /api/goals/[id] to update the goal title.
 *   8. Hit DELETE /api/goals/[id] to soft-delete the goal.
 *   9. Hit GET  /api/state again to confirm the goal is dropped.
 *
 * Each step prints a one-line status so a CI run can grep for FAIL.
 * Exit code is non-zero on any failure.
 *
 * Required env vars (per lib/env.ts):
 *   NEXT_PUBLIC_APP_URL          default: http://localhost:3000
 *   DATABASE_URL, AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *   GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY,
 *   MINIMAX_API_KEY, MINIMAX_BASE_URL, BLOB_READ_WRITE_TOKEN.
 *
 * Note: this script bypasses `lib/env.ts` and uses `fetch` directly
 * against the running dev server (or production). We do NOT import
 * the API route handlers — they're exercised over HTTP so we cover
 * the whole stack including auth/cookies.
 */

import 'dotenv/config'

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface Step {
  label: string
  ok: boolean
  detail?: string
}

const steps: Step[] = []

function record(label: string, ok: boolean, detail?: string) {
  steps.push({ label, ok, detail })
  if (ok) {
    console.log(`  PASS  ${label}`)
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * Read cookies from the Set-Cookie response headers and merge them
 * into the Cookie header for subsequent requests.
 */
function mergeCookies(
  existing: string,
  setCookie: string[] | string | null,
): string {
  if (!setCookie) return existing
  const list = Array.isArray(setCookie) ? setCookie : [setCookie]
  const merged = new Map<string, string>()

  // Preserve any existing cookie tokens.
  for (const part of existing.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    merged.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }
  for (const raw of list) {
    const semi = raw.indexOf(';')
    const head = semi === -1 ? raw : raw.slice(0, semi)
    const eq = head.indexOf('=')
    if (eq <= 0) continue
    merged.set(head.slice(0, eq).trim(), head.slice(eq + 1).trim())
  }
  return Array.from(merged.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

async function call(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; body: any; setCookie: string | null; cookie: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (cookie) headers.cookie = cookie
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.get('set-cookie')
  let nextCookie = cookie
  if (setCookie) {
    nextCookie = mergeCookies(cookie, setCookie)
  }
  let parsed: any = null
  const text = await res.text()
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed, setCookie, cookie: nextCookie }
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log(`smoke-state: testing dashboard surface at ${BASE}\n`)

  // 1) Create a guest session.
  const guest = await fetch(`${BASE}/api/auth/guest`, { method: 'POST' })
  let cookie = ''
  const guestSetCookie = guest.headers.get('set-cookie')
  if (guestSetCookie) {
    cookie = mergeCookies('', guestSetCookie)
  }
  record(
    'POST /api/auth/guest',
    guest.status === 200,
    `status=${guest.status}`,
  )
  if (guest.status !== 200) {
    console.error('Cannot continue without a guest session.')
    process.exit(1)
  }

  // 2) Create a goal.
  const goalRes = await call(
    'POST',
    '/api/goals',
    cookie,
    {
      title: `Smoke goal ${new Date().toISOString()}`,
      horizon: 'short',
      why: 'verify CRUD',
      next_action: 'run smoke-state',
      target_date: '2026-12-31',
    },
  )
  cookie = goalRes.cookie
  record(
    'POST /api/goals',
    goalRes.status === 201 && goalRes.body?.id?.startsWith('goal_'),
    `status=${goalRes.status}`,
  )
  const goalId = goalRes.body?.id as string | undefined
  if (!goalId) {
    console.error('Smoke aborted: no goal id returned.')
    process.exit(1)
  }

  // 3) Create a commitment linked to the goal.
  const commitRes = await call(
    'POST',
    '/api/commitments',
    cookie,
    {
      text: 'Run smoke-state',
      goal_id: goalId,
      due: '2026-10-01',
    },
  )
  cookie = commitRes.cookie
  record(
    'POST /api/commitments',
    commitRes.status === 201 && commitRes.body?.id?.startsWith('commit_'),
    `status=${commitRes.status}`,
  )

  // 4) Create a milestone.
  const mileRes = await call('POST', '/api/milestones', cookie, {
    title: 'Smoke milestone',
    goal_id: goalId,
    target_date: '2026-09-30',
  })
  cookie = mileRes.cookie
  record(
    'POST /api/milestones',
    mileRes.status === 201 && mileRes.body?.id?.startsWith('mile_'),
    `status=${mileRes.status}`,
  )

  // 5) Create a blocker.
  const blockRes = await call('POST', '/api/blockers', cookie, {
    title: 'Smoke blocker',
    start_date: '2026-09-25',
    end_date: '2026-09-26',
    note: 'for the smoke run',
  })
  cookie = blockRes.cookie
  record(
    'POST /api/blockers',
    blockRes.status === 201 && blockRes.body?.id?.startsWith('block_'),
    `status=${blockRes.status}`,
  )

  // 6) GET state — should now contain the new rows.
  const stateRes = await call('GET', '/api/state', cookie)
  cookie = stateRes.cookie
  const state = stateRes.body
  const hasGoal = Array.isArray(state?.goals)
    ? state.goals.some((g: any) => g.id === goalId)
    : false
  record(
    'GET /api/state contains new goal',
    stateRes.status === 200 && hasGoal,
    `status=${stateRes.status} goalInState=${hasGoal}`,
  )

  console.log('\nDashboard summary:')
  console.log(`  goals:        ${state?.goals?.length ?? 0}`)
  console.log(`  commitments:  ${state?.commitments?.length ?? 0}`)
  console.log(`  milestones:   ${state?.milestones?.length ?? 0}`)
  console.log(`  blockers:     ${state?.blockers?.length ?? 0}`)
  console.log(
    `  load:         ${state?.over_commitment?.level ?? '?'} (${state?.over_commitment?.active_goals ?? '?'} active goals, ${state?.over_commitment?.open_commitments ?? '?'} open commitments)`,
  )
  console.log(
    `  audit recent: ${state?.audit_summary?.recent?.length ?? 0}`,
  )

  // 7) PATCH the goal.
  const patchRes = await call(
    'PATCH',
    `/api/goals/${goalId}`,
    cookie,
    { title: 'Smoke goal (updated)' },
  )
  cookie = patchRes.cookie
  record(
    'PATCH /api/goals/[id]',
    patchRes.status === 200 && patchRes.body?.goal?.title === 'Smoke goal (updated)',
    `status=${patchRes.status}`,
  )

  // 8) Soft-delete the goal.
  const deleteRes = await call('DELETE', `/api/goals/${goalId}`, cookie)
  cookie = deleteRes.cookie
  record(
    'DELETE /api/goals/[id]',
    deleteRes.status === 200,
    `status=${deleteRes.status}`,
  )

  // 9) GET state — the goal should now be marked dropped.
  const state2Res = await call('GET', '/api/state', cookie)
  cookie = state2Res.cookie
  const droppedGoal = Array.isArray(state2Res.body?.goals)
    ? state2Res.body.goals.find((g: any) => g.id === goalId)
    : undefined
  record(
    'GET /api/state shows dropped goal',
    state2Res.status === 200 && droppedGoal?.status === 'dropped',
    `status=${state2Res.status} droppedStatus=${droppedGoal?.status ?? 'not-found'}`,
  )

  /* -------------------------------------------------------------------------- */
  /* Result                                                                     */
  /* -------------------------------------------------------------------------- */

  const failed = steps.filter((s) => !s.ok)
  console.log('')
  console.log(`smoke-state: ${steps.length - failed.length}/${steps.length} steps ok`)

  if (failed.length > 0) {
    console.error('FAILED steps:')
    for (const f of failed) console.error(`  - ${f.label}${f.detail ? `: ${f.detail}` : ''}`)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('smoke-state: uncaught error', err)
  process.exit(1)
})
