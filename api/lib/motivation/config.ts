/**
 * Motivation agent — runtime config (env + thresholds + cost cap).
 *
 * Why a separate config file and not just inline:
 *   - All knobs in one place so the operator can tune 10-param weights,
 *     thresholds, and cost cap without grepping.
 *   - `lib/env.ts` validates process.env at boot; this module reads
 *     from `env` and exposes the motivation-specific knobs (which are
 *     not env vars at MVP — they're compiled constants we may move
 *     to env vars in v1 if we want runtime tuning).
 *
 * Cost accounting uses Anthropic + OpenAI published rates as of
 * Sep 2026; update here when rates change or when a model is added.
 */

import 'server-only'

import { env } from '@/lib/env'

import {
  CORE_PARAMS,
  SCORE_KEYS,
  SCORE_WEIGHTS,
  type ScoreKey,
} from './schema'

/* -------------------------------------------------------------------------- */
/* Feature flag                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Master switch. When false:
 *   - The route handler returns the built-in fallback catalogue
 *     directly, skipping the pipeline.
 *   - detectBucket() still runs so the card's UX path is identical
 *     to "agent enabled, no candidates passed".
 *
 * Default: enabled in production, disabled everywhere else (so dev
 * environments don't burn Tavily credits during unit tests).
 *
 * Override with `MOTIVATION_AGENT_ENABLED=true|false` in env.
 */
function parseEnabledFlag(raw: string | undefined, isProd: boolean): boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return isProd
}

export const MOTIVATION_AGENT_ENABLED = parseEnabledFlag(
  process.env.MOTIVATION_AGENT_ENABLED,
  env.NODE_ENV === 'production',
)

/* -------------------------------------------------------------------------- */
/* External service keys                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tavily API key. Optional at boot — when missing AND the agent is
 * enabled, the pipeline falls back to the catalogue at runtime
 * (logged as `tavily_missing`).
 */
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY || null

/**
 * LLM calls go through the existing Emergent proxy; the key lives
 * in `env.EMERGENT_LLM_KEY`. We re-export model constants here so
 * callers don't need to import from `@/lib/emergent/llm` for the
 * names alone.
 */
export const REASONING_MODEL = 'claude-sonnet-4-5' as const
export const CHEAP_MODEL = 'gemini/gemini-3-flash-preview' as const

/* -------------------------------------------------------------------------- */
/* Pipeline bounds                                                            */
/* -------------------------------------------------------------------------- */

/** Hard ceiling on the full pipeline duration. Matches the route
 *  handler's caller-side deadline so the request doesn't hang. */
export const PIPELINE_TIMEOUT_MS = 20_000

/** Per-stage budgets, used by the orchestrator for early bail. */
export const STAGE_TIMEOUTS = {
  search: 4_000,
  fetch: 6_000,
  critique: 8_000,
  frame: 2_000,
} as const

/** Max Tavily queries per call. */
export const MAX_SEARCH_QUERIES = 5

/** Max raw candidates fetched. The picker trims to N. */
export const MAX_CANDIDATES_FETCHED = 25

/** Max LLM critiques (one per surviving candidate). */
export const MAX_LLM_CRITIQUES = 25

/** Per-user daily cap on served cards (cache misses only). */
export const DAILY_USER_CAP = 20

/* -------------------------------------------------------------------------- */
/* Cost accounting (USD per call)                                             */
/* -------------------------------------------------------------------------- */

/**
 * USD per 1M tokens. Live cost is computed from input/output token
 * counts × these rates. Update when rates change or a model is added.
 */
const COST_PER_M_TOKENS_USD = {
  reasoning_input: 3.0, // claude-sonnet-4-5 input
  reasoning_output: 15.0, // claude-sonnet-4-5 output
  cheap_input: 0.075, // gemini-3-flash-preview input
  cheap_output: 0.3, // gemini-3-flash-preview output
  tavily_per_query: 0.005, // ~$5 per 1k queries, Starter tier
} as const

/** Hard cost ceiling per call. Short-circuit to fallback catalogue. */
export const COST_CAP_USD = 0.25

/** Cost of a single LLM call (USD). */
export function llmCallCostUsd(
  model: 'reasoning' | 'cheap',
  inputTokens: number,
  outputTokens: number,
): number {
  const inRate =
    model === 'reasoning'
      ? COST_PER_M_TOKENS_USD.reasoning_input
      : COST_PER_M_TOKENS_USD.cheap_input
  const outRate =
    model === 'reasoning'
      ? COST_PER_M_TOKENS_USD.reasoning_output
      : COST_PER_M_TOKENS_USD.cheap_output
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate
}

/** Cost of N Tavily queries (USD). */
export function tavilyCostUsd(queries: number): number {
  return queries * COST_PER_M_TOKENS_USD.tavily_per_query
}

/* -------------------------------------------------------------------------- */
/* Scoring thresholds                                                         */
/* -------------------------------------------------------------------------- */

/** Per-parameter floor — a single dimension must clear this to count. */
export const PER_PARAM_FLOOR = 0.6

/** At least this many of the 10 params must individually exceed the floor. */
export const K_OF_N_MIN = 5
export const K_OF_N_TOTAL = SCORE_KEYS.length

/** Weighted total gate. Range 0-10. */
export const WEIGHTED_TOTAL_FLOOR = 6.5

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

/** TTL for motivation_cache rows. */
export const CACHE_TTL_MS = 60 * 60 * 1000 // 60 minutes

/** Max age for a "stale" cache hit (served as-is while kicking off async). */
export const STALE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Reject-log retention (cron-deleted daily). */
export const REJECT_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Weighted total for a score breakdown, scaled to 0-10.
 * Each score ∈ [0,1] × weight, summed, × 10.
 */
export function computeWeightedTotal(
  breakdown: Readonly<Record<ScoreKey, number>>,
): number {
  let sum = 0
  for (const key of SCORE_KEYS) {
    const w = SCORE_WEIGHTS[key]
    const s = breakdown[key]
    if (typeof w !== 'number' || typeof s !== 'number') continue
    sum += w * s
  }
  return sum * 10
}

/** True if every core-four param individually exceeds PER_PARAM_FLOOR. */
export function passesCoreFour(
  breakdown: Readonly<Record<ScoreKey, number>>,
): boolean {
  for (const key of CORE_PARAMS) {
    if (breakdown[key] <= PER_PARAM_FLOOR) return false
  }
  return true
}

/** Number of params that individually exceed PER_PARAM_FLOOR. */
export function countAboveFloor(
  breakdown: Readonly<Record<ScoreKey, number>>,
): number {
  let n = 0
  for (const key of SCORE_KEYS) {
    if (breakdown[key] > PER_PARAM_FLOOR) n++
  }
  return n
}
