# Sutra

Sutra is a goal-tracking and accountability app. The codebase has two
top-level pieces: the original CRA frontend and a new Next.js API backend
that replaced the legacy FastAPI service.

## Project structure

```
Sutra/
  frontend/       # Original CRA UI (React 18). Serves on port 3000.
  api/            # New Next.js 16 backend. Serves on port 3001.
  migration/      # Discovery + parity reports from the migration effort.
  y/              # Archive — superseded scaffold from Phase 1. Do not use.
```

The original `backend/` (FastAPI) was deleted on 2026-09-24 — it has been
superseded by `api/`.

## Quick start

Run both the API and frontend together with the unified launcher:

```bash
pnpm dev
# or
node scripts/dev.js
```

By default, this launches:
- **API (Next.js 16)** on `http://localhost:4000`
- **Frontend (React CRA)** on `http://localhost:3000`
- Automatically cleans up any previous processes occupying these ports before launch.

### Custom Ports
You can specify custom ports for either or both services:

```bash
# Using CLI flags:
node scripts/dev.js --api 4002 --web 3002
# or via pnpm dev:
pnpm dev -- --api 4002 --web 3002

# Or using environment variables:
API_PORT=4002 WEB_PORT=3002 pnpm dev
```

### Running services individually (optional)

Run the backend only:
```bash
pnpm dev:api       # serves on :4000 (or pnpm -C api dev -p <port>)
pnpm db:migrate    # run migrations
```

Run the frontend only:
```bash
pnpm dev:web       # serves on :3000
```

Open http://localhost:3000 — original UI, new backend.

## Verifying the backend

From inside `api/`:

```bash
pnpm typecheck       # tsc --noEmit
pnpm test --run      # vitest (114+ tests, 4 pre-existing failures acceptable)
pnpm verify          # typecheck + test + build
```
