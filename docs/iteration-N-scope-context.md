# Iteration N — Scope-isolated chat conversations + state impact

Canonical spec: `/Users/deva/.opencode/plan/iteration-N-scope-context.md` (the master copy, kept current during iteration). This file is the read-only repo-side mirror for handoff.

**Status:** backend implementation in progress (steps 1-6 of section 15 done, step 7 in progress). Frontend implementation deferred — see section 19 (handoff checklist) for what's pending after the mobile session.

**Bug being fixed:** Add Goal chat bleeds the previous goal's conversation into the LLM prompt. Reproducer: open Add Goal, type a goal, close without confirming, reopen Add Goal, type "HU" — model plans for the old goal.

**Principle:** every CRUD operation is an atomic conversation. The LLM only sees the current operation's history; old operations live in sealed buckets.

---

## Quick summary

### Backend (DONE this iteration)

- `closed_at` column added to `conversations` (migration `0009_conversation_closed_at.sql` + `db/schema.ts`)
- `loadHistory` requires `conversationId` arg; filters by it
- `buildContext` is operation-aware (slim for `add_goal` / `plan_day` / `edit_goal` / `drop_goal`; full for `general`)
- `splitProseAndToolsAndImpact` + `parseImpact` + `StateImpact` type added to `lib/emergent/llm.ts`
- `[[IMPACT]]` block schema + operation-mode hints added to SYSTEM_PROMPT (`lib/llm/prompts.ts`)
- Chat route (`app/api/chat/stream/route.ts`) does defensive redirect on closed convs; emits `ref_id`, `conversation_id`, `redirected` in done event
- Confirm route (`app/api/tools/confirm/route.ts`) closes the conv in the same tx as proposal resolution + pre-mints next bucket for `add_goal`

### Backend (TODO)

- Test mocks updated for `splitProseAndToolsAndImpact`, `IMPACT_START`, `loadHistory` 3-arg signature
- New `scope-isolation.test.ts` regression test (the "HU plans for old goal" reproducer)
- Vitest suite green

### Frontend (TODO, deferred)

- `AddGoalDialog.js`: refIdRef, scope wiring, success banner append, SSE impact handler
- `ChatModal.js`: same pattern
- `ChatConsole.js`: render `role:'success'` + impact panel
- New `SuccessBanner.js` + `ImpactPanel.js` components (section 11 of canonical spec)
- Storybook stories: `TwoGoalsBackToBack`, `WithSuccessBanner`, `WithImpactPanel`

### New SSE events (wire-compatible)

```ts
// New event
{ type: 'impact', message_id, impact: StateImpact }

// Extended event
{ type: 'done', message_id, provider, ref_id, conversation_id, redirected }
```

### Conversation lifecycle

```
Open dialog → mint refId → POST /api/chat/stream (scope=goal, refId, kind=add_goal)
  → server creates conv_add_goal_<refId> (status=open)
  → loadHistory filters by conversationId → empty for fresh bucket
  → buildContext(operation-aware) → slim context for add_goal
  → LLM responds with prose + [[TOOLS]] + [[IMPACT]]
  → SSE: delta, tools, impact, done(ref_id)

User clicks Confirm
  → POST /api/tools/confirm
  → applyProposal commits state
  → SAME TX: conversations SET status='closed', closed_at=now()
              AND INSERT conv_add_goal_<newRefId> (status=open)
  → response: { ok, ref_id: newRefId, conversation_id }

User types next message → uses ref_id from confirm response
  → server routes to conv_add_goal_<newRefId> (empty bucket)
  → LLM never sees prior goal's chat history
```

### Defensive redirect (server-side)

If client sends a `refId` whose conv is already `status='closed'`, the server:
- Mints a fresh `new_goal_<uuid>`
- Routes the message to `conv_add_goal_<freshRefId>`
- Returns `done.redirected: true, ref_id: <freshRefId>`

The frontend already swaps refId on confirm, but this firewall guarantees the LLM never sees a sealed bucket even if the client is buggy.

---

## File map

| File | Status | Change |
|---|---|---|
| `api/db/migrations/0009_conversation_closed_at.sql` | NEW | adds `closed_at` column |
| `api/db/schema.ts` | EDITED | `closedAt` field on `conversations` |
| `api/lib/llm/state-builder.ts` | EDITED | `loadHistory` requires `conversationId`; `buildContext` operation-aware |
| `api/lib/emergent/llm.ts` | EDITED | `IMPACT_START`/`END`, `StateImpact`, `parseImpact`, `splitProseAndToolsAndImpact` |
| `api/lib/llm/prompts.ts` | EDITED | `[[IMPACT]]` schema + `=== OPERATION MODE ===` section |
| `api/app/api/chat/stream/route.ts` | EDITED | defensive redirect, scoped history, extended done, impact SSE |
| `api/app/api/tools/confirm/route.ts` | EDITED | close + pre-mint + extended response |
| `api/app/api/chat/__tests__/scope-isolation.test.ts` | NEW | 15-test regression suite (parser + loadHistory signature) |
| `api/app/api/chat/__tests__/route.test.ts` | EDITED | mocks updated for new signatures |
| `frontend/src/components/AddGoalDialog.js` | DONE | refIdRef minted per open, scope/refId/kind body, impact + done.redirected handlers, confirm swap + success banner |
| `frontend/src/components/ChatModal.js` | DONE | refIdRef seeded from `refId` prop (kind-mint fallback), same SSE + confirm wiring, generic banner verb ("Created"/"Confirmed") |
| `frontend/src/components/FocusedTaskChatDialog.js` | DONE | full §10 contract: per-open refId mint, scoped body, impact/redirect handlers, confirm swap + banner |
| `frontend/src/pages/Coach.js` | DONE | focused-task openers pass `scope: "generic", kind: "plan_day"` (server needs scope AND refId for a scoped bucket) |
| `frontend/src/components/ChatConsole.js` | DONE | renders `role:'success'` → SuccessBanner and `message.impact` → ImpactPanel; optional `onViewGoal` prop (no `/goals/:id` route → button hidden) |
| `frontend/src/components/SuccessBanner.js` | NEW | inline confirm divider |
| `frontend/src/components/ImpactPanel.js` | NEW | `[[IMPACT]]` renderer |
| Stories | NEW/EDITED | `SuccessBanner.stories.js`, `ImpactPanel.stories.js`, `TwoGoalsBackToBack` (AddGoalDialog), `WithSuccessBanner`/`WithImpactPanel` (ChatConsole) |

Post-application: backend 230/230 tests + `tsc --noEmit` clean; 7 story previews render. Applied deltas vs. the sketch are recorded in §12.5 of the canonical plan file.

---

**For the full spec, see the canonical plan file at `/Users/deva/.opencode/plan/iteration-N-scope-context.md`.**
