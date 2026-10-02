# Iteration 9 — Mobile UX + flow consolidation — SPEC (DRAFT, awaiting sign-off)

> Pre-build spec. Per AGENT_BUILDER.md MVP rule: 1 round of adversarial review + founder sign-off, then build.
>
> Covers: user feedback items **1, 2, 3, 4, 7, 8, 9, 10** from the mobile test report.
> Item **11** (agent architecture) deferred to Iteration 10 with its own HLD.

---

## Decisions (locked — pre-build Q&A confirmed)

1. **Mobile nav for guests**: unified avatar/hamburger shell across both personas. Guests see a "Guest" avatar chip (initial + "G") that opens the same menu.
2. **Refine/Reject UX**: single modal form, no chat reply. Refine → modal textarea → server one-shot LLM re-propose → replaces the old proposal in place. Reject → modal "why?" field → records reason + closes.
3. **Chat-history isolation**: scoped dialogs (AddGoalDialog, FocusedTaskChatDialog, ChatModal when opened with a scope) **never** fetch `/api/chat/history`. Only the unscoped "Chat with coach" surfaces history. The general bucket stays the only place history accumulates.
4. **Icon regen path**: I write the SVG + `scripts/regen-icons.mjs` (`yarn add -D sharp`); founder runs the script. SVG + script ship in the commit.
5. **Refine audit entry name**: `refine:proposal` with `thought`, `before`, `after` (args delta). Reuses the existing audit table.
6. **Reject endpoint shape**: extend `/api/tools/reject` to accept an optional `reason` field. One endpoint, two call shapes.
7. **Back-button URL noise**: search params only (`?panel=state&dialog=chat&…`), never path. Mirrors the existing `panel` pattern.
8. **Quick-fill chips in action / refine / reject modals** (added in build per founder's mid-slice feedback — "in some places like the remove goals or remove commitment, refine commitment, add the chips"). Each modal gets a per-action chip library that pre-fills the textarea; the user can still edit. Tapping a second chip appends with a comma.

---

## Out of scope

- Agent architecture (Iteration 10)
- Mobile install flow (unchanged)
- Calendar view + editable daily timetable (already on P0 backlog, unchanged)
- New audit / over-commitment surfaces
- Auth, OAuth, model selection

---

## Slice 9a — Mobile shell + chat input + icon

### 9a.1 — Mobile nav unification (REVISED to match user feedback)

**Per founder feedback:** the hamburger **is removed entirely**. Two menus exist:
  1. **Profile area** (avatar / Guest chip): opens Settings / Theme / About / Sign out (or Sign in for guests). On desktop it stays the existing small avatar dropdown.
  2. **Goal dropdown** (a new chevron next to the active screen name): for screens OTHER than Goals. Goals is the default landing.

**Files**

| File | Change |
|---|---|
| `frontend/src/components/Header.js` | Remove the `<Sheet>` hamburger entirely. The avatar chip / "Guest" chip stays and opens a small profile menu (Settings / Theme / About / Sign out / Sign in). Add a NEW `<GoalMenu>` component that renders next to the active screen name on mobile (and as the tab strip on desktop) — clicking opens a dropdown of screens (Today / Timeline / Sources / Memories / Audit) with Goals already selected. Goals stays the canonical landing (no menu entry needed; just the dropdown trigger). |
| `frontend/src/components/GoalMenu.js` (NEW) | A `<DropdownMenu>` (shadcn) trigger + items. Renders the screens list with `aria-current="page"` on the active one. Same UX on mobile and desktop. |
| `frontend/src/pages/Coach.js` | The mobile-only `<div className="sm:hidden">` bar (line 394) gets the new `<GoalMenu>` next to the screen title. The desktop `<nav>` (line 414) gets the same menu — but with the full tab strip visible (no dropdown needed on wide screens). |
| `frontend/src/constants/screens.js` | (no change to data) — but document in the comment that Goals is the default and others are dropdown items. |
| `frontend/src/components/Header.stories.js` | Update stories to drop the "mobile drawer" variant; add "profile menu (signed-in)" and "profile menu (guest)" stories. |
| `frontend/src/components/GoalMenu.stories.js` | NEW — basic + with active selection. |

**Mobile header layout** (signed-in):

```
┌──────────────────────────────────────────────────┐
│  [logo]  Sutra           [Goals ▼]   [avatar]    │
└──────────────────────────────────────────────────┘
                                 ↓ tap avatar
                         ┌────────────────────┐
                         │ Deva               │
                         │ deva@gmail.com     │
                         ├────────────────────┤
                         │ Settings           │
                         │ [icon] Dark theme  │
                         │ About Sutra        │
                         ├────────────────────┤
                         │ Sign out           │
                         └────────────────────┘
                                 ↓ tap "Goals ▼"
                         ┌────────────────────┐
                         │ ● Goals            │  ← default landing
                         │   Today             │
                         │   Timeline         │
                         │   Sources          │
                         │   Memories         │
                         │   Audit            │
                         └────────────────────┘
```

**Mobile header layout** (guest):

```
┌──────────────────────────────────────────────────┐
│  [logo]  Sutra           [Goals ▼]   [Guest]     │
└──────────────────────────────────────────────────┘
                                 ↓ tap "Guest"
                         ┌────────────────────┐
                         │ Browsing as guest  │
                         ├────────────────────┤
                         │ Settings           │
                         │ [icon] Dark theme  │
                         │ About Sutra        │
                         ├────────────────────┤
                         │ Sign in            │
                         └────────────────────┘
```

**Desktop header** (signed-in): unchanged — `<nav>` with full tab strip + cluster + avatar.

**Desktop header** (guest): unchanged — Sign-in button.

**Implementation note:** the existing Radix `<Sheet>` (drawer) is **removed**, not repurposed. The avatar menu and goal menu are both `<DropdownMenu>` primitives — same component, two triggers.

### 9a.2 — Chat input layout

**Files**

| File | Change |
|---|---|
| `frontend/src/components/ChatConsole.js` | Restructure the composer. **Paperclip + link + send buttons move OUT of the textarea row**, into a row **below** the textarea. Textarea height bumped from 48px to ~64-72px and `max-h-40` → `max-h-56`. Mic button stays inline with send (or moves to the row below — to be decided in build based on screen real-estate). |
| `frontend/src/components/ChatConsole.stories.js` | New story: "with long message" verifying the height cap. Update "default" story for the new button-row layout. |

**New composer layout** (visual):

```
┌────────────────────────────────────────────┐
│  [attached source chips…]                  │
│  [speech wave when listening…]             │
│  [link input row when open…]               │
├────────────────────────────────────────────┤
│  ┌────────────────────────────────────┐    │
│  │ Think out loud…                    │    │  ← textarea (taller)
│  │                                    │    │
│  └────────────────────────────────────┘    │
│  ┌─────┐ ┌─────┐ ┌─────┐     ┌─────┐ ┌───┐ │  ← button row (below)
│  │ 📎  │ │ 🔗  │ │ 🎤  │     │ ↗   │ │ ▶ │ │     paperclip / link / mic    send
│  └─────┘ └─────┘ └─────┘     └─────┘ └───┘ │
│  [mode select]      [status text…]          │
└────────────────────────────────────────────┘
```

### 9a.3 — "Confirm / Recreate" pinned button

**Files**

| File | Change |
|---|---|
| `frontend/src/components/AddGoalDialog.js` | When `step === "chat"` and the latest proposal is **pending AND has zero milestones** (`milestones.length === 0` or equivalent), render a pinned button **below the chat input row** that says **"Recreate goals & commitments"**. Click → re-runs the chat round-trip with a system-injected "your last proposal had no milestones, re-propose with milestones AND commitments" hint, then the user keeps chatting. When the latest proposal HAS milestones, render **"Confirm"** instead — single click writes the goal + milestones. The button hides once the user types anything in the textarea (refining takes over via Enter). |
| `frontend/src/components/AddGoalDialog.stories.js` | New story: "no-milestone proposal" showing the "Recreate" button. New story: "with-milestones proposal" showing the "Confirm" button. |

**Behavior rules** (locks):

- **No input typed, no proposal pending** → no button (chat is empty / mid-stream)
- **No input typed, proposal pending, NO milestones** → "Recreate goals & commitments" (orange/accent color)
- **No input typed, proposal pending, HAS milestones** → "Confirm" (success color)
- **User types anything in textarea** → button hides (Enter submits, refine flows apply)
- **After Confirm/Recreate click** → button re-renders based on the new pending proposal state

### 9a.4 — App icon regen

**Files**

| File | Change |
|---|---|
| `frontend/public/favicon.svg` | Rewrite the mark to **center on the squircle**. Move all guru paths so the visual center of mass sits at viewBox (16, 16). Bump the lotus-base padding down so the mark doesn't crowd the bottom edge. |
| `frontend/public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png` | Regenerate from the new SVG via a one-off `node scripts/regen-icons.mjs` that uses `sharp` to rasterize (or hand-render in dev tools). Maskable variant needs the mark inside the safe circle (centered, 40% diameter). |
| `frontend/public/apple-touch-icon.png` | Same regen (apple icon is 180×180). |
| `frontend/public/manifest.json` | (no change — color and theme_color stay; only the icon files change) |

**Brand constraints** (already locked):

- Background: warm ink `#1F1B16` (deep squircle) — NOT pure black, but reads as black on a launcher
- Mark color: saffron/cream `#F7F2E7` and `#F2C795` accents
- Mark must be **centered** in the safe area (maskable = inside inner 40% circle)

I cannot regenerate PNGs from within this tool without a rasterizer. **Two paths to ship this:**

- **Path A1 (recommended):** I rewrite the SVG so it's correct, then YOU run a 30-line `node scripts/regen-icons.mjs` (`yarn add sharp` if not already installed; the icon regen is the only place we need it). I write the script, you run it.
- **Path A2:** I write the SVG + a small Python snippet using Pillow that re-rasterizes the PNGs. You run it.

If you'd rather, I can also hand-deliver a new `icon-512.png` as a base64 dump and you paste it — but the SVG is the source of truth either way.

---

## Slice 9b — Flow + isolation

### 9b.1 — Refine / Reject as modal forms (no chat)

**Files**

| File | Change |
|---|---|
| `frontend/src/components/ToolConfirmationPrompt.js` | Remove the inline refine textarea. The "Refine" button becomes a `data-testid="open-refine-modal"` button that calls a new prop `onOpenRefine(proposal)`. "Reject" button calls `onOpenReject(proposal)`. Confirm button unchanged. |
| `frontend/src/components/RefineModal.js` (NEW) | A `CenteredDialog` with title "What should change?" + textarea + Cancel / Send buttons. On send → calls a single server LLM round-trip and replaces the proposal in place. Empty / Cancelled → no-op. |
| `frontend/src/components/RejectModal.js` (NEW) | Same shell, title "Why reject this?" + textarea (required for "reject with reason"; optional toggle "skip reason"). On send → calls `api.reject(messageId, proposalId, reason?)` (extend reject route to accept optional reason). The modal is recorded in the audit log. |
| `frontend/src/components/ChatConsole.js` | Add `onOpenRefine` + `onOpenReject` props. Wire into `Message` rendering. |
| `frontend/src/components/AddGoalDialog.js`, `frontend/src/components/ChatModal.js`, `frontend/src/components/FocusedTaskChatDialog.js` | Each now owns the new modals, the `refine()` callback (currently sends into the chat stream — REMOVE), and the new one-shot `/api/chat/refine` call. |

**New server endpoint**: `POST /api/chat/refine`

```ts
// Body: { message_id: string, proposal_id: string, thought: string, scope?, refId?, kind? }
// Effect:
//   1. Loads the conversation + state.
//   2. Calls the LLM ONCE with a focused "re-propose taking into account: <thought>" prompt.
//   3. Parses the [[TOOLS]] block, replaces the OLD proposal in place (same proposal_id,
//      status: pending, updated args + content). Old args go into an audit `refined_from` field.
//   4. Returns { proposal, message_id } in the same shape `tools` SSE event used.
//   5. Audit log entry: `refine:proposal` with the thought + before/after diff.
```

`api/app/api/chat/refine/route.ts` (NEW). **No streaming** — this is a one-shot sync call. The modal just shows a loading spinner, then the proposal card updates in place.

### 9b.2 — Voice: manual stop, 1min fallback auto-pause

**Files**

| File | Change |
|---|---|
| `frontend/src/components/ChatConsole.js` | Change `recognition.continuous = true` and **disable** the recognition's own silence-detection. Instead, on each `onresult` event, reset a 60-second timer. If 60s passes with no `onresult` → call `recognition.stop()` ourselves and surface a "Listening paused — 60s of silence" status (non-error, just informational). The user can press the red stop button at any time and that always wins. |
| `frontend/src/components/ChatConsole.stories.js` | Update stories to note the voice behavior; no new test story needed (Web Speech API isn't mockable in isolation). |

**Status text changes:**

| State | Status |
|---|---|
| Listening, no transcript in last 60s | "Listening — tap the mic to stop" (unchanged) |
| Listening, 60s+ silence hit | "Paused after 60s of silence — tap to resume" |
| User clicked stop | "Stopped. Tap to start again." |
| Error (no-speech / not-allowed) | Existing error message |

### 9b.3 — Browser back closes dialogs (not exits app)

**Approach: dialog state in URL + back interceptor.** Two parts:

1. **URL-driven dialogs.** `chatOpen`, `focusedTask`, `sourceDialogMode`, `boundaryConfirm`, `addGoalOpen`, `actionModal` — all migrated to URL search params (`?dialog=chat`, `?dialog=add-goal`, `?dialog=focused-task&taskId=…`, etc.). When a dialog opens it pushes a search-param entry; when it closes it pops. Same pattern as the existing `panel` param (see `Coach.js` line 320).
2. **Back-button interceptor.** A small hook `useDialogBack(dialogKey, onClose)` that calls `history.pushState({ dialog: dialogKey }, "")` on open and listens for `popstate` to fire `onClose`. The hook lives in `frontend/src/hooks/useDialogBack.js` (NEW).

**Files**

| File | Change |
|---|---|
| `frontend/src/hooks/useDialogBack.js` (NEW) | The hook. Pushes a `dialog` marker on open, listens for `popstate` and calls the supplied close handler. Returns `void`. |
| `frontend/src/pages/Coach.js` | Migrate dialog state. `chatOpen` becomes `searchParams.get('dialog') === 'chat'`. The header back affordance already exists (line 396). |
| `frontend/src/components/ChatModal.js` | Read its open state from props (which now derive from URL). On close → strip the param. |
| `frontend/src/components/AddGoalDialog.js` | Same. |
| `frontend/src/components/FocusedTaskChatDialog.js` | Same. |
| `frontend/src/components/CenteredDialog.js` | Add an `onPopstateClose?: () => void` prop that the hook wires up. Internal listener calls it. |

**Trade-off:** URLs get a little noisy (`/?panel=state&dialog=chat&taskId=…`). Mitigation: the panel/dialog search params are not canonical links (don't show up in copy-link) and the router never writes them to the path. Back-button behavior is the only thing they're for.

### 9b.4 — Chat-history isolation for scoped dialogs

**Files**

| File | Change |
|---|---|
| `frontend/src/components/ChatModal.js` | The `historyLoaded` effect (line 107) only runs when `scope == null`. For scoped opens (any non-null scope/refId/kind), `setMessages([])` on open, no fetch. |
| `frontend/src/components/AddGoalDialog.js` | Already starts empty — no change. |
| `frontend/src/components/FocusedTaskChatDialog.js` | Already starts empty — no change. |

No backend change needed. The `api.history()` call still exists for the unscoped path. The leak stops because scoped dialogs never call it.

### 9b.5 — URL pre-check (item #4)

**Files**

| File | Change |
|---|---|
| `frontend/src/components/ChatConsole.js` | When the user submits a link (link form on line 469), do NOT immediately call `onAddLink`. Instead: `toast.message("Checking ${url}…")` → `api.previewLink(url)` (already exists at `lib/api.js:72`) → show a `LinkPreviewDialog` with the fetched title/description and a "Check this file or attach?" choice. The dialog has two buttons: **Attach** (calls `onAddLink`) and **Cancel**. If preview fetch fails (404/timeout) → show inline error + offer "Attach anyway" → on confirm, call `onAddLink`. |
| `frontend/src/components/LinkPreviewDialog.js` (NEW) | CenteredDialog with the fetched metadata + a "what was fetched" paragraph + Attach / Cancel buttons. |
| `frontend/src/lib/api.js` | `previewLink` exists (line 72) — verify it returns the right shape. |

**Backend verification:** `api/app/api/sources/link/preview/route.ts` should already exist (we saw it in `find api/app/api`). I'll verify the response shape matches the spec.

---

## Storybook story plan

New / changed stories:

- `Header.stories.js` — add "mobile drawer (signed-in)", "mobile drawer (guest)"
- `ChatConsole.stories.js` — update default for new button row; add "with long message" (textarea height cap); add "with pending proposal — no milestones" (Confirm/Recreate button)
- `AddGoalDialog.stories.js` — add "chat step with pending no-milestone proposal" (Recreate button visible); add "chat step with full proposal" (Confirm button visible)
- `ToolConfirmationPrompt.stories.js` — **remove** the "refining" variant (no longer an inline state); add "click refine" (calls new modal)
- `RefineModal.stories.js` — NEW — empty + with thought + loading + error
- `RejectModal.stories.js` — NEW — empty + with reason + loading
- `LinkPreviewDialog.stories.js` — NEW — fetched / partial / failed

Total: ~10 new/updated stories. Per AGENT_BUILDER.md, the gallery stays at one happy-path per top-level component — these are happy-paths plus the state variants that prove the new behavior.

---

## Verification plan (MVP, slice-scoped)

Per `memory/AGENT_BUILDER.md` "Testing strategy and orchestration":

| Slice | What changes | Verify with |
|---|---|---|
| 9a.1 mobile nav | presentational (Header.js only) | Storybook stories + 390×844 viewport screenshot |
| 9a.2 chat input layout | presentational (ChatConsole.js) | Storybook stories + 390×844 screenshot |
| 9a.3 confirm/recreate button | presentational + button-click logic | Storybook stories (state variants) |
| 9a.4 icon | presentational (PNG + SVG) | Open the SVG in browser at 192×192 + 512×512; visually verify centering |
| 9b.1 refine/reject modals | presentational + **new `/api/chat/refine` endpoint** | Storybook stories for modals + `curl` smoke against the new route |
| 9b.2 voice config | Web Speech API (not mockable) | Storybook stories for the status states; founder verifies the 60s silence + red stop button in real device |
| 9b.3 router back | routing logic | Storybook can't really test this — needs dev instance + manual back-button test |
| 9b.4 chat-history isolation | no code, just removed call | Dev instance: open add-goal chat, then drop-goal chat — confirm no history bleed |
| 9b.5 URL pre-check | new dialog + backend endpoint | Storybook + curl `/api/sources/link/preview` |

**E2E fleet (Stages A→E)**: NOT used at MVP. Per AGENT_BUILDER.md, main agent verifies inline via `agent-browser` on dev instance (`http://localhost:3002`).

---

## Risks + open questions

1. ~~**PNG icon regen**. I can't rasterize without a tool.~~ **LOCKED** — Path A1: I write the script, founder runs.
2. ~~**New `/api/chat/refine` endpoint** — audit entry name.~~ **LOCKED** — `refine:proposal`.
3. ~~**Reject with reason — extend or new endpoint?**~~ **LOCKED** — extend `/api/tools/reject`.
4. ~~**URL noise.**~~ **LOCKED** — search params only, never path.
5. **AboutModal / SignInModal / HonestyAuditView / GoalBoundaryConfirmDialog / GoalMemoryDialog / SourceActionDialog** are **not** in scope for the URL-driven back fix this slice. They don't carry the kind of state where "back" matters. If you want them in, flag it during sign-off.

### Remaining pre-build questions

None — all 5 blocking questions resolved.

---

## Iteration 10 (deferred) — Agent architecture

Out of scope here. Will get its own HLD conversation after 9 ships. Current recommendation (locked in the pre-build Q&A): **hand-rolled role-separated LLM calls (Option A) with state-machine discipline borrowed from LangGraph patterns, no new framework dep**.

---

## What I'd touch, file-by-file (final)

**Create (6):**
- `frontend/src/hooks/useDialogBack.js`
- `frontend/src/components/RefineModal.js` + `.stories.js`
- `frontend/src/components/RejectModal.js` + `.stories.js`
- `frontend/src/components/LinkPreviewDialog.js` + `.stories.js`
- `frontend/src/components/RefineReject.stories.js` (combined group if needed)
- `api/app/api/chat/refine/route.ts` + `__tests__/route.test.ts`

**Modify (existing):**
- `frontend/src/components/Header.js` + `.stories.js`
- `frontend/src/components/ChatConsole.js` + `.stories.js`
- `frontend/src/components/AddGoalDialog.js` + `.stories.js`
- `frontend/src/components/ToolConfirmationPrompt.js` + `.stories.js`
- `frontend/src/components/ChatModal.js`
- `frontend/src/components/FocusedTaskChatDialog.js`
- `frontend/src/components/CenteredDialog.js`
- `frontend/src/pages/Coach.js`
- `frontend/public/favicon.svg`
- `frontend/public/icons/*` (regenerated via script)
- `api/app/api/tools/reject/route.ts` (extend to accept `reason`)

**No change:**
- `api/app/api/chat/stream/route.ts`
- `api/app/api/chat/history/route.ts`
- `api/app/api/sources/link/preview/route.ts` (verify shape only)
- All other dialogs, components, routes

---

## Reporting at ship

- PRD diff: append `## Iteration 9 (YYYY-MM) — shipped` block summarizing 9a + 9b
- Verified line: how the slice was verified (Storybook + dev instance)
- Repro steps for founder to verify in browser
- List of follow-ups (icon regen mechanism, iteration 10 prep)

---

**Status:** All 5 blocking questions resolved. Awaiting founder sign-off on the spec before I touch any code.

**Sign-off means:** you've read `memory/iterations/iteration-9-spec.md`, you're happy with the file list, the verification plan, and the scope boundaries (9a + 9b, icon in, agent architecture out). Once you say "ship it" / "go" / "approved" / equivalent, I implement against this spec.

**Spec review checklist for you:**

- [ ] File list (Create 6, Modify ~11) matches what you'd expect
- [ ] Storybook story plan (~10 stories) is acceptable — no extras needed
- [ ] Verification plan: Storybook for presentational, dev instance + curl for backend, founder verifies voice + back-button on real device
- [ ] Risks acknowledged (icon regen mechanism, audit entry name, URL noise, dialog scope)
- [ ] Iteration 10 (agent architecture) deferred — confirmed OK