# Plan: Iteration N — Goal-drop fix + Chat isolation + Persona tools + LLM list drift fix

**Date:** 2026-09-28
**Branch:** `fix/iteration-n-bugfix-isolation-persona`
**Goal:** Land four shipped-iteration-3 bugs/gaps in one slice, each independently verifiable:
1. Finish the documented goal-drop Phase-1 fix so a confirmed `drop_goal` actually removes the goal from backend + frontend.
2. Replicate the `AddGoalDialog` chat-isolation pattern across every "focused-task" entry point.
3. Drop the redundant `SignInModal` dev-login button + ship the persona cleanup scripts.
4. Align the `Header` LLM provider list with the backend `MODEL_REGISTRY` (drift fix).

This is iteration **N** in the four-iteration slicing agreed 2026-09-28 (bugfix → router+mobile → calendar/timetable → memory+visual).

---

## Context (what's wrong today)

### 1. Goal drop — confirmed but didn't drop

The bug is **named in source** at `api/app/api/tools/confirm/route.ts:215-233` with a Phase-1 partial fix already in place:

```ts
// Phase 1: propagate `success` — do NOT mark confirmed, do NOT return ok,
// when the executor reports failure. Returning 200 on a no-op is the bug
// behind "I dropped it, it confirmed, but it didn't drop".
const { success, result } = await applyProposal(...)
if (!success) {
  return NextResponse.json({ ok: false, result }, { status: 422 })
}
```

The Phase-1 fix handles the `success: false` case. But the user's complaint persists, so the remaining surface is:

- **Frontend state-propagation race.** `ChatModal.confirmProposal` (`frontend/src/components/ChatModal.js:189-215`) flips the proposal UI to `"confirmed"` immediately on `api.confirm` resolution, then calls `onStateChange?.(state)`. If the network call succeeded server-side but the React state didn't propagate (timing, exception between `setMessages` and `onStateChange`), the UI stays stale. The `Coach.state` is the only thing driving `TrackingDashboard.visibleGoals` etc. — if it's stale, the card persists.

- **`resolveGoalRef` ambiguity on short titles.** `api/lib/proposal-executor.ts:127-168` matches: `goal_id` first → exact case-insensitive title → substring only when `needle.length >= 6`. For short goal titles (e.g. "Sleep", "Run"), the LLM-emitted title may rephrase enough that exact match fails AND length < 6 → returns `success: false`. Today the Phase-1 fix surfaces this as 422, but the toast message ("No matching goal for 'X'") is easy to miss.

### 2. Chat state isolation — focused-task buttons share state with global chat

`AddGoalDialog` is the **only** dialog with its own `messages[]` (`AddGoalDialog.js:111-116`); it resets on every open. Every other "open chat from button" trigger funnels into the single global `ChatModal`:

| Trigger | Code | Lands in | Isolated? |
|---|---|---|---|
| FAB | `Coach.js:357` | global `ChatModal` | Generic chat — keep global |
| Header "Chat" | `Header.js:58` | global `ChatModal` | Generic — keep global |
| Storyboard scenario | `Coach.js:132` | global `ChatModal` | Generic — keep global |
| Timeline "chat" | `Coach.js:347` | global `ChatModal` | Generic — keep global |
| Empty-state CTA | `TrackingDashboard.js:286` | global `ChatModal` | Generic — keep global |
| `TrackerCard` chat | `TrackingDashboard.js:260` | global `ChatModal` | Generic — keep global |
| **`ActionPromptModal` "Send to coach"** | `Coach.js:391-393` | global `ChatModal` | **YES — focused on edit/pause/add-step/drop** |
| **`SourceActionDialog` boundary replan** | `Coach.js:224-234` | global `ChatModal` | **YES — focused on replan for source change** |
| **`GoalBoundaryConfirmDialog` replan** | n/a | `ChatModal` | **YES — focused on a specific goal edit** |

The user's complaint — "when the coach chat is open from some button ex add goal, then it should be clear state because the user focus is on that task right" — applies to the three focused-task dialogs above. They currently land in the global `ChatModal` with shared `messages[]`, then ask the user to paste context manually via toast (`Coach.js:143-145`).

