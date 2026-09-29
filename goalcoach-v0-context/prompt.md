# GoalCoach — build the full app from scratch

This folder is the spec. **Read every file in it before writing any code.**
The three numbered docs (`00-`, `01-`, `02-`) are the source of truth,
in priority order. This `prompt.md` is the active spec — where the
prompt and the docs disagree, the prompt wins.

The spec covers the WHAT and the LOOK. The HOW (schema, routes,
package layout, build order) is your call as the engineer — pick the
cleanest approach that satisfies all of the above.

---

## What you're building

GoalCoach is a chat-first AI life coach for self-directed adults
juggling more than one active goal across different time horizons. The
wedge is one URL, one chat, with memory across sessions.

**There is no dashboard. No streaks. No calendar. No mobile app. No
settings page in v1.** The chat IS the product. The first user is the
founder; the coach must work without embarrassing them on day 1 and
without contradicting their own later recall on day 14.

The brand line is literal: **"Think through your goals, out loud."** —
do not invent alternative taglines.

---

## Read these files in order

1. `00-L0-product-kernel.md` — problem, user, wedge, premises, success criteria, onboarding revision. **LOCKED.**
2. `01-L1-ceo-strategy.md` — strategy, scope, Q1-Q8 founder decisions, success metrics, D14/D30 gates. **LOCKED.**
3. `02-L2-design-review.md` — visual + interaction spec: design tokens, type scale, storyboards, anti-slop copy rules, trust scenarios, a11y rubric.

---

## Tech stack (the founder's chosen stack — use this)

### Frontend

- **Framework:** React (Vite) with TypeScript
- **Styling:** Tailwind CSS
- **Components:** shadcn/ui or Radix UI primitives
- **Icons:** Lucide React (`lucide-react`)
- **State Management:** React Hooks / Zustand

### Backend

- **Go.** Use the standard library `net/http` by default (most idiomatic for learning Go). You may use Gin, Echo, or Fiber if you prefer a router framework. The backend's job: auth, chat streaming, data persistence, LLM proxying.

### Non-negotiables across both

- **Google OAuth only** for auth. No email/password, no magic-link, no anonymous fallback. The Google scopes must include the ones that let the user's OAuth access token call Gemini on their behalf.
- **Gemini as the production LLM**, called with the user's own OAuth access token. **No server-side Gemini API key.** You may keep an alternate LLM path for dev/test only.
- **A persistent chat history** that survives sessions — the coach has to remember what the user said last week.
- **A real-time streaming chat** response (SSE or equivalent) — the user sees tokens as the model emits them.
- **A persistent database** for goals, reflections, threads, feedback, and the user's selected life areas. Pick whichever DB fits your stack (Postgres is a safe default).

---

## Repo structure (monorepo, pnpm workspaces)

```
goalcoach/
├── apps/
│   ├── web/                ← React (Vite) frontend
│   └── api/                ← the Go backend
├── packages/               ← shared library code (data, prompts, llm clients — your call what to split)
└── supabase/
    └── migrations/         ← SQL migrations
```

---

## Voice

Precise and curious, not warm and supportive. **"The honest coach is harder to like but easier to trust."** Name the actual thing the user said; name the actual drift; name the actual over-commitment. Never validate ("Great job!"); never encourage ("Keep it up!"); never coach emotion ("You should be proud of yourself!").
