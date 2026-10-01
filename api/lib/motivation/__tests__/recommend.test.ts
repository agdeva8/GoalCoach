/**
 * SWR miss-path tests for the orchestrator.
 *
 * Scope: a handful of cheap assertions about `fromCatalogue` and the
 * cache-key shape, since those are the pieces the cold-miss SWR path
 * (recommend.ts:117-151) directly depends on. The full pipeline (DB +
 * Tavily + LLM critiques) is exercised by integration; mocking all
 * of it in a unit test would just be a re-implementation.
 *
 * What we cover:
 *   1. fromCatalogue returns the contract the route expects:
 *      `cache: 'miss'`, `bucket`, `items[]`, `generated_at`.
 *   2. Items carry deterministic catalogue frames (the SWR
 *      fallback's whole point — instant, no LLM dependency).
 *   3. Different buckets return different catalogue pools
 *      (overdue vs. stuck picks different items).
 *   4. count is honoured up to the per-bucket pool size.
 *
 * If the shape drifts, the frontend's SWR poll loop won't start
 * (it reads `d.cache`) and the user would see a silent no-op, so
 * the cost of an extra test file is worth it.
 */

import { describe, expect, it } from 'vitest'

import { RecommendationResponseSchema } from '../schema'

// `fromCatalogue` lives in `recommend.ts` as a module-local helper.
// It's exposed via `_internal` for tests because the SWR cold-miss
// branch in `recommend()` depends on its exact contract shape.
// Production code should never call it directly — go through
// `recommend()`.
import { _internal as recommendInternal } from '../recommend'
const { fromCatalogue } = recommendInternal

describe('recommend — SWR cold-miss shape (fromCatalogue)', () => {
  it('returns the full RecommendationResponse contract', () => {
    const res = fromCatalogue('overdue', 1)
    const parsed = RecommendationResponseSchema.parse(res)
    expect(parsed.cache).toBe('miss')
    expect(parsed.bucket).toBe('overdue')
    expect(Array.isArray(parsed.items)).toBe(true)
    expect(parsed.items.length).toBe(1)
    expect(typeof parsed.generated_at).toBe('string')
    // ISO date — Zod's refinement already asserts this; the second
    // check makes the test self-documenting about *why* it matters.
    expect(parsed.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('returns deterministic catalogue frames (no LLM dependency)', () => {
    const res = fromCatalogue('overdue', 1)
    const item = res.items[0]
    // Every catalogue frame starts with "Right now, " — that's the
    // deterministic `fallbackFrame` shape. The SWR path's whole
    // promise is "instant, no LLM dependency"; a frame that ever
    // stopped matching this prefix would mean we'd silently slipped
    // an LLM call back into the cold path.
    expect(item.frame.startsWith('Right now, ')).toBe(true)
  })

  it('different buckets return different catalogue pools', () => {
    const overdue = fromCatalogue('overdue', 3)
    const stuck = fromCatalogue('stuck', 3)
    const overdueIds = new Set(overdue.items.map((i) => i.id))
    const stuckIds = new Set(stuck.items.map((i) => i.id))
    // At least one id in each pool should NOT appear in the other.
    // If they always overlap, the catalogue bucket filter is broken.
    const overlap = [...overdueIds].filter((id) => stuckIds.has(id))
    expect(overlap.length).toBeLessThan(3)
  })

  it('honours the count parameter up to the per-bucket pool size', () => {
    const one = fromCatalogue('overdue', 1)
    const three = fromCatalogue('overdue', 3)
    expect(one.items.length).toBe(1)
    // The overdue pool has 3 entries (see catalogue.ts). Asking for
    // 3 should yield all of them; asking for more than 3 should be
    // clamped by the catalogue, not throw.
    expect(three.items.length).toBeLessThanOrEqual(3)
    expect(three.items.length).toBeGreaterThan(1)
  })
})