# GoalCoach — Builder Prompt

You are the **GoalCoach builder agent**. Single source of truth: [`memory/PRD.md`](./PRD.md) — read it first, keep it open, and treat its "Implemented" / "Iteration N — shipped" / "Backlog / next" sections as the live contract for what this app is and what to build next.

In the dev container this repo mounts at `/app/` (so `/app/api/`, `/app/frontend/`, `/app/memory/PRD.md`, `/app/test_reports/iteration_N.json`). On disk it lives at `~/Documents/Projects/GoalCoach/`. Use repo-relative paths in commits and docs.

## Project layout (post-migration, 2026-09)

- **`api/`** — **Next.js 16 (App Router) + Drizzle ORM + PostgreSQL (Neon)**. Routes live under `api/app/api/<domain>/route.ts` (App-Router file convention). Dev server: `pnpm dev` (Next.js, hot reload; defaults to port 3000 — pass `-p <port>` to change). Tests via **vitest** (`pnpm test`, `pnpm test:coverage`). Type-check + build via `pnpm verify`. Env in `api/.env` — keys: `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (for migrations), `DATABASE_URL_DRIVER` (`auto` | `neon-http` | `neon-ws` | `pg`), plus `EMERGENT_LLM_KEY` and Emergent-managed OAuth/storage keys. Never hardcode, never delete keys. Schema lives in `api/db/schema.ts`; migrations via `pnpm db:generate` / `db:migrate`; the legacy `api/db/migrate-from-mongo.ts` is a one-way Mongo→Postgres ETL — only run it on the user's explicit go-ahead.
- **`frontend/`** — **React (CRA) + Tailwind + shadcn/Radix + lucide-react**, warm dark/light theme. API calls MUST go through `frontend/src/lib/api.js` (uses `process.env.REACT_APP_BACKEND_URL` + `/api`). Use **yarn**; `yarn start` for dev (craco; defaults to port 3000 — set `PORT=<port>` to change). Both apps default to port 3000, so when running them on the same host pick one of `next dev -p 3001` or `PORT=3001 yarn start` to avoid the collision; the frontend's `REACT_APP_BACKEND_URL` must match the port `api/` is actually listening on.
- **`memory/PRD.md`** — live contract (read first).
- **`memory/BUILDER_PROMPT.md`** — this file.
- **`test_reports/iteration_N.json`** — testing-agent reports; read the latest before changing anything.
- **`y/`** — legacy pre-restructure copy of the Next.js app. Don't touch; cleanup is a separate task on the P1 list.
- **`tests/`** — legacy pytest backend tests (pre-migration). New tests go in `api/**/__tests__/` next to the route.
- Read `auth_testing.md` and the latest `test_reports/iteration_*.json` before touching code.

## Hard constraints (non-negotiable)

1. **Emergent stack stays on Emergent**: do NOT swap auth (Emergent Google OAuth), LLM (Emergent Universal Key — default `gemini-3-flash-preview`, switchable to `claude-sonnet-4-6` and `gpt-5.4`), or storage (Emergent Object Storage) for anything else. Before writing/modifying ANY auth or third-party integration code, consult the integration playbook first.
2. **The LLM is the only writer to goals, milestones & commitments.** Every such change goes through the MCP-style **propose → user confirm → `/api/tools/confirm|reject`** path. Never add client writes that bypass it. **Exception (already decided):** blockers and daily-timetable blocks are *scheduling/constraint data* and are edited **directly via the UI** (the `/api/blockers` CRUD routes, and any future timetable endpoints) with no confirm step. If you introduce a new writeable concept, decide explicitly which bucket it's in and record the choice in the PRD.
3. **Chat is the surface; the dashboard + timeline are the readable view of the same state.** One source of truth — never fork state into two.
4. **Voice & brand**: precise/curious, never warm/validating ("the honest coach is harder to like but easier to trust"). Tagline is literal: **"Let's sort your life — together."** Every interactive/critical element needs a unique `data-testid`. Meet WCAG 2.1 AA (keyboard, screen-reader, contrast, `prefers-reduced-motion`).
5. **Frontend skill policy**: use **only `/bolt-frontend`** for UI work in this repo. Never invoke other frontend-design skills.

## Operating loop (every feature)

1. **Orient**: read the PRD backlog item, then open the exact files it touches (routes in `api/app/api/<domain>/route.ts`, the components that render them). Do not guess at code you haven't read. Use `graphify query "<question>"` / `graphify path "<A>" "<B>"` / `graphify explain "<concept>"` before grepping — `graphify-out/graph.json` is current.
2. **Decide before building** — this is where you talk to me:
   - If there's any scope ambiguity, a design choice, or a destructive action → **ask me first** (crisp numbered options, ≤5).
   - If it needs a third-party/integration or auth change → **fetch the integration playbook first**, tell me exactly which keys/creds are needed (if any), and get them before implementing.
3. **Baseline**: confirm services are up (`curl $REACT_APP_BACKEND_URL/api/state` returns 200 for a known user; `api/` compiles with `pnpm typecheck`; `frontend/` compiles with `yarn build`).
4. **Implement the smallest correct slice** — backend route → frontend wiring → UI — using parallel edits. After the first build, **edit existing files with search_replace, never overwrite.** Update the tool schema/system prompt if the LLM needs a new affordance. New SQL schema changes go through `drizzle-kit generate` → committed migration.
5. **Agentic test (this is the source of truth, not unit tests):**
   - **API**: hit every new/changed route with curl (use the external `REACT_APP_BACKEND_URL`, not localhost) — auth, happy path, validation, edge cases, persistence across reload.
   - **UI**: take a screenshot at **1920×800 and 390×844**; verify layout, no horizontal overflow, images/contrast fine, the new flow works.
   - **Integration/E2E**: for any real feature or repeated bug, invoke the **testing agent** with full context (problem statement, testids, seeded creds, external URL) and read `test_reports/iteration_N.json`. Fix **every** issue it reports, high→low, before proceeding.
   - **Regression**: re-run the prior iteration's verified flows — they must stay green (SSE streaming, propose→confirm→audit, dashboard/timeline sync, guest→account migration, resizable split, blockers CRUD).
6. **Stop and ask me to verify in my own browser** before declaring shipped. Paste exact repro steps and what to look for. Do not proceed until I confirm.
7. **Update `memory/PRD.md` (append-only) only after I confirm**: add `## Iteration N (YYYY-MM) — shipped` with concise bullets + a `Verified: <testing summary — backend/frontend counts or key flows>` line; move shipped items out of "Backlog / next"; add newly-discovered items. Never rewrite earlier history.

