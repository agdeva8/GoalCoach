# Sutra — PRD

## Original problem statement
Chat-first AI life coach for self-directed adults juggling multiple goals across time horizons. One URL, one chat, memory across sessions. The chat is the conversational surface; a tracking dashboard alongside is the readable view of the SAME state. The LLM is the only writer to substantive state (goals/commitments) — every change is an MCP-style tool call confirmed inline by the user. Wedge = cross-horizon synthesis. Voice = precise/honest, never warm/validating. Brand line (literal): "Think through your goals, out loud."

## Stack (as chosen with user)
- Frontend: React (CRA) + Tailwind + shadcn/Radix + lucide-react. Dark Swiss/high-contrast aesthetic.
- Backend: FastAPI + MongoDB (motor). SSE token streaming.
- Auth: Emergent-managed Google OAuth only (cookie/Bearer session).
- LLM: Emergent Universal Key via emergentintegrations. Default gemini-3-flash-preview; switchable to anthropic claude-sonnet-4-6 and openai gpt-5.4.

## Architecture
- `server.py`: auth/session, `/api/chat/stream` (SSE: delta/tools/done), `/api/chat/history`, `/api/state` (computes over-commitment), `/api/tools/confirm|reject` (only path that writes goals/commitments + logs audit), `/api/audit` + `/api/audit/export`, `/api/preferences`.
- Coach system prompt encodes voice + the 6 response shapes + the `[[TOOLS]]` JSON proposal protocol. Server strips the tool block from streamed prose and parses proposals.
- Memory = durable state (goals/commitments) injected into the system prompt each turn + last ~24 transcript turns.
- Frontend `Coach.js` orchestrates SSE reader, inline confirm/reject, and keeps chat + dashboard in sync from server truth.

