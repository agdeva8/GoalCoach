# GoalCoach browser-driven e2e tests

Real Chromium, real network, no jsdom. Run these **last** — they are
the final word on whether a slice actually shipped.

These specs cover every line item from the audit task (see
`memory/AGENT_BUILDER.md` and the latest published plan):
guest login, persona isolation, chat streaming, propose/confirm/reject,
drop_goal → archive, preferences persistence, memories, motivation,
blockers, navigation, resizable split, audit isolation.

## Inventory

| file | covers |
| --- | --- |
| `01_smoke.spec.ts`                     | landing renders with no console errors; API root reachable |
| `02_routes.spec.ts`                    | `/`, `/coach`, `/audit` render; back/forward restores state |
| `03_api_auth_state.spec.ts`            | persona switching isolates state; preferences persist per user |
| `04_chat_and_proposals.spec.ts`        | SSE chat stream; propose → confirm/reject chain |
| `05_drop_archive.spec.ts`              | drop_goal moves a goal from active to archive |
| `06_memories_blockers_motivation.spec.ts` | memories / blockers CRUD; `/api/motivation/recommend` no-401 |
| `07_resizable_split.spec.ts`           | split-pane UI; guest-to-account upgrade affordance |
| `08_proposal_audit_chain.spec.ts`      | confirm/reject isolation; audit rows scoped per caller |
| `guest-auth.spec.ts`                   | guest cookie persists; `/api/auth/me` echoes same id |
| `smoke.spec.ts`                        | extended signed-out landing smoke + auth API surface |
| `helpers.ts`                           | `loginAsGuest`, `makeApi`, `applyCookiesToPage`, `captureStep`, `authMe`, `isNotImplemented`, `API_URL` |

## Running

Dev servers must already be running on the canonical ports:

```bash
# API on 4000 (per api/.env AUTH_URL=NEXT_PUBLIC_APP_URL=http://localhost:4000)
PORT=4000 pnpm --filter @goalcoach/api dev

# Web on 4001 (matches api/middleware.ts CORS DEV_ORIGINS)
PORT=4001 pnpm --filter @goalcoach/web dev
```

Then in another terminal:

```bash
pnpm test:e2e               # headless run
pnpm test:e2e:headed        # headed (useful when iterating locally)
pnpm test:e2e:ui            # Playwright Inspector
pnpm test:e2e:report        # open the HTML report after a run
```

Override ports without editing code:

```bash
E2E_BASE_URL=http://localhost:4001 E2E_API_URL=http://localhost:4000 pnpm test:e2e
```

## First-time setup

Playwright is declared in `devDependencies` at the repo root. If the
browser binary is missing on this machine (check
`~/Library/Caches/ms-playwright/`), install it:

```bash
pnpm test:e2e:install       # = playwright install --with-deps chromium
```

## Conventions

- Every spec imports `{ test, expect }` from `@playwright/test` and
  helper utilities from `./helpers`. Don't reach for raw
  `playwright` / `request` from spec bodies unless you have a reason.
- Use `test.skip(isNotImplemented(status), '…not implemented')` when
  an endpoint is genuinely absent. Surface anything else as a real
  failure so silent regressions never escape.
- All guest flows go through `loginAsGuest(makeApi())` — never
  hand-roll cookie plumbing.
- Screenshots for visual regression attach via `captureStep(page,
  'label')` and land in `tests/e2e/screenshots/`.
- Video + trace are retained on failure in `playwright-report/` and
  `test-results/` (both git-ignored).
- Copy and CSS are deliberately not asserted on — see
  AGENT_BUILDER.md. We pin behavior, not wording.

## Adding a new spec

1. Drop `NN_my_thing.spec.ts` (or `NN_thing.spec.ts`) in this folder.
2. Import `{ test, expect }` from `@playwright/test` and what you
   need from `./helpers`.
3. Group with `test.describe('feature — what it covers', ...)`.
4. Run with `pnpm test:e2e NN_my_thing.spec.ts` to iterate.