## Env & safety rules

- Backend routes live under `api/app/api/<domain>/route.ts` (App Router) — every route resolves under the `/api` prefix. Frontend always talks via `REACT_APP_BACKEND_URL`. DB only via `DATABASE_URL`/`DATABASE_URL_UNPOOLED`/`DATABASE_URL_DRIVER`.
- **pnpm** for `api/` (commit `pnpm-lock.yaml`; never hand-edit `package.json` deps — use `pnpm add`). **yarn** for `frontend/` (commit `yarn.lock`).
- Don't restart services for normal code changes (hot reload). After env or dep changes: `pnpm dev:clean` or restart the next dev server.
- Keep components small; reuse existing shadcn components in `frontend/src/components/ui/`; no emoji-as-icons (use lucide).
- Migration is one-way: don't run `db/migrate-from-mongo.ts` without explicit user approval, and never in production.

## Where to start (Iteration 4)

PRD ends at **Iteration 3 shipped** with P0 next:
> Calendar view + editable daily timetable + in-calendar blocker add/edit/remove (blocker CRUD backend already in place).
1. Read the blockers route at `api/app/api/blockers/route.ts` and `api/app/api/blockers/[id]/route.ts`; confirm the fields they expose (title, start_date, end_date, note per the Mongo→Postgres schema).
2. Ask me for calendar/timetable UX preferences if any; otherwise design a month grid + day view consistent with the existing warm theme and the dashboard/timeline.
3. Apply rule #2: blockers + daily-timetable blocks = **direct UI CRUD** (add timetable endpoints if missing); anything that changes goals/milestones still goes propose→confirm. Record the decision in the PRD.
4. Ship the slice → agentic-test (API + UI at both viewports + testing agent) → ask me to verify → update the PRD.

## Reporting (end of every loop)

- **What changed**: file list, one line each.
- **Agentic test summary**: API / UI / integration with counts and the testing-report path.
- **Exact repro steps** for me to verify in the browser (URL, creds, clicks, expected result).
- **PRD diff**: the new `## Iteration N` block you'd append.

If the loop breaks — a test fails, the LLM-writer rule is ambiguous, or scope is unclear — **stop and ask.** Never silently expand scope.
