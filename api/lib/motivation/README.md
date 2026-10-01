# Motivation Agent

LLM-driven curation for the existing `MotivationCard`. Replaces the
hand-curated catalogue in `api/app/api/motivation/recommend/route.ts`
with a pipeline that searches the live web, critiques candidates
against 10 parameters, and returns the top 3 only if they pass three
gates (core-four, k-of-n, weighted total).

## Layout

```
api/lib/motivation/
  schema.ts    Zod shapes — single source of truth for the pipeline
  config.ts    env, model names, thresholds, cost cap, helpers
  index.ts     barrel (server-only)
  (future)     search.ts, fetch.ts, critique.ts, picker.ts,
               frame.ts, cache.ts, state.ts, recommend.ts
```

## Pipeline (single request, runs inline)

1. `state.ts` extracts "lacking" signals from bucket + state hash
2. `search.ts` calls Tavily with 3-5 queries
3. `fetch.ts` pulls each URL (3s/URL cap) and normalizes to `Candidate`
4. `critique.ts` LLM-scores each candidate on 10 params
5. `picker.ts` applies the three gates, picks top 3 with diversity
6. `frame.ts` writes the per-item "right now, X" sentence
7. `cache.ts` writes to `motivation_cache` (60m TTL)
8. Returns to `api/app/api/motivation/recommend/route.ts`

## Scorecard

| # | Param | Weight | Hard gate (must > 0.6) |
|---|---|---|---|
| 1 | Source credibility | 0.15 | ★ core |
| 2 | Recency | 0.10 | ★ core |
| 3 | Content depth | 0.15 | ★ core |
| 4 | Actionability | 0.15 | ★ core |
| 5 | Citation density | 0.10 | |
| 6 | Engagement volume | 0.08 | |
| 7 | Engagement quality | 0.08 | |
| 8 | Voice fit | 0.08 | |
| 9 | Source independence | 0.06 | |
| 10 | Accessibility | 0.05 | |

All three gates must pass:
1. **Core four** — each of params 1/2/3/4 individually > 0.6
2. **k-of-n** — at least 5 of 10 params individually > 0.6
3. **Weighted total** — weighted sum ≥ 6.5 / 10

## Env vars

| Var | Purpose |
|---|---|
| `MOTIVATION_AGENT_ENABLED` | Master switch. Default: prod=true, dev=false |
| `TAVILY_API_KEY` | Required when the agent is enabled |
| `EMERGENT_LLM_KEY` | Already used by `lib/emergent/llm.ts` |

## Rollout flag

`MOTIVATION_AGENT_ENABLED` defaults to `false` in dev/test and `true`
in production. Set it explicitly to override. v0 (dev only) →
v1 (10% users via further rollout) → v2 (100%).

## Cost cap

Hard ceiling $0.25 / call. Live-tracked by the orchestrator from
token counts × published rates. On breach, short-circuit to the
fallback catalogue.

## Failover chain

1. Cache hit (≤ 60m) → return immediately
2. Pipeline success → return items
3. Pipeline failure / cap breach / Tavily missing → built-in
   fallback catalogue (3 items per bucket, hardcoded)
4. Empty → `MotivationCard` renders nothing (no nag)
