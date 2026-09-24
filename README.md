# GoalCoach

GoalCoach is a goal-tracking and accountability app. The codebase has two
top-level pieces: the original CRA frontend and a new Next.js API backend
that replaced the legacy FastAPI service.

## Project structure

```
GoalCoach/
  frontend/       # Original CRA UI (React 18). Serves on port 3000.
  api/            # New Next.js 16 backend. Serves on port 3001.
  migration/      # Discovery + parity reports from the migration effort.
  y/              # Archive — superseded scaffold from Phase 1. Do not use.
```

The original `backend/` (FastAPI) was deleted on 2026-09-24 — it has been
superseded by `api/`.

## Quick start

Run the new backend:

```bash
cd api
pnpm install
pnpm dev          # serves on :3001
pnpm db:migrate   # creates tables
```

Run the original frontend (in another terminal):

```bash
cd frontend
REACT_APP_BACKEND_URL=http://localhost:3001 npm start   # serves on :3000
```

Open http://localhost:3000 — original UI, new backend.

## Verifying the backend

From inside `api/`:

```bash
pnpm typecheck       # tsc --noEmit
pnpm test --run      # vitest (114+ tests, 4 pre-existing failures acceptable)
pnpm verify          # typecheck + test + build
```
