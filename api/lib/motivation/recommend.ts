/**
 * Motivation agent — orchestrator.
 *
 * Sequences the full pipeline and owns the cross-stage budget:
 *   detect bucket → cache lookup → build queries → Tavily search →
 *   fetch → 10-param critique → picker → frame → cache write.
 *
 * Budgets (all live in config.ts):
 *   - PIPELINE_TIMEOUT_MS (20s) — the route handler's caller-side
 *     deadline; we cap the whole pipeline at this.
 *   - STAGE_TIMEOUTS.{search,fetch,critique,frame}
 *   - COST_CAP_USD ($0.25)      — short-circuit to catalogue on breach.
 *
 * Failover (preserves the route.ts user-facing guarantees):
 *   1. Cache hit   (≤ 60m)  → return cached items        (cache: 'hit')
 *   2. Stale cache (≤ 24h)  → return stale + kick off async refresh
 *                            (cache: 'stale', same items, background writes)
 *   3. Miss        (none)   → return catalogue immediately + kick off async
 *                            pipeline (cache: 'miss', deterministic items,
 *                            background writes — same SWR shape as stale)
 *   4. Pipeline failure / cap breach → return fallback catalogue (still
 *      inside `runPipeline`, only ever surfaces if the background pass
 *      was awaited synchronously, which today it never is).
 *
 * SWR rationale: at MVP the pipeline takes ~20-30s on DeepSeek flash
 * (5-way parallel critiques × ~25 candidates with the 8s per-stage
 * timeout). Blocking on it for the first request after a cold cache
 * makes the Goals tab feel broken. Returning the catalogue immediately
 * — the same shape the user would see anyway — and refreshing in the
 * background gives the card useful content at first paint, then a
 * fresh LLM-curated item lands within one poll cycle. The frontend's
 * `MotivationCard` polls every 5s while it knows a refresh is in
 * flight, so the user sees the transition without a manual refresh.
 *
 * Public entry: `recommend(args)`. Returns a `RecommendationResponse`.
 */

import 'server-only'

import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import { motivationCache, motivationServedLog } from '@/db/schema'

import {
  COST_CAP_USD,
  CACHE_TTL_MS,
  MOTIVATION_AGENT_ENABLED,
  PIPELINE_TIMEOUT_MS,
  STALE_TTL_MS,
  llmCallCostUsd,
  tavilyCostUsd,
} from './config'

/**
 * Max critiques in flight at once. Caps the burst we throw at the
 * Emergent proxy per-key budget. 5 was chosen empirically — it's
 * enough to keep total pipeline latency low (~2-3 sequential waves
 * for 25 candidates) and low enough that a 429 from a key budget
 * breach surfaces as a clean wave rather than a total cliff.
 */
const CRITIQUE_CONCURRENCY = 5
import { fallbackFrame, pickFromCatalogue } from './catalogue'
import { persistRejects, pickTopN } from './picker'
import { critiqueCandidate } from './critique'
import { fetchCandidates } from './fetch'
import { frameCandidate } from './frame'
import { searchTavily } from './search'
import { computeStateHash, extractLackingSignals } from './state'