### 3. Persona tooling — redundant dev-login button, drift in user count

- `SignInModal.js:89-104` has a `data-testid="signin-dev-button"` "Continue as Dev User (founders01)" one-shot. PersonaMenu supersedes it; the button is dead weight.
- `PersonaMenu` already exists in `Header.js` (gated on `ALLOW_DEV_LOGIN=true`), listing 6 personas: `founder`, `starter`, `overdue`, `dormant`, `dense`, `memory_heavy`. Seed + cleanup scripts exist at `api/scripts/seed-personas.ts`, `reset-dev-data.ts`, `cleanup-empty-guests.ts`, `cleanup-guests-by-id.ts`.
- The user has accumulated stray dev rows from prior testing; `reset-dev-data.ts --confirm` is the documented wipe.

### 4. Header LLM provider list drift

- Backend source of truth: `api/lib/emergent/model-registry.ts:55-78` (`MODEL_REGISTRY`) + L81-89 (`MODEL_OPTIONS`).
- `frontend/src/components/Header.js:6-10` declares its own LOCAL `PROVIDERS` array. Labels disagree with registry (Header says "Sonnet 4.6", registry says "Sonnet 4.5").
- The list is hardcoded in 4 places (Header has the LOCAL copy; other components don't yet). Single source of truth needs to live in the backend.

---

## Scope (HARD)

Only these four items. Do not touch:
- Calendar / timetable surfaces (iteration N+2)
- Router migration (iteration N+1)
- Visual / mobile refresh (iteration N+3)
- Memory ↔ timetable attachment (iteration N+3)
- New tables / migrations beyond what is strictly required for the goal-drop fix

---

## Stack constraints

- `api/` — Next.js 16 App Router + Drizzle + Postgres (Supabase). pnpm.
- `frontend/` — React CRA + Tailwind + shadcn/Radix + lucide. yarn.
- Edit existing files with `search_replace` (search-and-replace); never overwrite.
- `ALLOW_DEV_LOGIN=true` must stay set in `api/.env` for dev tooling to render.

---

## Architecture (per slice item)

### Item 1 — Finish the goal-drop Phase-1 fix

**Decision: combine (a) server-side guard for `drop_goal` without `goal_id`, (b) defensive frontend `refreshState()` after confirm.**

**Backend — `api/app/api/tools/confirm/route.ts` (extend Phase-1 fix):**

After the existing `applyProposal(...)` call, add:

```ts
// Phase 2: drop_goal is rephrase-prone; require explicit goal_id to
// avoid silently mis-targeting when the LLM rewrites the title. If
// the LLM insists on a title-only proposal, we still try the existing
// resolveGoalRef (exact → substring ≥ 6), but we surface the result
// in the toast so the user can correct it.
if (proposal.action === 'drop_goal' && !proposal.args?.goal_id) {
  // Don't reject outright — the user may have a 1-character title and
  // the substring fallback didn't fire. But always return the actual
  // executor outcome, and never report "ok" unless the row moved.
}
```

The Phase-1 422 path is sufficient — what we add is a **stronger precondition**: when `drop_goal` lacks `goal_id` AND the title doesn't resolve exactly, return 422 with a copy that names the missing goal:

```ts
if (!success) {
  // Strengthen the 422 message for drop_goal: surface the ambiguity
  // so the user can retry with a disambiguating title.
  const message = proposal.action === 'drop_goal' && !proposal.args?.goal_id
    ? `Couldn't drop that goal — title '${proposal.args.goal_title}' didn't match any goal. Tell the coach the goal's full name or use the goal_id.`
    : result
  return NextResponse.json({ ok: false, result: message }, { status: 422 })
}
```

**Backend — `api/lib/proposal-executor.ts` (test, no behavior change):**

Add a vitest under `api/lib/proposal-executor/__tests__/apply-status-change.test.ts`:

- `applyStatusChange` with `goal_id` present → `success: true`, row updated, audit row written
- `applyStatusChange` with `goal_id` absent + exact-title match → `success: true` (existing behavior)
- `applyStatusChange` with `goal_id` absent + only substring ≥ 6 → `success: true` (existing behavior)
- `applyStatusChange` with neither → `success: false`, **no DB write**, **no audit row** (pinned)
- After the row update, a SELECT confirms `status = 'dropped'`

**Frontend — `frontend/src/components/ChatModal.js:189-215` (`confirmProposal`):**

Rename the existing `onStateChange` prop to `onRefreshState` and call it instead of (or in addition to) the server-returned `state`:

```js
const confirmProposal = useCallback(
  async (messageId, proposalId) => {
    setBusyProposal(proposalId)
    try {
      const { result } = await api.confirm(messageId, proposalId)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                proposals: m.proposals.map((p) =>
                  p.id === proposalId ? { ...p, status: "confirmed" } : p
                ),
              }
            : m
        )
      )
      toast.success(result)
      // Defensive: ignore the server-returned state and refetch
      // /api/state from scratch. The server's response is a snapshot;
      // if anything slipped between setMessages and a stale setState,
      // the dashboard stays stale. refreshState() is the single source.
      await onRefreshState?.()
    } catch (e) {
      toast.error(e?.message || "Could not apply")
    } finally {
      setBusyProposal(null)
    }
  },
  [onRefreshState]
)
```

`Coach.js:374` wires `onRefreshState={() => refreshState()}`. `refreshState()` already exists at `Coach.js:97-105`. The prop rename cascades to the single caller (`Coach.js`); no other consumers.

### Item 2 — Replicate `AddGoalDialog` chat-isolation pattern

**Decision: three new focused-task chat dialogs**, each rendering an isolated `ChatConsole` inside `CenteredDialog` with its own `useState`. Generic chat (FAB, Header, storyboard, Timeline, empty-state CTA, TrackerCard) stays in global `ChatModal`.

**New files:**

1. `frontend/src/components/ActionPromptChatDialog.js`
   - Renders `CenteredDialog` + isolated `ChatConsole` instance
   - Props: `open`, `onClose`, `goalId`, `action` (edit|pause|drop|add_step), `prefillMessage`
   - Own state: `messages`, `input`, `sending`, `busyProposal`, `pendingClarifications`, `streamIdRef`
   - On open: reset all state, pre-fill `input` with `prefillMessage`
   - On close: full reset
   - History: starts empty (no `api.history()` call)
   - testid: `action-prompt-chat-modal`

2. `frontend/src/components/SourceReplanChatDialog.js`
   - Same shape as above, props: `open`, `onClose`, `sourceId`, `sourceTitle`, `changeKind`, `affectedGoalIds[]`
   - Prefill message: "The source '{title}' changed ({changeKind}). Replan goals: {titles}. Here's the situation: …"
   - testid: `source-replan-chat-modal`

3. `frontend/src/components/GoalEditChatDialog.js` (only if `ActionPromptChatDialog` cannot cover the action's "edit" variant cleanly — defer to implementation)
   - Covered by `ActionPromptChatDialog` if `action="edit"` works; otherwise add this file.

**Modified files:**

- `frontend/src/pages/Coach.js`:
  - `openAction(goal, type)` at `Coach.js:134` — when `type` is in `['edit', 'pause', 'drop', 'add_step']`, route to `ActionPromptChatDialog` instead of the global `ChatModal`. The `ActionPromptChatDialog` accepts the `action` prop and pre-fills the input with the right context for edit/pause/drop/add_step.
  - `handleBoundaryReplan` at `Coach.js:224-234` — route to `SourceReplanChatDialog`. Same toast removal.
  - `ActionPromptModal` "Send to coach" button at `Coach.js:391-393` — route to `ActionPromptChatDialog` instead of `setChatOpen(true)`.
  - Render the new dialogs alongside `ChatModal` at the bottom of `Coach.js`'s return.

- The pattern follows `AddGoalDialog.js:111-132` verbatim — own `useState` block, own `useEffect(() => reset on open)`, own render of `<ChatConsole>`.

### Item 3 — Persona tool cleanup

**Decision: drop redundant button + run reset-dev-data script + document the cleanup scripts in PRD.**

**Modified files:**

- `frontend/src/components/SignInModal.js` — delete L89-104 (the entire dev-login button block). The button is replaced by PersonaMenu's flow (`Header.js:152,164`).

- `memory/PRD.md` — append a "Personas + dev data" section after the existing "Backlog / next":

  ```markdown
  ## Personas + dev data

  Local dev tooling is gated on `ALLOW_DEV_LOGIN=true` in `api/.env`.

  **6 canonical personas** are seeded by `api/scripts/seed-personas.ts`:
  - `founder` — Dev User (the dev account, also rebuilt by `reset-dev-data`)
  - `starter` — Priya Nair — first-ever goal, empty planner
  - `overdue` — Marcus Bell — commitments past due date, one blocker
  - `dormant` — Ana Duarte — goals untouched for 21 days
  - `dense` — Kenji Sato — 6 goals, week fully booked
  - `memory_heavy` — Sofia Iqbal — 3 goals + photo/instagram memories

  **Cleanup commands** (run from repo root):
  - `pnpm --filter api exec tsx api/scripts/seed-personas.ts` — (re-)seed the 6 personas. Idempotent; uses `ON CONFLICT (id) DO NOTHING`.
  - `pnpm --filter api exec tsx api/scripts/reset-dev-data.ts --confirm` — wipe all dev rows (empty guests, stray `user_3ef522ac8105`/`user_634ced887623` accounts, founder rebuild). **Destructive.**
  - `pnpm --filter api exec tsx api/scripts/cleanup-empty-guests.ts --confirm` — delete `is_guest=true` users with no goals.
  - `pnpm --filter api exec tsx api/scripts/cleanup-guests-by-id.ts --confirm user_xxx,user_yyy` — targeted guest deletion.

  Use `PersonaMenu` (Header dropdown) to switch between personas once seeded.
  ```

**Operational step (in this iteration, after the SignInModal change lands):**

- Run `pnpm --filter api exec tsx api/scripts/reset-dev-data.ts --confirm` against the local dev DB.
- Run `pnpm --filter api exec tsx api/scripts/seed-personas.ts` to ensure the 6 personas exist post-reset.
- Confirm in the dashboard that PersonaMenu lists exactly 6 personas (no stray dev rows).

### Item 4 — Header LLM provider list drift fix

**Decision: expose `GET /api/preferences/models` from the backend; Header fetches it on mount. Single source of truth.**

**New file:**

- `api/app/api/preferences/models/route.ts`
  ```ts
  import { NextResponse } from 'next/server'
  import { MODEL_OPTIONS } from '@/lib/emergent/model-registry'

  export async function GET() {
    return NextResponse.json({ models: MODEL_OPTIONS })
  }
  ```
  No auth required — it's metadata, no credentials in the response.

**Modified files:**

- `frontend/src/lib/api.js` — add `models: () => req("/preferences/models")`.

- `frontend/src/components/Header.js`:
  - Delete LOCAL `PROVIDERS` array at L6-10.
  - Add `const [providers, setProviders] = useState([])` + `useEffect` that fetches `api.models()` on mount and on `user.user_id` change.
  - Replace hardcoded `PROVIDERS.map(...)` at L93-119 with `providers.map(...)`.
  - Defensive: while `providers` is empty, render a disabled "Loading…" placeholder rather than nothing (so the dropdown is always reachable).

- `api/lib/emergent/model-registry.ts` — already exports `MODEL_OPTIONS`. No change. Verify with grep that `Header.js` no longer defines a `PROVIDERS` constant.

---

## Files affected

### Created

- `api/app/api/preferences/models/route.ts` — list available LLM providers from registry
- `frontend/src/components/ActionPromptChatDialog.js` — isolated chat for `ActionPromptModal` triggers (covers edit, pause, drop, add_step via the `action` prop)
- `frontend/src/components/SourceReplanChatDialog.js` — isolated chat for source-boundary replan
- `api/lib/proposal-executor/__tests__/apply-status-change.test.ts` — pins the drop_goal semantics

### Modified

- `api/app/api/tools/confirm/route.ts` — strengthen 422 message for `drop_goal` without `goal_id`
- `frontend/src/components/ChatModal.js` — rename `onStateChange` prop → `onRefreshState`; `confirmProposal` calls it after success
- `frontend/src/pages/Coach.js` — wire new dialogs, remove redundant toast on focused-task triggers
- `frontend/src/components/Header.js` — fetch models from `/api/preferences/models`, drop LOCAL `PROVIDERS`
- `frontend/src/lib/api.js` — add `models()` helper
- `frontend/src/components/SignInModal.js` — delete dev-login button block
- `memory/PRD.md` — append Personas + dev data section

### NOT touched (deliberately)

- `Calendar.js`, `Timeline.js`, `Memories.js` — no surface change in this iteration
- `App.js` routing — iteration N+1
- `ChatModal`'s global state — kept for generic triggers (FAB, Header, storyboard, Timeline, empty-state CTA, TrackerCard)
- Backend auth flow — already dev-login + PersonaMenu supersede SignInModal's button
- New tables / migrations — none required for this slice

---

## Env vars

- None added
- `ALLOW_DEV_LOGIN=true` must remain set in `api/.env` for dev tools to render — already there

---

## Test plan

### Backend (vitest)

- `api/lib/proposal-executor/__tests__/apply-status-change.test.ts`:
  - drop_goal with `goal_id` present → success, DB row `status='dropped'`, audit row written
  - drop_goal without `goal_id` + exact title match → success
  - drop_goal without `goal_id` + substring ≥ 6 → success
  - drop_goal with neither → success: false, **no DB write**, **no audit row**
- `api/app/api/tools/confirm/route.ts` (integration):
  - drop_goal with valid `goal_id` → 200, audit row written, returned state includes the dropped goal
  - drop_goal without `goal_id` + non-matching title → 422 with strengthened message
- `api/app/api/preferences/models/route.ts`:
  - returns the registry list (3 entries: gemini, claude, openai)
  - no auth required (200 even without cookie)

### Frontend (manual repro at ship time, after fleet exploration)

1. **Goal drop**: open chat, ask coach to drop a goal, confirm → goal disappears from Goals tab + Timeline + Memories within 500ms (refreshState path).
2. **Chat isolation**: click "Edit" on a goal → isolated `ActionPromptChatDialog` opens with empty state + pre-filled input. Close. Reopen. Still empty state (reset). Verify the global `ChatModal` is unaffected (FAB still shows the same conversation).
3. **Source replan isolation**: open a source, click "Replan" → isolated `SourceReplanChatDialog` opens with empty state + pre-filled input.
4. **SignInModal**: open sign-in modal → no dev-login button.
5. **LLM list**: header dropdown shows "Gemini · 3 Flash", "Claude · Sonnet 4.5" (corrected from "Sonnet 4.6"), "OpenAI · GPT-5.4".
6. **Persona switch**: persona menu lists exactly 6 personas; switching lands on the right persona's data.

### Browser fleet (at ship time)

Per AGENT_BUILDER.md: items 1+2+3+4 are all **behaviour or surface changes** → full fleet fires.
- Stage A: 5 parallel explore agents covering all 6 personas × 2 viewports (1920×800, 390×844), exercising the focused-task dialogs, goal-drop, persona switching, LLM dropdown.
- Stage B: 2 verify agents re-run the above.
- Stage C: 3 bug-hunt agents (visual/feel/scroll, interaction/race/state, auth/data-leak/permission).
- Stage D: main agent fixes consensus-confirmed bugs.
- Stage E: 1 verify-only agent.

---

## TDD task order

1. **Red:** test that `applyStatusChange` with neither `goal_id` nor title match returns `success: false` and writes nothing → fails (no test yet).
2. **Green:** write the test, watch it pass against current behavior.
3. **Red:** test that `tools/confirm` returns 422 with strengthened message for `drop_goal` without `goal_id` and non-matching title → fails.
4. **Green:** update `tools/confirm/route.ts` message.
5. **Red:** test that `ChatModal.confirmProposal` invokes `onRefreshState` (renamed from `onStateChange`) after success → fails (prop still has old name).
6. **Green:** rename the prop in `ChatModal.js`, call `await onRefreshState?.()` after success, update the single caller in `Coach.js:374` to pass `onRefreshState={() => refreshState()}`.
7. **Red:** test that `/api/preferences/models` returns the registry list → fails.
8. **Green:** create the endpoint.
9. **Red:** test that `Header` renders no LOCAL `PROVIDERS` constant and uses the fetched list → fails (LOCAL exists).
10. **Green:** drop LOCAL `PROVIDERS`, fetch from endpoint.
11. **Red:** test that `ActionPromptChatDialog` resets state on every open → fails (component doesn't exist).
12. **Green:** create `ActionPromptChatDialog` with isolated state.
13. **Red:** test that `SourceReplanChatDialog` resets state on every open → fails.
14. **Green:** create `SourceReplanChatDialog`.
15. **Wire** new dialogs in `Coach.js` — replace the global `ChatModal` route for focused-task triggers.
16. **Red:** test that `SignInModal` no longer renders `signin-dev-button` → fails.
17. **Green:** delete the dev-login block from `SignInModal`.
18. **Final:** run `pnpm --filter api typecheck`, `pnpm --filter api test`, browser fleet.
19. **Docs:** append Personas + dev data section to `memory/PRD.md`.
20. **Cleanup script:** run `reset-dev-data.ts --confirm` then `seed-personas.ts` against local dev DB.
21. **Ship.** Founder verifies in browser. Browser fleet. Commit agent writes the commit message.

---

## Risks

1. **`refreshState` race** — calling `onRefreshState()` after `setMessages` is fine because `setState(next)` is idempotent, but if the user's chat has in-flight SSE events when the refetch lands, the order of operations matters. **Mitigation:** keep the order `setMessages` → `toast.success` → `await onRefreshState()` so the UI flips to "confirmed" instantly, then refetches state in the background. If the refetch fails, the user still sees "confirmed" (the server says it succeeded); the dashboard may show the goal until next navigation.
2. **New dialogs duplicate `ChatConsole` state setup** — copy-paste risk across `ActionPromptChatDialog`, `SourceReplanChatDialog`, `AddGoalDialog`. **Mitigation:** extract a `useIsolatedChat()` hook (deferred to iteration N+1 with router, when state isolation becomes URL-driven anyway).
3. **`/api/preferences/models` exposes model names** — informational leak only, no credentials. Documented in the route file. No mitigation needed.
4. **`reset-dev-data.ts --confirm` is destructive** — wipes founder + all empty guests + two known stray rows. The user explicitly asked for this; the founder confirms in writing before the script runs. Document the blast radius in the PRD addition.
5. **Browser-fleet at ship time is expensive** — 12 agents for the full chain. Per AGENT_BUILDER.md skip-downstream rules: if Stage B comes back clean, skip Stages C-E. Per-stage count configurable per slice; founder sets it.
6. **Goal drop bug fix touches the proposal executor** — risk of breaking other confirm flows (add milestone, edit goal, etc.). The test suite pins all four `applyStatusChange` paths; if any other path regresses, the test fails.

---

## Deferred (not in this pass)

- Router migration (`/goal/:id` etc.) — iteration N+1
- Calendar / daily timetable UI + `/api/timetable` CRUD — iteration N+2
- Memory ↔ timetable attachment — iteration N+3
- Visual / mobile refresh via `/superdesign` — iteration N+3
- Honesty audit coverage for memories + sources + future timetable — iteration N+3
- `useIsolatedChat()` hook extraction (defer to iteration N+1 when state becomes URL-driven)
- Per-provider model override (flash vs pro vs opus) — out of MVP scope
- New tables / migrations — none required

---

## Verification

- `pnpm --filter api typecheck` green
- `pnpm --filter api test` green (existing + new tests)
- `cd frontend && yarn build` green (Header now imports nothing local for the provider list)
- Local repro: drop a goal in chat → confirm → goal disappears from all three panels within 500ms
- Local repro: edit/add-step/replan buttons open isolated chat dialogs that don't share state with global `ChatModal`
- Local repro: SignInModal no longer shows the dev-login button
- Local repro: Header LLM dropdown shows corrected labels (Sonnet 4.5, not 4.6)
- Local repro: PersonaMenu shows exactly 6 personas after `reset-dev-data.ts --confirm` + `seed-personas.ts`
- Browser fleet (Stages A → E) returns clean or all confirmed bugs fixed
- Founder verifies in their own browser

---

## Attribution

Every commit ends with:

```
Co-Authored-By: Claude Code <noreply@anthropic.com>
```