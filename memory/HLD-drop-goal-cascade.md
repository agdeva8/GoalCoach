# HLD — Drop-goal cascade + impact preview

**Status:** implemented (pending founder browser verification)
**Owner:** main agent
**Related:** `memory/PRD-goal-planner.md` §5.5, `memory/PRD.md` (drop flow)

---

## 1. Problem

When a goal is dropped, only `goals.status` flips to `'dropped'`. Every
goal-scoped child row survives:

| Child table | Survives as | User-visible symptom |
|---|---|---|
| `commitments` (`goal_id`) | `status = 'open'` | still counts in load; still renders in Timeline + Today |
| `milestones` (`goal_id`) | `status = 'open'` | still renders as Timeline bars ("timelines not dropped") |
| `timetable_blocks` (`goal_id`) | row intact | today's slots still occupied ("timelines not shifted") |

Two code paths perform the drop, and neither cascades:

- `applyStatusChange()` — `api/lib/proposal-executor.ts:382` (the LLM
  propose→confirm path; `drop_goal`).
- `DELETE /api/goals/[id]` — `api/app/api/goals/[id]/route.ts:149`
  (direct/legacy path).

Read models compound it: `loadState()` (`api/lib/llm/state-builder.ts`)
filters **goals** by `status !== 'dropped'` but never filters
commitments/milestones by their **parent goal's** status. `Timeline.js`
does the same. So historic orphans (already-dropped goals) also linger.

## 2. Intended behavior (already in the PRD)

`memory/PRD-goal-planner.md` §5.5:

> the executor cascades the cleanup (orphaned commitments → `done` with a
> `note: 'goal dropped'`; orphaned milestones → soft-delete).

It was never implemented. This HLD implements it and adds the two
behaviors the founder requested on top:

1. **Preview before destroy.** Before applying, show exactly what will
   change (which commitments / milestones / blocks, how much weekly
   capacity is freed) so the user can accept or back out.
2. **Offer the re-plan.** If the drop frees capacity and other active
   goals remain, ask "you now have N h/week free — re-plan?".

## 3. Design

### 3.1 New module — `api/lib/goal-drop.ts`

Single owner of drop semantics.

- `resolveGoalRef(db, schema, userId, args)` — moved here from
  `proposal-executor.ts` (one resolver, two callers). Resolves a goal by
  `goal_id` first, then case-insensitive exact title, then a guarded
  substring fallback.
- `computeGoalDropImpact(db, schema, userId, ref)` — pure read. Returns:
  ```ts
  {
    goal_id, goal_title,
    commitments: [{ id, text, due }],        // status='open', capped list
    milestones:  [{ id, title, target_date }],
    timetable_blocks: [{ id, label, block_date, start_time, end_time }],
    counts: { commitments, milestones, timetable_blocks },
    freed_weekly_hours: number | null,       // goals.weekly_hours
    load_before, load_after,                 // Σ active weekly_hours
    budget_hours,                            // users.available_weekly_hours
    other_active_goals,
  }
  ```
