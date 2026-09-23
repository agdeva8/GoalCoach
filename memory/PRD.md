# GoalCoach — PRD

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

## Backlog / next
- P0 (next turn): **Calendar view + editable daily timetable + in-calendar blocker add/edit/remove** (blocker CRUD backend already in place).
- P1: founder LinkedIn URL in AboutModal; hard-delete/cleanup for deleted sources & expired guest users; migration race-safety (atomic claim); touch/pointer support for the split divider.
- P2: split server.py into modules; signed short-lived source download URLs instead of ?auth=.
