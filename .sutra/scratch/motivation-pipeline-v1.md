# Motivation Pipeline v1 — Slice Plan

Status: in-flight. Owner: main agent (M3).

## Decisions (locked from HLD Q&A)

- Feature flag: ship **off** (`MOTIVATION_AGENT_ENABLED=false` in dev/test, unchanged). Prod flip is founder's call.
- Picker diversity: **≤ 1 pass per domain** (hostname).
- Frame: LLM (`gemini-3-flash`) with deterministic fallback.
- Tables: `motivation_cache` + `motivation_rejects` + `motivation_served_log` all ship now. Cron deferred.
- Frontend: zero changes. `MotivationCard` keeps reading `d.items`.

## File-by-file changes

### New files

1. `api/lib/motivation/catalogue.ts` — extract the 12-item `CATALOGUE` (and `frameItem` deterministic copy) out of `route.ts` so orchestrator + route fallback share one source.
2. `api/lib/motivation/state.ts` — `extractLackingSignals(userId, bucket)` + `computeStateHash(req)`.
3. `api/lib/motivation/picker.ts` — `pickTopN(scoredCandidates, n, bucket, userId)`; gates + domain-diversity + reject-log writes.
4. `api/lib/motivation/frame.ts` — `frameItem(candidate, bucket, top_reasons)` with cheap-model LLM + deterministic fallback.
5. `api/lib/motivation/recommend.ts` — the orchestrator. Sequences all stages, owns the 20s deadline + cost cap. Public API: `recommend(request: RecommendationRequest): Promise<RecommendationResponse>`.
6. `api/db/migrations/0008_motivation_pipeline.sql` — three new tables.

### Modified files

7. `api/db/schema.ts` — add `motivationCache`, `motivationRejects`, `motivationServedLog` table definitions + types.
8. `api/app/api/motivation/recommend/route.ts` — strip `CATALOGUE` (moved to `catalogue.ts`), keep `detectBucket` + auth, delegate to `recommend()`. Falls back to `catalogue.ts` when flag off / pipeline fails.
9. `api/lib/motivation/index.ts` — re-export the new modules so route.ts stays clean.
10. `api/lib/env.ts` — add `TAVILY_API_KEY` to the env-var contract (optional).

### Not changed

- `frontend/src/components/MotivationCard.js` — zero changes.
- `frontend/src/lib/api.js` — zero changes.
- `api/lib/motivation/search.ts`, `fetch.ts`, `critique.ts`, `config.ts`, `schema.ts` — zero changes (already correct).

## Risk notes

- The new `frameItem` LLM call adds ~300 tokens output per item, ~3 items per call → ~$0.001/call on gemini-3-flash. Negligible against the $0.25 cap.
- Picker rejects log: `motivation_rejects` will fill fast (up to ~125 rows/user/day on cache misses). 30-day retention deferred; will add a TODO + cron shape in a follow-up.
- `motivation_served_log` write happens only on cache miss (to enforce the cap), so dev traffic doesn't bloat the table.

## Inline review + test gates

1. After file edits: tsc on `api/`, eslint on `api/` (no schema drift, no missing imports).
2. `pnpm dev` boots clean (port-cleanup + both processes).
3. Manual: hit `/api/motivation/recommend` with a real dev user → verify response shape unchanged (`bucket`, `items`, `generated_at`) + new `cache` field.
4. `pnpm test` if there are tests for this route (only one E2E test currently, and it's marked skip if 404).

## Ship boundary

- Update PRD.md → add iteration entry: "Motivation Pipeline v1 — wired but flag-off; prod-flip pending founder".
- Commit per slice: schema → migration → lib modules → route rewrite → env wire. Last commit: docs.
