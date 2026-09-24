# Pre-flight Check — 2026-09-24

> Verification pass before shipping `y/` (Next.js 16 + Postgres + Drizzle) to Vercel.
> Stack: `pnpm` + Next.js App Router + Auth.js + 4 Emergent REST clients + Neon.
> Source of truth for env keys: `migration/discovery/03-nextjs-architecture.md` §6.

---

## ✅ Pass

- **Step 1 — typecheck (`pnpm typecheck` → `tsc --noEmit`)**: clean exit, zero diagnostics. Type signatures across app/, lib/, components/ all line up.
- **Step 2 — test suite (`pnpm test --run` / `vitest run`)**:
  - **125 / 125 tests passing** across **25 test files** (~2.6 s wall clock).
  - Coverage includes: auth (`session`, `me`, `guest`), audit (`route`, `export`), sources (upload, link, list, delete, download), chat (`route`, `history`), milestones/blockers/commitments/goals (CRUD), tools (confirm, reject), preferences, state, and `lib/over-commitment`.
  - Note: exceeds the "121 tests, ~111 passing" baseline — additional fixes have landed since.
- **Step 5 — env vars documented**: `.env.example` lists every required key (Neon connection strings, Emergent Universal Key, proxy URL, AUTH_SECRET, app URL). No leftover Google / Anthropic / OpenAI / Minimax / Vercel Blob keys from the prior FastAPI / Mongo stack.
- **Step 6 — Vercel deploy plumbing**:
  - `y/package.json` declares `"build": "next build"` ✓
  - `y/next.config.ts` exists and is a valid empty `NextConfig` ✓
  - No `vercel.json` required for /bolt-deploy (Next.js auto-detected) ✓
- **Step 7 — API route registration**: 24 route handlers under `app/api/**/route.ts`, every one of them exports at least one HTTP verb. Full export inventory:

  | Route | Methods |
  | --- | --- |
  | `app/api/preferences/route.ts` | PUT |
  | `app/api/commitments/route.ts` | POST |
  | `app/api/chat/route.ts` | POST |
  | `app/api/goals/route.ts` | POST |
  | `app/api/state/route.ts` | GET |
  | `app/api/audit/route.ts` | GET |
  | `app/api/milestones/route.ts` | POST |
  | `app/api/sources/route.ts` | GET |
  | `app/api/blockers/route.ts` | POST, GET |
  | `app/api/blockers/[id]/route.ts` | PUT, DELETE |
  | `app/api/tools/reject/route.ts` | POST |
  | `app/api/tools/confirm/route.ts` | POST |
  | `app/api/commitments/[id]/route.ts` | PATCH, DELETE |
  | `app/api/chat/history/route.ts` | GET |
  | `app/api/goals/[id]/route.ts` | PATCH, DELETE |
  | `app/api/auth/me/route.ts` | GET |
  | `app/api/auth/guest/route.ts` | POST |
  | `app/api/auth/session/route.ts` | POST |
  | `app/api/audit/export/route.ts` | GET |
  | `app/api/milestones/[id]/route.ts` | PATCH, DELETE |
  | `app/api/sources/link/route.ts` | POST |
  | `app/api/sources/[id]/route.ts` | DELETE |
  | `app/api/sources/upload/route.ts` | POST |
  | `app/api/sources/[id]/download/route.ts` | GET |

---

## ⚠️ Warnings (non-blocking)

- **Next.js 16 `middleware` convention deprecated.** Build emits: `The "middleware" file convention is deprecated. Please use "proxy" instead.` Run `npx @next/codemod@canary middleware-to-proxy .` after deploy; runtime behavior is identical and the warning does not affect the shipped bundle.
- **Build hasn't produced a `.next/` artifact.** Cannot measure bundle size or asset warnings until the blocker below is cleared. No claim made about LCP / TTFB budgets yet — those will land in the post-deploy canary report.
- **`AUTH_URL` is only present in a comment** in `.env.example` (line 42). The active public URL is `NEXT_PUBLIC_APP_URL=http://localhost:3000` by default; configure both in Vercel project settings before the smoke step.

---

## ❌ Blockers

There is **one blocker** that must be fixed before deploy. It also gates the smoke test, so Steps 3 and 4 currently fail for the same root cause.

### B1 — `server-only` import leaks into the client bundle via `lib/emergent/llm.ts`

**Symptom (Step 4 — `pnpm build`):**

```
./lib/emergent/llm.ts:43:1
Error: You're importing a module that depends on "server-only".
This API is only available in Server Components in the App Router,
but you are using it in the Pages Router.
  import 'server-only'

Import traces:
  Client Component Browser:
    ./lib/emergent/llm.ts [Client Component Browser]
    ./components/coach/Header.tsx [Client Component Browser]
```

**Symptom (Step 3 — `pnpm tsx scripts/smoke-model.ts`):**

```
Error: This module cannot be imported from a Client Component module.
It should only be used from a Server Component.
    at .../node_modules/.pnpm/server-only@0.0.1/...
```

The same file crashes at import time under plain `tsx` (outside Next.js), which means even the env-error path can't be verified yet.

**Root cause:** `lib/emergent/llm.ts` mixes two kinds of exports behind a single `'server-only'` directive:

