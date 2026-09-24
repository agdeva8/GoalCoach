# y/ — Archive

This directory was the scaffold for the GoalCoach Next.js migration (Phase 1).

**As of 2026-09-24, this directory has been emptied.** The backend code that
was built here has moved to `../api/`. The new UI components built here
(`app/coach/`, `app/page.tsx`, `components/coach/`, `components/ui/`)
were discarded in favor of keeping the original CRA frontend.

## What was tried

- Next.js 16 scaffold at this path
- Drizzle ORM schema for all 9 Mongo collections (now in `../api/db/schema.ts`)
- Drizzle migration `0001_init.sql` (now in `../api/db/migrations/`)
- ETL script `db/migrate-from-mongo.ts` (now in `../api/db/`)
- Emergent REST clients for auth, LLM, storage (now in `../api/lib/emergent/`)
- 9 typed tool definitions + executor (now in `../api/lib/proposal-tools.ts` and `../api/lib/proposal-executor.ts`)
- 95+ Vitest tests (now in `../api/app/api/**/__tests__/`)
- API parity audit (now in `../migration/discovery/04-api-parity-report.md`)

## What was discarded

- `app/coach/page.tsx` — the new 3-pane coach UI
- `components/coach/*` — Header, ChatConsole, MessageBubble, etc.
- `components/ui/*` — shadcn primitives stub
- `app/page.tsx` — the Next.js scaffold landing page

These were built as part of Wave 3 but the team decided to keep the
original CRA frontend (`../frontend/`) and just swap the backend to
the new Next.js API routes.