import type {
  Bucket,
  RecommendationItem,
  RecommendationRequest,
  RecommendationResponse,
  ScoredCandidate,
} from './schema'

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
  const { userId, bucket, stateHash, n } = req

  // Flag off → straight to catalogue. Same shape, same response.
  if (!MOTIVATION_AGENT_ENABLED) {
    return fromCatalogue(bucket, n)
  }

  // 1. Cache lookup.
  const cached = await readCache({ userId, bucket, stateHash })
  if (cached.status === 'hit') {
    return {
      bucket,
      items: cached.items,
      generated_at: cached.generated_at,
      cache: 'hit',
    }
  }

  // 2. Stale cache — serve stale, refresh async.
  if (cached.status === 'stale') {
    // Fire-and-forget — don't await.
    void runPipeline({ userId, bucket, stateHash, n }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[motivation] stale refresh failed:', err)
    })
    return {
      bucket,
      items: cached.items,
      generated_at: cached.generated_at,
      cache: 'stale',
    }
  }

  // 3. Cold miss — SWR. Return the catalogue immediately so the
  //    Goals tab is never blocked behind a 20-30s LLM pipeline on
  //    the first request after the cache expires. The pipeline runs
  //    in the background; when it lands the cache row, the next
  //    poll from `MotivationCard` picks it up as a fresh `hit`.
  //
  //    Same shape as the stale path above — the only difference is
  //    what we serve right now (stale item vs. catalogue item). The
  //    response contract (bucket, items, generated_at, cache) stays
  //    identical so the frontend doesn't have to branch.
  //
  //    Why catalogue and not a "re-framing…" spinner: the user gets
  //    real, useful content on first paint instead of staring at a
  //    loader, and the eventual transition into the LLM-fresh item
  //    is a quiet swap of one item for another, not a layout shift.
  //
  //    Dedup with other in-flight refreshes for the same (user, bucket,
  //    stateHash): `runPipeline` writes to the cache by `stateHash`, so
  //    two concurrent callers for the same fingerprint would race to
  //    overwrite each other's row. The cost cap inside the pipeline
  //    keeps the duplicate work cheap (second wave hits `overBudget`),
  //    but if this ever becomes a hot path, swap the `void` for a
  //    `Map<stateHash, Promise>` so the second caller awaits the first.
  void runPipeline({ userId, bucket, stateHash, n }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[motivation] cold-miss refresh failed:', err)
  })
  // fromCatalogue() already returns cache: 'miss', but we spread it
  // explicitly to make the intent obvious — this branch is always a
  // miss, never anything else.
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
  const generated_at = new Date().toISOString()

  // Master deadline — every stage below respects this signal.
  const masterCtrl = new AbortController()
  const masterTimer = setTimeout(
    () => masterCtrl.abort(),
    PIPELINE_TIMEOUT_MS,
  )

  // Live cost counter.
  const cost = new CostTracker()

  try {
    // 1. Extract state (themes + overdue stats) for search queries.
    const signals = await extractLackingSignals({ userId, bucket })
    cost.recordTavily(0)

    // 2. Search.
    const queries = buildQueries(bucket, signals.themes)
    const raw = await searchTavily({
      queries,
      signal: masterCtrl.signal,
    })
    cost.recordTavily(tavilyCostUsd(queries.length))
    if (cost.overBudget()) return fromCatalogue(bucket, n)

    if (raw.length === 0) {
      // No search results → catalogue (probably Tavily key missing).
      return fromCatalogue(bucket, n)
    }

    // 3. Fetch + normalize.
    const candidates = await fetchCandidates({
      results: raw,
      bucket,
      signal: masterCtrl.signal,
    })
    if (candidates.length === 0) return fromCatalogue(bucket, n)

    // 4. Critique in parallel. Per-candidate failure isolation.
    const critiqueSignals = await critiqueAll({
      candidates,
      sessionId: userId,
      signal: masterCtrl.signal,
      onCost: (usd) => cost.recordLlm('reasoning', usd),
      onCap: () => cost.overBudget(),
    })
    if (critiqueSignals.overBudget) return fromCatalogue(bucket, n)
    if (critiqueSignals.scored.length === 0) return fromCatalogue(bucket, n)

    // 5. Pick.
    const { picks, rejected } = pickTopN({
      scored: critiqueSignals.scored,
      n,
      bucket,
    })
    void persistRejects(userId, bucket, rejected)
    if (picks.length === 0) return fromCatalogue(bucket, n)

    // 6. Frame.
    const items = await Promise.all(
      picks.map(async (c) => {
        const frame = await frameCandidate({
          candidate: c,
          bucket,
          sessionId: userId,
        })
        return toRecommendationItem(c, frame)
      }),
    )

    // 7. Increment daily served counter (cache miss only).
    void bumpServedCount(userId)

    // 8. Cache write (best-effort).
    await writeCache({ userId, bucket, stateHash, items }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[motivation] cache write failed:', err)
    })

    return { bucket, items, generated_at, cache: 'miss' }
  } catch (err) {
    // Same rationale as the per-candidate log above — message only,
    // not the stack. The catalogue fallback below keeps the user
    // unblocked even when the pipeline blows up; the stack belongs
    // in a debug log, not in every dev-request's console.
    // eslint-disable-next-line no-console
    console.warn('[motivation] pipeline failed:', err instanceof Error ? err.message : err)
    return fromCatalogue(bucket, n)
  } finally {
    clearTimeout(masterTimer)
  }
}