1. Pure data/types safe for client — `ProviderId`, `ModelEntry`, `MODEL_REGISTRY`, `MODEL_OPTIONS`, `getModel()`.
2. Server-only I/O — `streamChat`, `resolveApiKey`, `resolveProxyUrl`, the `ChatMessage` types, `Proposal` tooling block parsing, etc.

`components/coach/Header.tsx` (a `'use client'` component) and `scripts/smoke-model.ts` (a Node script) both legitimately need (1) but inherit (2) through the file boundary.

**Suggested fix (one PR, ~30 lines of movement):**

1. Create `y/lib/emergent/model-registry.ts` — *no* `server-only` import — re-exporting:
   - `ProviderId` type, `ModelEntry` interface, `MODEL_REGISTRY` const, `MODEL_OPTIONS` const, `getModel()`.
2. Slim `y/lib/emergent/llm.ts` to keep only server-side concerns. Top of file: `import 'server-only'`. Re-export `MODEL_REGISTRY`, `MODEL_OPTIONS`, `ProviderId`, `ModelEntry` from `./model-registry` so legacy `import { MODEL_REGISTRY } from '@/lib/emergent/llm'` call sites (`app/api/preferences/route.ts`, `app/api/chat/route.ts`) keep working unchanged.
3. Update imports:
   - `components/coach/Header.tsx`: `import { MODEL_OPTIONS } from '@/lib/emergent/model-registry'`
   - `scripts/smoke-model.ts`: `import { MODEL_REGISTRY, type ProviderId } from '@/lib/emergent/model-registry'` and `import { streamChat } from '@/lib/emergent/llm'` (separate lines).
   - `lib/proposal-tools.ts`: keep server-only, re-export `Proposal` from `./llm`.
4. Re-run `pnpm build`, `pnpm test --run`, `pnpm exec tsx scripts/smoke-model.ts` (still expected to exit 2 on missing `EMERGENT_LLM_KEY` — that's the desired error path).

This is a **single-day fix**; it does not touch auth, DB, ETL, or any other subsystem. Once merged, the rebuild + re-run of Steps 1-4 should be fully green within 10 minutes.

---

## 🚀 Deploy command

Once the blocker above is resolved and the bundle builds locally, ship to Vercel via the REST-only `/bolt-deploy` skill (no CLI install):

```bash
~/.claude/skills/bolt-deploy/bin/bolt-deploy.mjs vercel \
  --dir y \
  --build "cd y && pnpm install && pnpm build" \
  --token "$VERCEL_TOKEN"
```

(`--build` is required because the build step needs `pnpm install` followed by `pnpm build` — not a static `dist/` artifact.)

---

## 📋 Manual steps before deploy

- [ ] Clear blocker **B1** (split `lib/emergent/llm.ts` into `model-registry.ts` + slim `llm.ts`).
- [ ] Confirm a clean `pnpm build` writes `.next/` and exits 0.
- [ ] Re-run `pnpm test --run` to confirm 125 / 125 after the split.
- [ ] Run `pnpm exec tsx scripts/smoke-model.ts` against a *real* `EMERGENT_LLM_KEY`; confirm each provider returns text within the 10 s budget. (Without the key, the script must exit 2 with the env-error message — this is the desired graceful path.)
- [ ] Set `VERCEL_TOKEN` env var locally (and in CI secret store for future deploys).
- [ ] Provision Neon Postgres project; capture both connection strings from the Neon console with the **Pooled** / **Direct** toggle.
- [ ] Pull `EMERGENT_LLM_KEY` from the Emergent dashboard (must start with `sk-emergent-`).
- [ ] Run the ETL against a production Mongo dump before the first deploy:
  `pnpm tsx y/db/migrate-from-mongo.ts` (uses `MONGO_URL` and `DATABASE_URL_UNPOOLED`).
- [ ] Configure Vercel project env vars:
  - `DATABASE_URL` (pooled)
  - `DATABASE_URL_UNPOOLED` (direct)
  - `DATABASE_URL_DRIVER=auto`
  - `AUTH_SECRET` (32-byte base64 from `openssl rand -base64 32`)
  - `EMERGENT_LLM_KEY`
  - `INTEGRATION_PROXY_URL=https://integrations.emergentagent.com`
  - `AUTH_URL=https://v2.goalcoach.com`
  - `NEXT_PUBLIC_APP_URL=https://v2.goalcoach.com`
- [ ] Attach the `v2.goalcoach.com` custom domain inside the Vercel project.
- [ ] Execute the deploy command shown above.

## 📋 Manual steps after deploy

- [ ] Sign in to `https://v2.goalcoach.com` and complete the Emergent OAuth round-trip; verify cookie + JWT shape match the staging build.
- [ ] Send a chat message; confirm SSE deltas stream and the `[DONE]` sentinel fires.
- [ ] Confirm at least one tool-call proposal (`[[TOOLS]]` block) round-trips through `app/api/tools/confirm`.
- [ ] Upload a source file (PDF / DOCX / URL); verify Emergent Object Storage round-trip via `/api/sources/[id]/download`.
- [ ] Switch the model in the Header dropdown; refresh and confirm the chosen provider persists via `users.modelProvider`.
- [ ] Run the founder rubric — ≥ 7 / 10 per the PRD against the live `v2.goalcoach.com` URL.
- [ ] Flip DNS from `app.goalcoach.com` to the new Vercel project once green.
- [ ] Keep the legacy FastAPI + MongoDB stack on warm standby for 7 days behind a feature flag, then decommission.
