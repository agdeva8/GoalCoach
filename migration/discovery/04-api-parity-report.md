# GoalCoach — API Parity Report

Date: 2026-09-24
Source of truth: `backend/server.py` (Python + FastAPI + Mongo)
Target of truth: `y/app/api/**/route.ts` (TypeScript + Next.js Route Handlers + Drizzle on Postgres)

## Status: ⚠️ Partial parity with 2 blockers + 2 critical gaps

The new Next.js backend implements **19 of 21 FastAPI routes 1:1**, with **9 NEW direct-CRUD endpoints** for goals / commitments / milestones that did not exist in the FastAPI code (`backend/server.py` did not expose `POST /api/goals`, `PATCH /api/goals/{id}`, etc. — those rows were only ever written via `apply_proposal` triggered by the chat SSE route).

**Three FastAPI routes have no Next.js equivalent** (these are blockers):
1. `POST /api/auth/logout` — replaced by a server action (`lib/auth-actions.ts:signOutAction`), not an HTTP endpoint. Frontend calls `req("/auth/logout", { method: "POST" })` and will receive 404.
2. `POST /api/chat/guest_stream` — entirely absent. No replacement in `y/app/api/chat/*`. Front-end preview-mode LLM streaming is broken.
3. `GET /` — root health-check not implemented. Cosmetic.

**Drift** in two routes (functional but the request body key names differ):
- `POST /api/chat/stream` body now uses `autoAnswer` instead of `auto_answer`. Frontend (`frontend/src/pages/Coach.js:141`) still sends `auto_answer`, so the new route's `body.autoAnswer` is always `undefined`. Frontend would need to switch to camelCase (or the route must accept snake_case too).

---

## Summary table