/* -------------------------------------------------------------------------- */
/* Critique-all (parallel, isolated)                                          */
/* -------------------------------------------------------------------------- */

interface CritiqueAllResult {
  scored: ScoredCandidate[]
  overBudget: boolean
}

async function critiqueAll(args: {
  candidates: Awaited<ReturnType<typeof fetchCandidates>>
  sessionId: string
  signal: AbortSignal
  onCost: (usd: number) => void
  onCap: () => boolean
}): Promise<CritiqueAllResult> {
  const { candidates, sessionId, signal, onCost, onCap } = args
  const scored: ScoredCandidate[] = []
  let overBudget = false

  // Bounded concurrency: at most CRITIQUE_CONCURRENCY critiques in
  // flight. The classic "promise pool with index cursor" pattern —
  // small, dependency-free, and avoids hammering the Emergent proxy
  // budget guard with N concurrent requests.
  let cursor = 0
  async function worker() {
    while (true) {
      if (onCap()) {
        overBudget = true
        return
      }
      const idx = cursor++
      if (idx >= candidates.length) return
      const c = candidates[idx]
      try {
        const result = await critiqueCandidate({
          candidate: c,
          sessionId,
          signal,
        })
        // We can't read real token counts out of streamChat at MVP;
        // estimate cost from prompt size (see critique.ts header TODO).
        const estimatedCost = estimateCritiqueCost(result)
        onCost(estimatedCost)
        scored.push(result)
      } catch (err) {
        // Per-candidate isolation: log and drop. A 429 budget breach
        // shows up here as "Emergent LLM 429" — the worker continues
        // and the cost cap short-circuits the next wave.
        //
        // Log the message only — the upstream Error carries a full
        // stack trace (incl. request_id, raw upstream body) which
        // floods the dev log every request. If we ever need the
        // stack for post-mortem, dump it at WARN with `err.stack`
        // behind a debug flag, not by default.
        // eslint-disable-next-line no-console
        console.warn('[motivation] critique dropped:', err instanceof Error ? err.message : err)
      }
    }
  }

  const workers: Promise<void>[] = []
  const pool = Math.min(CRITIQUE_CONCURRENCY, candidates.length)
  for (let i = 0; i < pool; i++) workers.push(worker())
  await Promise.all(workers)

  return { scored, overBudget }
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

interface CacheReadResult {
  status: 'hit' | 'stale' | 'miss'
  items: RecommendationItem[]
  generated_at: string
}

async function readCache(args: {
  userId: string
  bucket: Bucket
  stateHash: string
}): Promise<CacheReadResult> {
  const now = new Date()
  const staleCutoff = new Date(now.getTime() - STALE_TTL_MS)
  try {
    const rows = await db
      .select({
        items: motivationCache.items,
        generatedAt: motivationCache.generatedAt,
        expiresAt: motivationCache.expiresAt,
      })
      .from(motivationCache)
      .where(
        and(
          eq(motivationCache.userId, args.userId),
          eq(motivationCache.bucket, args.bucket),
          eq(motivationCache.stateHash, args.stateHash),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return { status: 'miss', items: [], generated_at: '' }
    const items = parseItems(row.items)
    const generated_at = row.generatedAt.toISOString()
    if (row.expiresAt > now) {
      return { status: 'hit', items, generated_at }
    }
    if (row.generatedAt > staleCutoff) {
      return { status: 'stale', items, generated_at }
    }
    return { status: 'miss', items: [], generated_at: '' }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[motivation] cache read failed:', err)
    return { status: 'miss', items: [], generated_at: '' }
  }
}

async function writeCache(args: {
  userId: string
  bucket: Bucket
  stateHash: string
  items: RecommendationItem[]
}): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS)
  await db
    .insert(motivationCache)
    .values({
      userId: args.userId,
      bucket: args.bucket,
      stateHash: args.stateHash,
      items: args.items,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [
        motivationCache.userId,
        motivationCache.bucket,
        motivationCache.stateHash,
      ],
      set: {
        items: args.items,
        generatedAt: new Date(),
        expiresAt,
      },
    })
}

async function bumpServedCount(userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  try {
    await db
      .insert(motivationServedLog)
      .values({ userId, servedOn: today, count: 1 })
      .onConflictDoUpdate({
        target: [motivationServedLog.userId, motivationServedLog.servedOn],
        set: { count: sql`${motivationServedLog.count} + 1` },
      })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[motivation] served log write failed:', err)
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

// Exported for tests — the SWR cold-miss branch in `recommend()`
// depends on `fromCatalogue` returning the exact contract shape.
// Production code paths should go through `recommend()`, never this.
export const _internal = { fromCatalogue }

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function buildQueries(bucket: Bucket, themes: string[]): string[] {
  const themeBit =
    themes.length > 0
      ? `${themes.slice(0, 2).map(quote).join(', ')} `
      : ''
  const byBucket: Record<Bucket, string> = {
    overdue:
      `practical micro-habits for breaking a ${themeBit}procrastination streak ` +
      `(start in 2 minutes)`,
    dormant:
      `reconnecting with the why behind ${themeBit || 'a goal you stopped working on'} ` +
      `(first-person, concrete)`,
    stuck:
      `breaking through the boring middle of ${themeBit || 'a long-running goal'} ` +
      `(concrete frame, not motivation)`,
  }
  // Generate 3 variants — different angles so Tavily returns more coverage.
  const variants = [
    byBucket[bucket],
    byBucket[bucket].replace(/\(.*\)/, '(original practitioner voice)'),
    byBucket[bucket].replace(/\(.*\)/, '(research, primary source)'),
  ]
  return variants
}

function quote(s: string): string {
  const t = s.trim()
  if (!t) return ''
  return t.length < 30 ? `${t} ` : `${t.slice(0, 30)} `
}

function toRecommendationItem(
  c: ScoredCandidate,
  frame: string,
): RecommendationItem {
  return {
    id: c.id,
    kind: c.kind,
    title: c.title,
    author: c.author,
    url: c.url,
    duration: c.duration,
    frame,
    excerpt: c.excerpt,
    score_total: Math.round(c.weighted_total * 10) / 10,
  }
}

function parseItems(raw: unknown): RecommendationItem[] {
  if (!Array.isArray(raw)) return []
  const out: RecommendationItem[] = []
  for (const it of raw) {
    if (
      it &&
      typeof it === 'object' &&
      typeof (it as { id?: unknown }).id === 'string' &&
      typeof (it as { url?: unknown }).url === 'string'
    ) {
      out.push(it as RecommendationItem)
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Cost tracker                                                               */
/* -------------------------------------------------------------------------- */

class CostTracker {
  private total = 0
  recordTavily(usd: number) {
    this.total += usd
  }
  recordLlm(_kind: 'reasoning' | 'cheap', usd: number) {
    this.total += usd
  }
  overBudget(): boolean {
    return this.total >= COST_CAP_USD
  }
}

function estimateCritiqueCost(scored: ScoredCandidate): number {
  // Rough estimate — same heuristic as critique.ts's internal estimator.
  // Real token counts will come from the proxy once it exposes usage
  // (TODO flagged in critique.ts:269-272).
  const inputChars =
    scored.title.length + scored.excerpt.length + 600 // rubric overhead
  const outputChars = 400 // 10 scores + 3 reasons
  return llmCallCostUsd('reasoning', Math.ceil(inputChars / 4), Math.ceil(outputChars / 4))
}
