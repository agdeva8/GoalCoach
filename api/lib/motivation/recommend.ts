/**
 * Motivation agent — orchestrator (SWR entry).
 *
 * Owns the cache/stale-while-revalidate contract and delegates the actual
 * pipeline to the LangGraph in `graph.ts` (AI SDK stages).
 *
 * Failover (preserves the route.ts user-facing guarantees):
 *   1. Cache hit   (≤ 60m)  → return cached items        (cache: 'hit')
 *   2. Stale cache (≤ 24h)  → return stale + kick off async refresh
 *                            (cache: 'stale', same items, background writes)
 *   3. Miss        (none)   → return catalogue immediately + kick off async
 *                            pipeline (cache: 'miss', deterministic items,
 *                            background writes — same SWR shape as stale)
 *   4. Pipeline failure / cap breach → the graph returns the fallback
 *      catalogue (it never throws).
 *
 * SWR rationale: the pipeline takes ~20-30s on DeepSeek flash (5-way
 * parallel critiques × ~25 candidates with the 8s per-stage timeout).
 * Returning the catalogue immediately and refreshing in the background gives
 * the card useful content at first paint; the frontend's `MotivationCard`
 * polls every 5s while a refresh is in flight.
 *
 * Public entry: `recommend(args)`. Returns a `RecommendationResponse`.
 */

import 'server-only'

import { readCache } from './cache'
import { fallbackFrame, pickFromCatalogue } from './catalogue'
import { MOTIVATION_AGENT_ENABLED, PIPELINE_TIMEOUT_MS } from './config'
import { runMotivationGraph } from './graph'

import type {
  Bucket,
  RecommendationItem,
  RecommendationRequest,
  RecommendationResponse,
} from './schema'

/* -------------------------------------------------------------------------- */
/* In-flight pipeline dedup                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Concurrent polls for the same (user, bucket, stateHash) used to each
 * `void runPipeline()` independently. Now the first registers the promise
 * here and concurrent callers await the SAME promise. Keyed by
 * `userId:bucket:stateHash`. The entry is deleted when it settles, so the
 * map never grows past the number of currently-running pipelines. Per-process
 * (a Vercel cold-start loses it; the next caller starts fresh — correct).
 */
const inFlightPipelines = new Map<string, Promise<RecommendationResponse>>()

function pipelineKey(args: { userId: string; bucket: Bucket; stateHash: string }): string {
  return `${args.userId}:${args.bucket}:${args.stateHash}`
}

async function triggerPipelineOnce(args: {
  userId: string
  bucket: Bucket
  stateHash: string
  n: number
}): Promise<RecommendationResponse> {
  const key = pipelineKey(args)
  const existing = inFlightPipelines.get(key)
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(
      `[motivation] pipeline dedup hit for ${key.slice(0, 32)}… — ` +
        `awaiting in-flight run instead of starting a duplicate`,
    )
    return existing
  }
  const p = runPipeline(args).finally(() => {
    inFlightPipelines.delete(key)
  })
  inFlightPipelines.set(key, p)
  return p
}

/* -------------------------------------------------------------------------- */
/* Orchestrator                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Run the full recommendation pipeline. Always resolves — never throws.
 * On any internal failure, falls back to the catalogue so the user
 * still gets a useful response.
 */
export async function recommend(
  req: RecommendationRequest,
): Promise<RecommendationResponse> {
  const { userId, bucket, stateHash, n, forceRefresh = false } = req

  // Flag off → straight to catalogue. Same shape, same response.
  if (!MOTIVATION_AGENT_ENABLED) {
    return fromCatalogue(bucket, n)
  }

  // 1. Cache lookup — skipped when the caller asked for a forced refresh.
  if (!forceRefresh) {
    const cached = await readCache({ userId, bucket, stateHash })
    if (cached.status === 'hit') {
      return { bucket, items: cached.items, generated_at: cached.generated_at, cache: 'hit' }
    }

    // 2. Stale cache — serve stale, refresh async.
    if (cached.status === 'stale') {
      void triggerPipelineOnce({ userId, bucket, stateHash, n }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[motivation] stale refresh failed:', err)
      })
      return { bucket, items: cached.items, generated_at: cached.generated_at, cache: 'stale' }
    }
  }

  // 3. Cold miss — SWR. Return the catalogue immediately so the Goals tab is
  //    never blocked behind the LLM pipeline; the pipeline runs in the
  //    background and the next poll picks up the fresh `hit`.
  void triggerPipelineOnce({ userId, bucket, stateHash, n }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[motivation] cold-miss refresh failed:', err)
  })
  return fromCatalogue(bucket, n)
}

/* -------------------------------------------------------------------------- */
/* Pipeline (cache miss path)                                                 */
/* -------------------------------------------------------------------------- */

async function runPipeline(args: {
  userId: string
  bucket: Bucket
  stateHash: string
  n: number
}): Promise<RecommendationResponse> {
  const { userId, bucket, stateHash, n } = args

  // Master deadline — every stage respects this signal.
  const masterCtrl = new AbortController()
  const masterTimer = setTimeout(() => masterCtrl.abort(), PIPELINE_TIMEOUT_MS)

  try {
    return await runMotivationGraph({
      userId,
      bucket,
      stateHash,
      n,
      signal: masterCtrl.signal,
      fallback: () => fromCatalogue(bucket, n),
    })
  } finally {
    clearTimeout(masterTimer)
  }
}

/* -------------------------------------------------------------------------- */
/* Catalogue fallback                                                         */
/* -------------------------------------------------------------------------- */

function fromCatalogue(bucket: Bucket, n: number): RecommendationResponse {
  const seeds = pickFromCatalogue(bucket, n)
  const items: RecommendationItem[] = seeds.map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    author: s.author,
    url: s.url,
    duration: s.duration,
    frame: fallbackFrame(s, bucket),
    excerpt: s.excerpt,
    score_total: 0,
  }))
  return {
    bucket,
    items,
    generated_at: new Date().toISOString(),
    cache: 'miss',
  }
}

// Exported for tests — the SWR cold-miss branch in `recommend()` depends on
// `fromCatalogue` returning the exact contract shape. Production code paths
// should go through `recommend()`, never this.
export const _internal = { fromCatalogue }