## User persona
Founder (User #1): self-directed IC with a primary work goal, a fitness/recovery goal, 1–2 side projects, and a relationship goal. Loses time to synthesis, not capture.

## Core requirements (static)
1. Chat is the surface; dashboard is the readable state; both reflect same truth.
2. LLM is the only writer; every state change is confirmed inline.
3. Cross-horizon synthesis is the wedge.
4. Persistence across sessions.
5. No streaks/calendar/settings/mobile app in v1.

## Implemented (2026-06)
- Google OAuth login + protected /coach route; session persistence.
- Dual-pane chat + tracking dashboard (horizons: weekly/short/medium/long).
- SSE token streaming from Gemini (honest voice; correct response shapes verified).
- MCP-style inline tool proposals with Confirm/Reject → state + audit.
- Over-commitment indicator (computed truth).
- Model switcher (Gemini/Claude/OpenAI), persisted.
- Honesty audit log + JSON export.
- Storyboard scenario prefills (6 moments).
- Theme toggle, WCAG-oriented roles/aria, prefers-reduced-motion.
- Tested end-to-end: backend 15/15, frontend all flows green.

## Backlog
- P1: summarize/trim old transcript turns to bound token growth as history grows.
- P1: stricter goal disambiguation (avoid substring title matches at scale).
- P2: invite codes (v2 distribution), friend onboarding.
- P2: richer commitment due-date handling / week rollups.

## Next tasks
- Real-user founder rubric pass (≥7/10) tracking.

## Iteration 2 (2026-06) — shipped
- Guest preview: app is the landing at `/`; ephemeral chat via `/api/chat/guest_stream` (no auth). Confirming/rejecting a proposal or opening Audit prompts Google sign-in.
- Drill-down timeline: year→quarter→month→week buckets with a drift line for overdue items; breadcrumb + back nav.
- Planner tools: goals now carry start/target dates; new tool actions `set_goal_dates`, `add_milestone`, `add_blocker`; coach builds realistic dated plans with buffer.
- Clarifying-questions mode with an "answer for me" toggle (`auto_answer` flag on chat endpoints).
- "Refine" on every proposal (add a note → coach re-proposes).
- Action chips in dashboard (Add goal + area chips; per-goal edit/pause/drop/add-step) that pre-fill curated prompts (LLM stays the only writer).
- Collapsible right panel; warm dark/light theme; SVG logo; new tagline "Let's sort your life — together."; About modal (upcoming features, privacy, founder link); humanized load wording; labeled Audit button.
- Verified: testing agent 100% backend + frontend (iteration_2.json).

## Iteration 3 (2026-06) — shipped
- Guest = real anonymous session (`/api/auth/guest`, `guest_token` cookie): guests can chat, confirm writes, and their goals/timeline persist in the browser and **auto-migrate to the Google account on sign-in** (migration inside `/api/auth/session`).
- File & link **sources** via Emergent Object Storage: clip/link in the chat box + per-goal attach; PDF/MD/TXT text extracted server-side and injected into the coach prompt; view/download/soft-delete. Upload capped at 20MB + extension allowlist.
- **Resizable `<>` split** with drag divider and collapse/restore on BOTH panels.
- Guided **"why?" action modal** for goal edit/pause/drop/add-step (frames the ask, sends to the coach to confirm).
- **Milestones RAG chip** (green/amber/red) on goal cards; **new compass logo**.
- Blockers now have direct CRUD endpoints (`/api/blockers`) for the upcoming calendar.
- Verified: testing agent 100% (iteration_3.json) — 21/21 backend + all frontend flows incl. guest write→reload persistence and migration at the data layer.

## Iteration 4 (2026-09) — shipped
- **Slice 0:** Tool-proposal cards render full body (server wraps fields in `args`); AddGoalDialog mode picker sticks (real setters); default mode `grillMe: false`.
- **Slice 1:** Header cleanup — removed Chat button (FAB is the entry point), removed Scenarios dropdown (Persona picker covers scenario intent); Settings cog wired to `/settings` route.
- **Slice 1b:** AddGoalDialog attach/link buttons restored — `onUploadSource`/`onAddLink`/`onDeleteSource` threaded through TrackingDashboard into AddGoalDialog's ChatConsole; source chips shown above textarea.
- **Slice 2:** Dedicated `/settings` route with shadcn Tabs: Coach (model selector + persona note) / Account (theme toggle + sign-in/out) / Audit (opens HonestyAuditView).
- **Slice 3:** Sources tab (Sources.jsx) added as 5th panel tab — grid of source cards (file/link kind, date, goal linkage, view/download/delete actions); calls `/api/sources` + `/api/sources/:id` DELETE.
- **Slice 4 — Timeline chart fixes:** (a) Month-tick / today-label collision — split axis strip into top 28px (month labels) and bottom 28px (today label) so they never overlap; (b) goal title removed from inside the bar (was rendering twice); (c) commitment flags moved below milestone dots (`top: 11px` vs `top: 4px`) to eliminate overlap.
- **Slice 5 — Today view:** New `Today.jsx` component + "Today" tab — fetches today's blockers/commitments from API, renders done-checkbox + notes per item, blur-saves notes to PUT `/api/blockers/:id`; API additions: GET `/api/blockers`, GET `/api/commitments`, PATCH `/api/commitments/:id`.
- **Slice 6 — Mobile responsive:** Header controls (About/Audit/Theme) collapsed behind "More options" hamburger dropdown on `< sm`; tab bar gains `overflow-x-auto` for 5-tab scroll; Settings cog + model switcher remain primary-visible on mobile.
- **Regression noted:** Proposal card list crowds in tight dialog vertical space — revisit with Slice 4 timeline redesign.

## Iteration 5 (2026-09-30) — Motivation Pipeline v1, landed off

Replaces the 12-item hand-curated motivation catalogue with the full Tavily → fetch → 10-param LLM-critique → three-gate picker pipeline that has been sitting dormant in `api/lib/motivation/` since Iteration 4. The route + card UX are unchanged at MVP (flag stays off in dev/test); the agent path is one env flip away.

**New surface:**
- `api/lib/motivation/catalogue.ts` — extracted the 12-item fallback so the orchestrator and the route fast-path share one source.
- `api/lib/motivation/state.ts` — `extractLackingSignals` (overdue commitments + active-goal themes + days-since-last-activity) + `computeStateHash` for cache keys.
- `api/lib/motivation/picker.ts` — three deterministic gates (`core_four`, `k_of_n`, `weighted_total`), per-hostname diversity, reject-log persistence.
- `api/lib/motivation/frame.ts` — LLM frame via `gemini-3-flash` (2s deadline) with deterministic `"Right now, … <excerpt>"` fallback.
- `api/lib/motivation/recommend.ts` — orchestrator: cache lookup → Tavily → fetch → critique-all (parallel, per-candidate isolation) → pick → frame → cache write. Owns the 20s master deadline + $0.25 cost cap; falls back to the catalogue on any failure.
- `api/db/migrations/0008_motivation_pipeline.sql` — three new tables: `motivation_cache` (60m TTL, indexed on `expires_at`), `motivation_rejects` (per-candidate rejection log for tuning), `motivation_served_log` (per-day served count for `DAILY_USER_CAP`).
- `api/db/schema.ts` — Drizzle definitions for the three new tables.
- `api/lib/env.ts` — adds `TAVILY_API_KEY` as optional; pipeline falls back to the catalogue at runtime when missing.
- `api/app/api/motivation/recommend/route.ts` — slimmed: keeps `detectBucket` + auth; delegate to `recommend()` when the flag is on, direct-to-catalogue when off.
- `api/lib/motivation/index.ts` — barrel re-exports the new modules.

**Decisions (locked at HLD Q&A):**
- Rollout: **land off** in dev/test; founder flips `MOTIVATION_AGENT_ENABLED=true` in prod once `TAVILY_API_KEY` is set.
- Picker diversity: **≤ 1 pass per hostname** (not per kind, not both).
- Frame: **LLM with deterministic fallback** (cheap model, 2s deadline).
- Tables: all three (`motivation_cache` + `motivation_rejects` + `motivation_served_log`) ship now. Retention cron for `motivation_rejects` deferred — flagged as a TODO.

**Verified (backend-only curl smoke per MVP-mode directive):**
- `GET /api/motivation/recommend` (Bearer-authed dev user) → 200, `{ bucket, items, generated_at, cache: "miss" }` with the same 3 catalogue items, same frame format.
- `GET /api/motivation/recommend?n=1` → 200, 1 item.
- No-auth → 401, unchanged.
- Migration 0008 applied to live DB; all 3 tables present, 0 rows (catalogue path doesn't write to them — agent path will).
- `pnpm typecheck` clean.
- `pnpm lint` crashes repo-wide with `Error while loading rule 'react/display-name'` — **pre-existing on develop HEAD** (eslint-plugin-react@7.37 + eslint@10 incompatibility, unrelated to this slice). Flagging for follow-up.

**Not changed:**
- `frontend/src/components/MotivationCard.js` — zero changes (response shape unchanged).
- `frontend/src/lib/api.js` — zero changes.
- Existing `api/lib/motivation/{search,fetch,critique,config,schema}.ts` — zero changes (already correct).

**Production flip checklist (founder's call):**
1. Set `TAVILY_API_KEY` in `api/.env` (and prod env).
2. Set `MOTIVATION_AGENT_ENABLED=true` in prod.
3. Monitor `motivation_rejects` for the first day to spot over- or under-scoring.
4. When ready: add cron for `motivation_rejects` 30-day retention (`DELETE WHERE created_at < now() - interval '30 days'`).

## Iteration 6 (2026-09-30) — Dashboard cache, shipped

Cuts `GET /api/state` from **1.4–2.6s → ~0.18s on the hot path** (10x faster, measured on the live dev server). Founder's report: "apis are bit slow sometimes, lets have the write through cache update, so we don't risk showing stale data." The architecture is **declarative** — the freshness invariant is enforced centrally by the auth resolvers, and route handlers only declare "I am a cacheable read" with a one-line wrapper. No per-route refresh bookkeeping; impossible to forget.

### Architecture

**Two-line write-through contract, end-to-end:**

```ts
// READ — wrap the GET handler:
export const GET = cachedGet('blockers', async (userId) => {
  const rows = await db.select().from(blockers).where(...)
  return { blockers: rows.map(serialize) }
})

// WRITE — route handlers do NOT touch the cache:
export async function POST(req) {
  const auth = await authenticateRoute(req)   // ← invalidation happens HERE
  if (auth.error) return auth.error
  // ... validate, run transaction, return response ...
}
```

The auth resolver's choke-point invalidation (`lib/auth-route.ts`, `lib/request-user.ts`) calls `invalidateForRequest(method, userId)` on every POST/PUT/PATCH/DELETE. That single line — duplicated in two resolvers — is the **only** cache-invalidation surface mutation routes need to know about. There is no per-mutation wiring.

### New surface

- `api/lib/cache.ts` — pure, dependency-free in-process cache. Exports:
  - `cachedGet(ns | (req) => ns, loader, auth?)` — the **public API** route handlers use. One line per GET.
  - `readThrough` / `writeThrough` / `invalidatePrefix` / `invalidateUser` / `invalidateForRequest` — the underlying primitives.
  - Concurrency guards: epoch counter (no stale overwrites from in-flight reads), single-flight (no thundering herd), 200-entry LRU cap, 15s TTL safety net.
  - `server-only` and zero runtime deps; safe to import from any server-side module.
- `api/lib/dashboard-state.ts` — the cached `GET /api/state` read model. `loadDashboardState(userId)` does the canonical 5-table + audit query (now parallel via Promise.all); `getDashboardState` wraps it as the read-through entry used by the state route.
- `api/lib/llm/state-builder.ts` — `loadState` is now the read-through wrapper; `loadStateCore` is the uncached body. The five table reads run via `Promise.all` (sequential `await`s used to add ~5× RTT of overhead against the remote Supabase pooler). Chat contexts benefit automatically.

### Wiring

- **Auth resolvers** (`lib/auth-route.ts`, `lib/request-user.ts`) — three lines each: import `invalidateForRequest`, call it at every successful-auth return point. That's the entire mutation-side wiring.
- **Read endpoints** — wrapped with `cachedGet`. Six endpoints covered:
  | Route | Namespace | Notes |
  |---|---|---|
  | `GET /api/state` | `dashboard` | Elephant. Aggregates loadState + audit_summary. |
  | `GET /api/blockers` | `blockers` | Single-table. |
  | `GET /api/commitments` | `commitments` | Single-table. |
  | `GET /api/sources` | `sources:<goalId>:<limit>` | Query-param-derived namespace so filtered and unfiltered lists cache independently. |
  | `GET /api/memories` | `memories` | Uses `resolveRequestUser` for auth. |
  | `GET /api/audit` | `audit:<limit>:<type>:<before>` | Cursor pagination keys each page independently; every state mutation drops this user's entries via the choke-point. |
  | `GET /api/chat/history` | `chat-history:<limit>` | Auth via `resolveRequestUser`. |
- **Mutation handlers** — **zero cache-related code**. Routes just call `authenticateRoute` (or `resolveRequestUser`) and do their work. The choke-point handles invalidation.

### Freshness contract

| Layer | Mechanism | Where | What it guarantees |
|---|---|---|---|
| 1 | Auth choke-point | `invalidateForRequest(method, userId)` in both auth resolvers, on POST/PUT/PATCH/DELETE | Every authenticated mutation drops the user's cache before the handler runs. **No mutation can leave stale data visible to the user that performed it.** |
| 2 | Read-through | `cachedGet` + `loadState`'s read-through | Repeated reads between mutations serve from memory in ~0.17s. |
| 3 | Epoch guard | `cache.ts` | An in-flight read that started before an invalidation cannot overwrite the fresh entry. |
| 4 | TTL (15s) | `DEFAULT_TTL_MS` | Bounds staleness for the one case in-process state cannot see: a write handled by a different Vercel instance. Worst case, not the norm. |
| 5 | Single-flight | `cache.ts` | A burst of dashboard loads costs one DB round trip, not N. |

### Verified

- `pnpm typecheck` clean.
- `pnpm test` — **202 passing (+20 new), 8 failing (exact pre-existing baseline; zero regression)**.
  - New: `lib/__tests__/cache.test.ts` (16 unit tests — hit/miss, TTL, single-flight, epoch guard, write-through, invalidation, methods, `cachedGet` wrapper).
  - New: `app/api/state/__tests__/cache.test.ts` (4 integration tests — cache hit, mutation invalidation, write-through refresh, failure-leaves-cold).
- `pnpm build` succeeds.
- Live timings on `:4000` dev server, guest user, **measured end-to-end after the refactor**:

  | Endpoint | 1st call (cold) | 2nd call (warm) |
  |---|---|---|
  | `/api/state` | ~1.85s | **~0.18s** |
  | `/api/blockers` | ~0.35s | **~0.18s** |
  | `/api/commitments` | ~0.35s | **~0.18s** |
  | `/api/sources` | ~0.38s | **~0.18s** |
  | `/api/audit` | ~0.38s | **~0.18s** |
  | `/api/memories` | ~0.38s | **~0.18s** |

- Freshness invariant: `POST /api/goals` → immediate `GET /api/state` returns the new goal ✓; immediate `GET /api/audit` returns the new `create:goal` event as the most recent ✓. `DELETE /api/goals/[id]` → soft-delete reflected in next read ✓.
- User isolation: user A creates a goal; user B's `GET /api/state` shows no goals ✓ (per-user key prefix).
- Repeated reads: 1st = 0.35s, 2nd-3rd = 0.17s each → cache hits confirmed.

### Trade-offs and known residual risk

- **First read after a mutation pays one DB round trip** (~200-400ms slower than the cached subsequent reads). This is the cost of NOT pre-warming via `scheduleWriteThroughRefresh`. Acceptable for MVP: the choke-point invalidates, the next read is correct, and from then on it's fast. If first-read-after-write becomes a complaint, adding `scheduleWriteThroughRefresh` calls back in is a one-line change per mutation route — no API design needed.
- **Cross-instance staleness ≤15s on Vercel.** If instance A serves your read and instance B serves your write, instance A's cache stays warm (wrong) for up to 15s. Fix options if it matters: Upstash Redis (~50ms cross-instance read RTT, airtight); or a shared Supabase `cache_versions` row bumped in-transaction + validated on read (~150ms, imperfect for delete-oldest-row). In-process is the right MVP default — both alternatives need founder provisioning. Flagging for follow-up.

## Backlog / next
- P0: **Calendar view + editable daily timetable + in-calendar blocker add/edit/remove** (blocker CRUD backend already in place).
- P1: founder LinkedIn URL in AboutModal; hard-delete/cleanup for deleted sources & expired guest users; migration race-safety (atomic claim); touch/pointer support for the split divider; **upstash-redis / cross-instance cache** if multi-node staleness becomes a complaint; cache the remaining read endpoints (`audit`, `blockers`, `sources`, `memories`, `chat/history`) — one-liner per route, all already auto-invalidated.
- P2: split server.py into modules; signed short-lived source download URLs instead of ?auth=.