- `dropImpactSentence(impact)` — deterministic one-liner the coach can
  surface ("This will close 2 commitments, remove 3 milestones and 1
  scheduled block, and free 6h/week.").
- `applyGoalDropCascade(db, schema, userId, ref, { auditType, reason })` —
  one transaction:
  1. `goals.status = 'dropped'`, `updated_at = now()`.
  2. open `commitments` for the goal → `status='done'`,
     `note = COALESCE(note,'') || ' | goal dropped'` (rows kept for the
     daily log + honesty audit; the `note` never overwrites an existing
     one).
  3. `milestones` for the goal → hard delete (matches the existing
     `DELETE /api/milestones/[id]` behavior; no migration needed).
  4. `timetable_blocks` for the goal → delete (frees the schedule).
  5. one `audit_log` row (`drop:goal` / `confirm:drop_goal`) whose summary
     carries the counts.

  Returns `{ impact, result }`; the `result` line names what was cleaned.

### 3.2 Wire both entry points

- `applyStatusChange` → drop branch delegates to `applyGoalDropCascade`;
  the **pause** branch is unchanged (pause is reversible — no cleanup).
- `DELETE /api/goals/[id]` → same cascade with audit type `drop:goal`.

### 3.3 Preview on the proposal

`POST /api/chat/plan` enriches every `drop_goal` proposal with
`args.impact = computeGoalDropImpact(...)` before persisting, and appends
`dropImpactSentence(impact)` to the coach's prose. The legacy SSE path
still works; its drop card simply shows no impact block.

### 3.4 Read-side defense (historic orphans)

`loadStateCore` selects `goal_id` on commitments + milestones (kept out of
the output shape) and drops any child whose `goal_id` belongs to a
dropped goal. This repairs goals dropped **before** this change without a
data migration and is belt-and-suspenders for anything the cascade
misses.

### 3.5 UI

- `ToolConfirmationPrompt` — for `drop_goal` with `args.impact`, renders a
  "What this changes" block (counts, freed hours, item names) above the
  confirm button. The confirm button is now the explicit gate (the old
  silent auto-apply is removed because the user must see the impact
  first).
- `FocusedTaskChatDialog` — after a successful drop that freed hours and
  left other active goals, shows a dismissible banner: *"You now have N
  h/week free. Re-plan your remaining goals?"* → `onRequestReplan` opens a
  `review_progress` chat (existing planner re-plan path; no new LLM flow).
- `Coach.js` — drops the `autoApplyDrop` wiring, adds `onRequestReplan`.

### 3.6 Re-plan triggers — `api/lib/replan-suggestions.ts`

One deterministic, **pure** evaluator over data the dashboard read model
loads (`state.goals`, `state.blockers`, milestones, commitments, goal-linked
timetable blocks, recent audit rows, and user weekly capacity). The evaluator
does no I/O; the read model adds user-capacity and timetable-block reads. It
returns `ReplanSuggestion[]`; the
dashboard exposes them as `state.replan_suggestions`.

| Trigger | Signal | Source |
|---|---|---|
| `capacity_freed` | a drop/pause audit within 7 days carries `freed_weekly_hours > 0` AND other active goals remain | `audit_log.payload` written by the cascade |
| `drift` | an active goal's `drift_status = 'at_risk'` | `recomputeGoalDrift` after relevant writes and once per user/day on a dashboard cache miss, so deadlines that passed while the user was away are detected |
| `blocker_collision` | a blocker `[start,end]` overlaps an active goal's `[start_date, target_date]` | `blockers` + `goals` |
| `infeasible_edit` | recent date edit makes the target past / start after target / open child dates exceed target; or a weekly-hours edit pushes known active load above capacity | edit audit payload + goals, milestones, commitments + user capacity |
| `timetable_collision` | a goal-linked scheduled block is outside that goal's start/target window or lands on a blocker day | `timetable_blocks` + `goals` + `blockers` |

Every suggestion carries a `prefill` that opens the existing
`review_progress` chat. **Nothing auto-runs** — the LLM still proposes, the
user still confirms via `/api/tools/confirm`.

UI: `ReplanSuggestions.jsx` renders the list on **Goals, Today, and
Timeline**, each row with a **Re-plan** button (opens `review_progress`)
and a per-session dismiss. `ReplanToast.js` shows one dismissible toast per
day for drift, infeasible edits, blocker collisions, and timetable
collisions, with a **Review plan** action. On re-plan the coach proposes date/scope changes the user
confirms through the normal proposal flow.

`DayPlanner` now lets a user optionally associate a time block with a
non-dropped goal. Editing preserves that association; after add/edit/delete,
the parent dashboard state refreshes so the conflict suggestion updates.

The read model exposes goal `start_date`, `drift_status`, `weekly_hours`,
and goal IDs on commitments/milestones so the evaluator can reason about
dates and capacity. These are additive state fields.

## 4. Non-goals

- **Auto re-flow of remaining goals' dates.** The freed capacity is
  automatically available to the next plan (Stage 3.5 already sums only
  `status = 'active'` goals), but the remaining goals keep their dates
  until the user accepts the re-plan offer. The offer opens the
  `review_progress` chat; nothing re-dates automatically.
- Sources / memories attached to the goal are left in place (they are
  user artefacts, not plan scaffolding).
- No schema migration: milestones/timetable blocks are hard-deleted;
  commitments are closed in place.

## 5. Tests

- `api/lib/__tests__/goal-drop.test.ts` — impact counts + freed hours;
  cascade closes commitments / deletes milestones + blocks / audits once;
  a childless goal still audits; `resolveGoalRef` id + title paths.
- `api/lib/__tests__/replan-suggestions.test.ts` — capacity-freed window +
  "something left to re-plan", pause capacity, drift flag, blocker overlap
  in/out, timetable/goal window and blocker collisions, infeasible date
  edits, weekly-hours over-capacity, clean-account no-op.
- Existing `proposal-executor`, `state`, and `goals/[id]` suites stay
  green (the drop path is covered through the shared cascade).

## 6. Follow-ups

- Feed `impact` into the drop_goal prompt context so the coach narrates it
  in its own voice (today the sentence is appended deterministically).
- Persist re-plan-suggestion dismissals (currently per-session).
- Optional soft-delete column for milestones if the honesty audit needs
  the removed rows re-readable (today the audit row records counts).