| # | FastAPI endpoint | Next.js endpoint | Status | Notes |
|---|---|---|---|---|
| 1 | `POST /api/auth/session` | `app/api/auth/session/route.ts` | 🔄 MIGRATED | Emergent OAuth round-trip kept (`exchangeSessionId`). Drizzle on Postgres for users/user_sessions upsert. `picture` ↔ `image` field rename. |
| 2 | `GET /api/auth/me` | `app/api/auth/me/route.ts` | 🔄 MIGRATED | Same snake_case response shape; Drizzle lookup vs Motor. |
| 3 | `POST /api/auth/logout` | **none** | ❌ MISSING | `lib/auth-actions.ts:signOutAction` is a server action, not an HTTP route. Frontend hits 404. |
| 4 | `POST /api/auth/guest` | `app/api/auth/guest/route.ts` | 🔄 MIGRATED | Same session-cookie + user-row flow. TTL reduced 7d → **10 minutes** (architecture locked decision #3). |
| 5 | `PUT /api/preferences` | `app/api/preferences/route.ts` | 🔄 MIGRATED | Same field → `users.modelProvider`. Drift: legacy `'anthropic'` alias accepted (registered as `'claude'`). |
| 6 | `GET /api/state` | `app/api/state/route.ts` | 🔄 MIGRATED | Same `loadState()` shape ported to Drizzle. **Adds** `audit_summary.recent` + `generated_at` keys (dashboard feature; not harmful — extra fields). |
| 7 | `GET /api/audit` | `app/api/audit/route.ts` | 🔄 MIGRATED | Same top-level array of `{id,user_id,type,summary,payload,created_at}`. Adds optional `?type=`, `?limit=`, `?before=` pagination (backward compatible). |
| 8 | `GET /api/audit/export` | `app/api/audit/export/route.ts` | 🔄 MIGRATED | Same JSON-dump response with `Content-Disposition: attachment`. Filename format `goalcoach-export-${userId}-${date}.json` (was `goalcoach-export.json`). |
| 9 | `GET /api/chat/history` | `app/api/chat/history/route.ts` | 🔄 MIGRATED | Same response array. Adds `?limit=` query param. `proposals` split from embedded array → separate `proposals` table (relational). |
| 10 | `POST /api/chat/stream` | `app/api/chat/stream/route.ts` | ⚠️ DRIFT | Same SSE wire format (`type:'delta'|'tools'|'done'|'error'`). **`auto_answer` field renamed to `autoAnswer`**. Adds optional `provider` override. |
| 11 | `POST /api/chat/guest_stream` | **none** | ❌ MISSING | No replacement in `y/app/api/chat/*`. Frontend preview-mode LLM streaming is broken. |
| 12 | `POST /api/tools/confirm` | `app/api/tools/confirm/route.ts` | 🔄 MIGRATED | Same `{result, state}` response (state now `{needs_refresh:true}` for DB path — frontend must re-fetch). |
| 13 | `POST /api/tools/reject` | `app/api/tools/reject/route.ts` | ✅ MATCH | Same `{ok:true}` response, same audit log emission. |
| 14 | `POST /api/blockers` | `app/api/blockers/route.ts` | ✅ MATCH | Same `Blocker` response shape, same `end_date || start_date` fallback. |
| 15 | `GET /api/blockers` | `app/api/blockers/route.ts` (GET) | 🔄 NEW ROUTE | FastAPI had no GET /api/blockers; the only path was via /api/state. New route returns `{blockers:[]}` (different shape). |
| 16 | `PUT /api/blockers/{bid}` | `app/api/blockers/[id]/route.ts` | ✅ MATCH | Full-replace semantics preserved (matches Python `update_one` with `$set` over all fields). |
| 17 | `DELETE /api/blockers/{bid}` | `app/api/blockers/[id]/route.ts` | ✅ MATCH | Same hard-delete semantics. |
| 18 | `POST /api/sources/upload` | `app/api/sources/upload/route.ts` | 🔄 MIGRATED | Emergent Object Storage retained (not Vercel Blob). Same 20MB cap, same extension allowlist. Same response (sans `text_excerpt` which is intentional — client doesn't need it). |
| 19 | `POST /api/sources/link` | `app/api/sources/link/route.ts` | ✅ MATCH | Same Source shape, same `goal_title` denormalization. |
| 20 | `GET /api/sources` | `app/api/sources/route.ts` | ✅ MATCH | Same array of Source. Adds `?goal_id=` + `?limit=` query params (backward compatible). |
| 21 | `GET /api/sources/{sid}/download` | `app/api/sources/[id]/download/route.ts` | ⚠️ DRIFT | For `kind='link'` returns `{url}`. For `kind='file'` now returns `{url, content_type, filename}` where `url` is a **signed download URL** (FastAPI streamed bytes inline). Frontend must follow the redirect. |
| 22 | `DELETE /api/sources/{sid}` | `app/api/sources/[id]/route.ts` | ✅ MATCH | Same soft-delete (`isDeleted=true`). |
| 23 | `GET /` (health) | **none** | ❌ MISSING | Cosmetic. |

**Plus 9 NEW endpoints that exist in Next.js but NOT in FastAPI** (the table in the task brief listed them as "old endpoints" but they were never FastAPI routes — those writes were only ever via LLM proposals):

| # | Next.js endpoint | Status | Notes |
|---|---|---|---|
| A1 | `app/api/goals/route.ts` | 🔄 NEW | `POST /api/goals` for direct CRUD — not in FastAPI. Same `Goal` shape. |
| A2 | `app/api/goals/[id]/route.ts` | 🔄 NEW | `PATCH` (partial) + `DELETE` (soft = `status='dropped'`). FastAPI did not have direct goal-edit endpoints — drops were via `drop_goal` proposal action. |
| A3 | `app/api/commitments/route.ts` | 🔄 NEW | `POST /api/commitments`. |
| A4 | `app/api/commitments/[id]/route.ts` | 🔄 NEW | `PATCH` + `DELETE`. |
| A5 | `app/api/milestones/route.ts` | 🔄 NEW | `POST /api/milestones`. |
| A6 | `app/api/milestones/[id]/route.ts` | 🔄 NEW | `PATCH` + `DELETE`. |

---

## Per-endpoint detail

### POST /api/auth/session

- **Path:** ✅ same (`POST /api/auth/session`)
- **Method:** ✅ POST
- **Auth:** ✅ none (Emergent OAuth round-trip)
- **Request:** ✅ `{ session_id: string }` — `app/api/auth/session/route.ts:30-32` (`SessionBody interface`)
- **Response:** 🔄 shape similar but field-renamed:
  - Python: `data["picture"]` + DB column `picture` → `{"user": {..., "picture": ...}}`
  - TS: `emergentUser.picture` → DB column `image` → response field **`image`** (`route.ts:84-90`)
- **Logic:**
  - **OAuth exchange:** ✅ same Emergent URL `https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data` (`lib/emergent/auth.ts:67`) via `X-Session-ID` header
  - **User upsert by email:** ✅ same (`lib/auth.ts:181-244` upsertUserFromSession)
  - **Session cookie:** ✅ `session_token` 7-day HttpOnly (matches `server.py:145-148`)
  - **Guest-data migration on sign-in:** ✅ done in `lib/auth.ts:246-275` (`migrateGuestRowsToUser`) — reassigns 8 child tables (`goals`, `commitments`, `milestones`, `blockers`, `messages`, `audit_log`, `sources`, `state_overrides`), deletes guest row + sessions. (Note: this is split across 8 separate `UPDATE` statements rather than a Mongo `update_many` loop — equivalent end state.)
- **Status:** 🔄 MIGRATED (intentional: Postgres, `picture→image` column rename, raw-SQL for `user_sessions`)
- **Notes:** One structural drift — the Python code accepts the **second** `session_secret` query param alongside `session_id` (see `backend/server.py` reads `body.session_id` only; the rest of the OAuth flow is via the same `X-Session-ID` header). The TS route only accepts `session_id` in body; if the OAuth redirect includes `session_secret`, it's silently dropped. **Check whether Emergent actually sends `session_secret`** — if so, this is a ⚠️ DRIFT (low-likelihood; the architecture plan §3 says `redirects back to /api/auth/session?session_id=...&session_secret=...`, and the new POST does not read `session_secret`).

---

### GET /api/auth/me

- **Path:** ✅ same (`GET /api/auth/me`)
- **Method:** ✅ GET
- **Auth:** 🔄 layered (Emergent OAuth `session_token` + `guest_token` cookies + `Bearer` header) — matches FastAPI's `get_current_user` ladder
- **Request:** — (none)
- **Response:** ✅ same snake_case shape: `{user_id, email, name, image, model_provider, is_guest}` (`route.ts:33-40` for OAuth path, `63-70` for guest path)
- **Logic:** ✅ Drizzle lookup of `users` row keyed by `id` from cookie/header. FastAPI used Mongo `users` collection keyed by `user_id`. Field-rename `picture → image` only — backend schema note.
- **Status:** 🔄 MIGRATED (intentional: Postgres + Drizzle)
- **Notes:** None — shape preserved 1:1.

---

### POST /api/auth/logout

- **Path:** ❌ MISSING — no `app/api/auth/logout/route.ts` (or any `route.ts` that exposes `POST /api/auth/logout`)
- **Method:** n/a
- **Auth:** n/a
- **Request:** n/a
- **Response:** n/a
- **Logic:** The functionality exists but as a **server action** (`lib/auth-actions.ts:117 signOutAction`), not an HTTP endpoint. `signOutAction` clears the `session_token` + `guest_token` cookies server-side, then redirects.
- **Status:** ❌ MISSING (HTTP endpoint)
- **Notes:** Frontend (`frontend/src/lib/api.js:21` `logout: () => req("/auth/logout", { method: "POST" })`) will receive a 404 from the new backend. Either the frontend must switch to invoking the server action via a form, or a thin POST route handler must be added that calls `signOut()` from `lib/auth.ts:281`.

---

### POST /api/auth/guest

- **Path:** ✅ same (`POST /api/auth/guest`)
- **Method:** ✅ POST
- **Auth:** ✅ none
- **Request:** — (none)
- **Response:** ⚠️ drift — FastAPI returned `{user: {...}}`; Next.js returns `{user_id, is_guest, expires_at}` (`app/api/auth/guest/route.ts:48-52`). Field shape per element matches but wrapper differs.
- **Logic:**
  - **Cookie name:** ✅ same (`guest_token` in both; `lib/guest-token.ts:GUEST_TOKEN_COOKIE`)
  - **Cookie max-age:** ⚠️ changed — Python `7 * 24 * 60 * 60` (7 days) vs Next.js **10 minutes** (architecture locked decision #3; `lib/guest-token.ts:GUEST_TOKEN_TTL_SECONDS = 10 * 60`)
  - **`SameSite`:** drift — Python `samesite="none"` (and `secure=True`, `httponly=True`); Next.js `samesite="lax"` (and `httpOnly=true`, `secure: isProd`) (`guest/route.ts:54-65`)
  - **Users row:** ✅ same `id` prefix `guest_` + `name='Guest'` + `isGuest=true` + `modelProvider='gemini'` default
- **Status:** ⚠️ DRIFT (functional but the response wrapper and cookie policy changed intentionally; users created before the migration still have 7-day tokens in the database, but new guests get 10-min tokens per architecture decision)
- **Notes:** The `user_id` is now `guest_<16-hex>` from `generateGuestUserId()` instead of `guest_<12-hex>` from `uuid4().hex[:12]` — IDs are 1:1 compatible (both prefixed `guest_`) but the length differs. Also, `guest_token` value is now HMAC-signed (`lib/guest-token.ts:signGuestToken`), not opaque — different mechanism but same trust model.

---

### PUT /api/preferences

- **Path:** ✅ same (`PUT /api/preferences`)
- **Method:** ✅ PUT
- **Auth:** ✅ required (Bearer/session/guest-token ladder — `route.ts:54-81 authenticate`)
- **Request:** ✅ `{ model_provider: string }`
- **Response:** ✅ `{ model_provider: <echoed value> }` (`route.ts:149`)
- **Logic:**
  - **Provider validation:** 🔄 FastAPI whitelists `gemini | openai | anthropic`; Next.js whitelists `gemini | claude | openai | minimax-m3 | minimax-m2_7_highspeed` (5 providers per `MODEL_REGISTRY`) and accepts **`anthropic` as a legacy alias** for `claude` (`route.ts:42-47 resolveProviderId`).
  - **Persistence:** ✅ updates `users.modelProvider` (`route.ts:124-127`). Note that the response echoes the literal string the client sent (e.g. `'anthropic'`) but the DB column stores the canonical id (`'claude'`).
- **Status:** 🔄 MIGRATED (intentional: expanded provider list)
- **Notes:** None — backward-compatible (legacy `'anthropic'` alias is accepted).

---

### GET /api/state

- **Path:** ✅ same (`GET /api/state`)
- **Method:** ✅ GET
- **Auth:** ✅ required
- **Request:** — (none)
- **Response:** 🔄 same shape + 2 extras:
  - `{goals, commitments, milestones, blockers, sources, over_commitment:{level,message,conflicting,active_goals,open_commitments}}` ✅ preserved
  - **Adds** `audit_summary:{recent:[]}` and `generated_at:"<iso8601>"` (`route.ts:65-77`) — new dashboard feature
- **Logic:** 🔄 `loadState()` ported to Drizzle (`lib/llm/state-builder.ts:122-270`). Same over-commitment heuristic via `computeOverCommitment()`. Same source→goal grouping (`by_goal` in Python == `byGoal.get(g.id)` in TS).
- **Status:** 🔄 MIGRATED (intentional: extra fields; substance unchanged)
- **Notes:** None — additive change.

---

### GET /api/audit

- **Path:** ✅ same (`GET /api/audit`)
- **Method:** ✅ GET
- **Auth:** ✅ required
- **Request:** — (none, plus optional `?type=`, `?limit=`, `?before=` query params in Next.js — backward compatible)
- **Response:** ✅ top-level array of `{id,user_id,type,summary,payload,created_at}` (`route.ts:78-87`)
- **Logic:** 🔄 Drizzle `select()` from `audit_log` vs Motor `find()`. Filters/sorts match: `user_id = X AND is_deleted = false` (implicit in audit log) ORDER BY `created_at DESC LIMIT 1000`.
- **Status:** 🔄 MIGRATED (intentional: Postgres + Drizzle)
- **Notes:** None — same field set, snake_case preserved.

---

### GET /api/audit/export

- **Path:** ✅ same (`GET /api/audit/export`)
- **Method:** ✅ GET
- **Auth:** ✅ required (Emergent OAuth OR guest)
- **Request:** — (none)
- **Response:** 🔄 same shape, filename differs:
  - `{exported_at, user:{email,name}, state:{goals,commitments}, conversation[], audit_log[]}` ✅ (`route.ts:107-133`)
  - `Content-Disposition: attachment; filename="goalcoach-export-${userId}-${date}.json"` 🔄 — Python used bare `goalcoach-export.json`
- **Logic:** Same 4 collections fetched in parallel via `Promise.all` instead of sequential `await`. Maps each row to snake_case shape. Goal/Commitment serialization loses some fields vs FastAPI's `load_state` (only includes `id, title, horizon, status, created_at` for goals) — **minor drift**: this is intentional or an oversight depending on the consumer's expectations.
- **Status:** 🔄 MIGRATED (intentional: filename change; possibly unintentional: goal/commitment field subset)
- **Notes:** The goal/commitment serialization in the export was less complete than the Python's full `load_state` shape. If the Honesty Audit UI relies on full goal fields, this is a subtle functional drift.

---

### GET /api/chat/history

- **Path:** ✅ same (`GET /api/chat/history`)
- **Method:** ✅ GET
- **Auth:** ✅ required
- **Request:** — (plus optional `?limit=` in Next.js; Python returned full 2000 messages unconditionally)
- **Response:** 🔄 same shape, **proposals changed from embedded array to relational:**
  - FastAPI: each message has `proposals: [{id, action, status, ...}]` populated by `parse_proposals()` and merged into the message before persistence.
  - Next.js: messages split — `proposals` is a separate table; the route joins it back inline (`route.ts:135-168`) and spreads `args.*` into the proposal object so the wire shape looks like the old embedded form.
- **Logic:** Same overall (load N messages newest-first by `created_at` ASC + proposals for those messages). Proposals table now exists in Postgres (`db/schema.ts:proposals`) so they're queryable.
- **Status:** 🔄 MIGRATED (intentional: relational model; wire-compatible via spread)
- **Notes:** None — the `args.*` spread (`route.ts:161-165`) keeps `proposal.title`, `proposal.horizon`, etc. as top-level keys just like the FastAPI embedded shape.

---

### POST /api/chat/stream

- **Path:** ✅ same (`POST /api/chat/stream`)
- **Method:** ✅ POST
- **Auth:** ✅ required (Emergent OAuth + guest + Bearer ladder)
- **Request:** ⚠️ **DRIFT in key name:**
  - FastAPI: `{message: str, auto_answer: bool}` (snake_case)
  - Next.js: `{message: str, autoAnswer: bool, provider?: ProviderId}` (camelCase + optional provider)
- **Response:** ✅ same SSE wire format (`route.ts:24-31`):
  - `data: {"type":"delta","content":"…"}`
  - `data: {"type":"tools","message_id":"…","proposals":[…]}`
  - `data: {"type":"done","message_id":"…","provider":"…"}`
  - `data: {"type":"error","content":"…"}`
- **Logic:**
  - **Provider routing:** ✅ user-specific `modelProvider` honored; falls back to 'gemini'. `MODEL_REGISTRY` maps provider → (provider, model) tuple — same as `PROVIDER_MODELS` in Python.
  - **`buildContext`:** ✅ verbatim port — `lib/llm/state-builder.ts:buildContext()` preserves the byte-for-byte output of the Python `build_context` (`server.py:522-563`). Output header lines, bullet shapes, conversation tail all match.
  - **History:** ✅ last 24 messages (`HISTORY_LIMIT = 24`, `lib/llm/state-builder.ts:loadHistory`).
  - **Sources injection:** 🔄 Python injects `UPLOADED SOURCES` chip into the system context with a 4000-char budget; Next.js does NOT include source excerpts in the chat-time context (`app/api/chat/stream/route.ts` only calls `buildContext` which doesn't fetch source text_excerpts).
  - **Parser:** ✅ `parseProposals` verbatim from `server.py:566-594`. Wire format `[[TOOLS]]…[[/TOOLS]]` preserved.
  - **Persistence:** 🔄 split — assistant message + proposals written in one transaction AFTER the stream completes, not split into `before/after` writes like Python.
- **Status:** ⚠️ DRIFT (auto_answer→autoAnswer rename breaks the frontend; sources chip omitted)
- **Notes:**
  - **PRIMARY BREAKING ISSUE**: `frontend/src/pages/Coach.js:141` sends `{message, auto_answer}`. The new route reads `body.autoAnswer` (`route.ts:138`), which is always `undefined` when the FastAPI-shape JSON arrives. So `autoAnswer = false` always, regardless of UI toggle.
  - Sources chip is dropped — minor regression; the system prompt and the state builder still mention "use these to shape milestones and commitments" so the model may hallucinate about what's attached.

---

### POST /api/chat/guest_stream

- **Path:** ❌ MISSING — no `app/api/chat/guest_stream/route.ts`
- **Method:** n/a
- **Auth:** n/a
- **Request:** n/a (FastAPI expected `{message, history?:[], auto_answer}`)
- **Response:** n/a
- **Logic:** No replacement in `y/app/api/chat/*`. The architecture plan (`03-nextjs-architecture.md` §4) only mentions `/api/chat/route.ts` (which became `/api/chat/stream/route.ts`). Preview-mode streaming — the LLM-without-account flow — is not implemented.
- **Status:** ❌ MISSING
- **Notes:** **FRONTEND BLOCKER for unauthenticated preview.** Needs a new `app/api/chat/guest_stream/route.ts` that:
  - accepts `{message, history?, auto_answer}` (snake_case) without auth
  - constructs a `LlmChat` with `system_message = SYSTEM_PROMPT + "=== LIVE STATE & MEMORY ===" + preview header`
  - streams SSE in the same `delta|tools|done|error` shape
  - does NOT persist anything (preview mode)

---

### POST /api/tools/confirm

- **Path:** ✅ same (`POST /api/tools/confirm`)
- **Method:** ✅ POST
- **Auth:** ✅ required (Bearer/session/guest ladder — `route.ts:50-58 authenticate`)
- **Request:** ✅ `{message_id, proposal_id}` — backend reads `proposal_id` to find the proposal row (`route.ts:113`); `message_id` is optional/ignored at DB layer (proposals table has its own FK).
- **Response:** 🔄 FastAPI returned `{result: str, state: <full state dict>}`; Next.js returns `{ok:true, result, state}` — `state` is `{needs_refresh:true}` for the DB path (`route.ts:256-260`), or the full state for the in-memory (test) path.
- **Logic:**
  - **Proposal lookup:** ✅ by `id` (Drizzle) vs `messages.find({id, user_id}, proposals: {id: proposal_id}})` filter (Python)
  - **Status pre-check:** ✅ same — 409 if `proposal.status !== 'pending'`
  - **Apply proposal:** 🔄 logic split into `lib/proposal-executor.ts:applyProposal` — 9 action types: `create_goal, update_goal, drop_goal, pause_goal, set_goal_dates, add_milestone, add_blocker, add_commitment, complete_commitment` (FastAPI equivalent: `server.py:312-424 apply_proposal`).
  - **Audit log:** 🔄 both write a `confirm:<action>` audit log row — Next.js does it in a transaction (`route.ts:236-251`); Python in two separate `await`s.
  - **State in response:** ⚠️ **DRIFT** — Python returns the full `load_state()` object; TS returns `{needs_refresh:true}` instructing the client to refetch. If frontend expects full state in the response, it will break.
- **Status:** ⚠️ DRIFT (state in response is a sentinel, not the full dict)
- **Notes:** Frontend reads `body.state.goals` in some paths (`frontend/src/lib/api.js`); confirm path needs verification.

---

### POST /api/tools/reject

- **Path:** ✅ same (`POST /api/tools/reject`)
- **Method:** ✅ POST
- **Auth:** ✅ required
- **Request:** ✅ `{message_id, proposal_id, reason?}` (reason optional, accepted by `route.ts:81-84`)
- **Response:** ✅ `{ok: true}` (`route.ts:204`) — identical to FastAPI
- **Logic:**
  - **Mark rejected:** ✅ updates `proposals.status='rejected'` + sets `resolvedAt` (`route.ts:189-191`)
  - **Audit log:** 🔄 writes `reject:<action>` row with optional reason (`route.ts:193-201`) — FastAPI uses static `'User rejected'` summary; TS adds `(reason)` if provided.
- **Status:** ✅ MATCH
- **Notes:** None.

---

### POST /api/blockers

- **Path:** ✅ same (`POST /api/blockers`)
- **Method:** ✅ POST
- **Auth:** ✅ required
- **Request:** ✅ `{title, start_date, end_date?, note?}` — zod-validated (`route.ts:39-49 CreateBlockerBody`)
- **Response:** ✅ full Blocker object (`route.ts:107-110`) — matches `server.py:859`
- **Logic:** ✅
  - `end_date || start_date` fallback preserved (`route.ts:73`)
  - `note || ''` fallback preserved
  - Side effect: **adds an audit_log row** with type `create:blocker` (`route.ts:87-98`). FastAPI did NOT add an audit row here — only proposal-driven blocker creates got audit entries (`server.py:382-393` writes a row to `audit_log` only when called via `apply_proposal`). Net: extra `create:blocker` audit entries appear in the new version for direct blocker creates. Harmless additive.
- **Status:** ✅ MATCH (with one extra audit_log row that wasn't in the FastAPI version)
- **Notes:** None — additive audit log is a feature enhancement.

---

### GET /api/blockers

- **Path:** 🔄 NEW — FastAPI had no `GET /api/blockers`; blockers were only ever returned through `GET /api/state` (as part of the `blockers` array key).
- **Method:** GET
- **Auth:** ✅ required
- **Response:** `{blockers: [...]}` — different wrapper than `/api/state` which returns it as a key
- **Logic:** Same underlying Drizzle select
- **Status:** 🔄 NEW ROUTE (additive, does not break parity)
- **Notes:** If frontend expected `req.get("/blockers")` to return a flat array, this would be a drift — but the FastAPI code never offered that endpoint, so this is a pure addition.

---

### PUT /api/blockers/{bid}

- **Path:** ✅ same (`PUT /api/blockers/{id}`)
- **Method:** ✅ PUT
- **Auth:** ✅ required
- **Request:** ✅ `BlockerIn` — zod-validated
- **Response:** 🔄 **FastAPI returned `{ok:true}`** (`server.py:868`); Next.js returns `{blocker:<serialized row>}` (`route.ts:119`). Both signal success; wrapper differs.
- **Logic:** Same — full-replace semantics via update of all fields. Adds audit row `update:blocker` (additive — FastAPI didn't audit this).
- **Status:** ⚠️ DRIFT (response wrapper)
- **Notes:** Verify frontend parses `{blocker}` vs `{ok}` — the FastAPI frontend code presumably reads `result.ok`.

---

### DELETE /api/blockers/{bid}

- **Path:** ✅ same
- **Method:** ✅ DELETE
- **Auth:** ✅ required
- **Request:** — (none)
- **Response:** ✅ `{ok: true}` (`route.ts:153`)
- **Logic:** ✅ hard-delete. Adds audit row `delete:blocker`.
- **Status:** ✅ MATCH
- **Notes:** None.

---

### POST /api/sources/upload

- **Path:** ✅ same (`POST /api/sources/upload`)
- **Method:** ✅ POST
- **Auth:** ✅ required
- **Request:** ✅ `multipart/form-data` with `file` and `goal_id` fields
- **Response:** 🔄 FastAPI response excludes `text_excerpt` (`server.py:912`); Next.js response also excludes it (`route.ts:129-142` — only snake_case fields). Same shape, but no `text_excerpt` in either.
- **Logic:**
  - **Object storage:** ✅ Emergent Object Storage retained — `lib/storage.ts:uploadFile` calls `PUT {INTEGRATION_PROXY_URL}/objstore/api/v1/storage/objects/{path}` with `X-Storage-Key` header (matches `server.py:put_object`). **NOT Vercel Blob** (architecture locked decision #2).
  - **Storage key init:** `lib/storage.ts:initStorage()` mirrors `server.py:init_storage()` (POST `{storage_url}/init` with `{emergent_key}`, returns storage_key).
  - **20MB cap:** ✅ same (`route.ts:66-71`, `MAX_SIZE_BYTES = 20 * 1024 * 1024`)
  - **Allowed extensions:** ✅ same set (`pdf, md, txt, csv, json, png, jpg, jpeg, docx` — `route.ts:21-23`)
  - **Path format:** 🔄 **DRIFT**: FastAPI used `{APP_NAME}/uploads/{user_id}/{uuid_hex}.{ext}` (`server.py:900`); Next.js uses `goalcoach/uploads/{user_id}/{...}.{ext}` via `lib/storage.ts:pathForUpload`. Modern storage layout may be incompatible with old `storage_path` values stored in Mongo unless rewritten in ETL.
  - **Text extraction:** ✅ `lib/sources.ts:extractText` mirrors `server.py:extract_text` (PDF uses `pypdf` → likely `pdf-parse` or `pdfjs-dist` in TS; non-PDF falls back to UTF-8 decode).
- **Status:** 🔄 MIGRATED (intentional: kept Emergent; storage path format may require ETL rewrite)
- **Notes:** The path-format change is a known migration risk per architecture plan §7 Risk 1 — ETL (`db/migrate-from-mongo.ts`) must rewrite `sources.storage_path`.

---

### POST /api/sources/link

- **Path:** ✅ same
- **Method:** ✅ POST
- **Auth:** ✅ required
- **Request:** ✅ `{url, title?, goal_id?}`
- **Response:** ✅ same Source shape (sans `text_excerpt`)
- **Logic:**
  - **goal_id ownership check:** ✅
  - **Fetch link text:** ✅ `lib/sources.ts:fetchLinkText` mirrors `server.py:fetch_link_text` (HTML/JS/CSS strip)
- **Status:** ✅ MATCH
- **Notes:** None.

---

### GET /api/sources

- **Path:** ✅ same
- **Method:** ✅ GET
- **Auth:** ✅ required
- **Request:** — (plus optional `?goal_id=`, `?limit=` query params in Next.js — backward compatible)
- **Response:** ✅ flat array of Source (sans `text_excerpt` — `route.ts:51` filters out via `eq(sources.isDeleted, false)` and the response shape omits it)
- **Logic:** ✅ filters `is_deleted=false`, sorts `created_at DESC LIMIT 500`
- **Status:** ✅ MATCH
- **Notes:** None.

---

### GET /api/sources/{sid}/download

- **Path:** ✅ same (`GET /api/sources/[id]/download`)
- **Method:** ✅ GET
- **Auth:** ✅ required (Emergent OAuth OR guest OR Bearer)
- **Request:** — (no body)
- **Response:** ⚠️ **DRIFT in body shape and behavior:**
  - FastAPI for `kind='link'`: `JSONResponse({"url": rec["url"]})` — server-side redirect reference.
  - FastAPI for `kind='file'`: **streams the file bytes inline** via `Response(content=bytes, media_type=...)` with `Content-Disposition: inline; filename="..."`.
  - Next.js for `kind='link'`: `{"url": <row.url>}` — matches.
  - Next.js for `kind='file'`: **`{"url": <signed-download-url>, "content_type": ..., "filename": ...}`** — returns a signed download URL (`lib/storage.ts:getSignedDownloadUrl` calls `GET {storage_url}/objects/{path}?download=1`) and **expects the client to fetch the bytes themselves**.
- **Logic:** Server-side byte streaming was replaced with signed-URL redirection. This is a behavior change for any consumer expecting the legacy `Content-Disposition: inline` wire format.
- **Status:** ⚠️ DRIFT
- **Notes:** If frontend uses `window.open(download_url)` expecting an attachment, this still works (signed URL serves the bytes). If frontend expected `fetch(download_url).then(r => r.blob())`, this still works. But if frontend expected `<a href>` to bypass redirect and inline-render, it would now redirect to Emergent's CDN — that's usually fine.

---

### DELETE /api/sources/{sid}

- **Path:** ✅ same
- **Method:** ✅ DELETE
- **Auth:** ✅ required
- **Request:** — (none)
- **Response:** ✅ `{ok: true}`
- **Logic:** ✅ soft-delete (`isDeleted=true`); no hard delete of the object in storage (preserves audit trail, matches `server.py:959`)
- **Status:** ✅ MATCH
- **Notes:** None.

---

### GET / (root health check)

- **Path:** ❌ MISSING — no `app/route.ts` health endpoint
- **Method:** GET
- **Auth:** — (none)
- **Response:** FastAPI returned `{message: "GoalCoach API"}`. Not implemented.
- **Status:** ❌ MISSING (cosmetic)
- **Notes:** Add `app/api/route.ts` returning `Response.json({message: "GoalCoach API"})` if health checks need it. Low priority — Vercel doesn't require a root endpoint.

---

## Critical issues (blockers)

1. **`POST /api/auth/logout` is missing as an HTTP endpoint** (`migration/discovery/04-api-parity-report.md` / `frontend/src/lib/api.js:21`). `logout: () => req("/auth/logout", { method: "POST" })` will 404. **Fix:** add `app/api/auth/logout/route.ts` that calls `signOut()` from `lib/auth.ts:281` and clears the cookie.

2. **`POST /api/chat/guest_stream` is entirely absent** (`y/app/api/chat/*` has only `stream/` and `history/`). Frontend preview-mode LLM streaming is broken. **Fix:** port `server.py:715-773` into `app/api/chat/guest_stream/route.ts` — no auth, snake_case `{message, history?, auto_answer}`, same SSE wire format.

3. **`POST /api/chat/stream` body key `auto_answer` was renamed to `autoAnswer`**, but the frontend (`frontend/src/pages/Coach.js:141`) still sends `auto_answer`. **Fix:** either add `body.auto_answer` fallback at `app/api/chat/stream/route.ts:138` (read both keys), or update the frontend to send `autoAnswer`.

## Minor issues (non-blocking)

1. `POST /api/auth/guest` response wrapper changed from `{user: {...}}` to `{user_id, is_guest, expires_at}`. Frontend code that reads `body.user.user_id` would break. (Verify frontend caller.)

2. `POST /api/tools/confirm` response wraps `state` as `{needs_refresh:true}` for the DB path; full `load_state()` is only returned in the in-memory test fallback path. Frontend expecting `body.state.goals` would have to refetch.

3. `PUT /api/blockers/{id}` response wrapper changed from `{ok:true}` to `{blocker:{...}}`.

4. `GET /api/sources/[id]/download` for file sources now returns a signed download URL (`{url, content_type, filename}`) instead of streaming bytes inline. Same end-result for `window.open(url)` callers; different for inline `<img src>`/`<iframe>` consumers.

5. `GET /api/chat/history` now requires explicit `Authorization: Bearer …` or a cookie — FastAPI used `get_current_user` which checks cookies only, then falls back to `Bearer`. The TS ladder accepts both, so this is parity.

## Migration deltas (intentional)

1. **Relational proposals** — `proposals` was an embedded array on `messages` in Mongo; it is now a dedicated table in Postgres. The `/api/chat/history` route reconstructs the embedded shape by spreading `args.*` into the proposal object so the wire format is unchanged.

2. **`picture` → `image` column rename** — Drizzle schema uses `image`; FastAPI/Mongo used `picture`. Both `auth/session` and `auth/me` map at the response boundary.

3. **Provider `anthropic` alias** — `MODEL_REGISTRY` uses `'claude'` but `'/api/preferences'` accepts `'anthropic'` as a legacy alias (`route.ts:42-47 resolveProviderId`). DB stores the canonical `'claude'`; the response echoes the literal string the client sent.

4. **`session_token` cookie** — formerly stored in `user_sessions` Mongo collection; now in Postgres `user_sessions` table queried via raw SQL (`lib/auth.ts:resolveSessionTokenUserId`). 7-day TTL preserved.

5. **`guest_token` cookie** — now HMAC-signed with `AUTH_SECRET` (10-minute TTL) instead of opaque random (7-day TTL). Locked architecture decision #3. Stored `user_sessions` table is queried for session_token linkage; guest_token is purely HMAC.

6. **Emergent Object Storage is retained** (per locked decision #2) — not Vercel Blob. The path format `goalcoach/uploads/{user_id}/{uuid}.{ext}` may differ from `goalcoach/uploads/{user_id}/{uuid_hex}.{ext}` in the Python version. ETL must rewrite `sources.storage_path` (architecture §7 Risk 1).

7. **`/api/state` adds `audit_summary.recent` and `generated_at`** to the response — additive keys, dashboard feature. The new dashboard's "Honesty Audit" panel renders `recent`.

8. **Audit + blocker CRUD endpoints now emit `audit_log` rows**. FastAPI's `POST /api/blockers` and `PUT /api/blockers/{id}` did not write audit entries (only the LLM-proposal path did); Next.js writes `create:blocker` / `update:blocker` / `delete:blocker` rows for direct CRUD too.

9. **9 NEW direct-CRUD endpoints** for goals, commitments, and milestones — `POST /api/goals`, `PATCH/DELETE /api/goals/{id}`, `POST /api/commitments`, etc. FastAPI didn't expose these (those rows were only ever written via `apply_proposal` from the LLM). The new routes match the Mongo row shape field-for-field.

10. **`GET /api/blockers`** — also a NEW additive route. Was only ever accessible via `GET /api/state` in FastAPI; now available standalone.
