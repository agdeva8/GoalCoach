/**
 * Critique stage — fixture tests.
 *
 * Two layers of coverage:
 *   1. Pure-function tests on _internal.buildSystemPrompt / buildUserPrompt
 *      to confirm the prompt shape is stable.
 *   2. Tests on the verdict gate logic (passesCoreFour, countAboveFloor,
 *      weighted_total threshold) to confirm the deterministic verdict
 *      holds against the HLD's three-gate rule.
 *
 * The live LLM call (critiqueCandidate) is exercised by the integration
 * suite under e2e/ — we don't fake the model here. The deterministic
 * verdict logic IS what we test, since that's the tunable surface.
 */

import { describe, expect, it } from 'vitest'

import {
  CHEAP_MODEL,
  CHEAP_PROVIDER,
  PER_PARAM_FLOOR,
  REASONING_MODEL,
  REASONING_PROVIDER,
  computeWeightedTotal,
  countAboveFloor,
  passesCoreFour,
} from '../config'
import { _internal } from '../critique'
import {
  CORE_PARAMS,
  SCORE_KEYS,
  SCORE_WEIGHTS,
  type Candidate,
  type ScoreBreakdown,
  type ScoreKey,
} from '../schema'

const fixtureCandidate: Candidate = {
  id: 'test-1',
  bucket: 'overdue',
  kind: 'article',
  title: 'Test article on atomic habits',
  author: 'James Clear',
  url: 'https://jamesclear.com/atomic-habits',
  duration: '7 min read',
  excerpt:
    'You do not rise to the level of your goals. You fall to the level of your systems.',
  sourceMeta: {},
}

const fixtureScores: ScoreBreakdown = {
  credibility: 0.9,
  recency: 0.7,
  depth: 0.8,
  actionability: 0.85,
  citation_density: 0.7,
  engagement_volume: 0.6,
  engagement_quality: 0.7,
  voice_fit: 0.85,
  source_independence: 0.8,
  accessibility: 1.0,
}

describe('critique — prompt shape', () => {
  it('system prompt mentions every score key', () => {
    const sys = _internal.buildSystemPrompt()
    for (const key of SCORE_KEYS) {
      expect(sys).toContain(key)
    }
  })

  it('system prompt calls out the four core params', () => {
    const sys = _internal.buildSystemPrompt()
    // Hard rule line: "The four core dimensions (credibility, recency, depth, actionability)"
    for (const core of CORE_PARAMS) {
      expect(sys.toLowerCase()).toContain(core.replace(/_/g, ' '))
    }
  })

  it('user prompt interpolates the candidate fields', () => {
    const prompt = _internal.buildUserPrompt(fixtureCandidate)
    expect(prompt).toContain(fixtureCandidate.title)
    expect(prompt).toContain(fixtureCandidate.author)
    expect(prompt).toContain(fixtureCandidate.url)
    expect(prompt).toContain(fixtureCandidate.kind)
    expect(prompt).toContain(fixtureCandidate.bucket)
    expect(prompt).toContain(fixtureCandidate.excerpt)
  })

  it('user prompt does NOT leak other fields', () => {
    const prompt = _internal.buildUserPrompt(fixtureCandidate)
    // Source meta is JSON-stringified into the prompt on purpose;
    // id should NOT be in the prompt (we don't want the model optimizing
    // toward a specific id scheme).
    expect(prompt).not.toContain('test-1')
  })
})

describe('critique — deterministic verdict (the three gates)', () => {
  it('fixture scores pass all three gates', () => {
    expect(passesCoreFour(fixtureScores)).toBe(true)
    expect(countAboveFloor(fixtureScores)).toBeGreaterThanOrEqual(5)
    const total = computeWeightedTotal(fixtureScores)
    expect(total).toBeGreaterThanOrEqual(6.5)
  })

  it('core-four gate: any core below floor rejects', () => {
    for (const core of CORE_PARAMS) {
      const bad: ScoreBreakdown = {
        ...fixtureScores,
        [core]: PER_PARAM_FLOOR - 0.01, // just below
      }
      expect(passesCoreFour(bad)).toBe(false)
    }
  })

  it('core-four gate: each core exactly at floor still rejects (strict >)', () => {
    for (const core of CORE_PARAMS) {
      const borderline: ScoreBreakdown = {
        ...fixtureScores,
        [core]: PER_PARAM_FLOOR, // not strictly greater
      }
      expect(passesCoreFour(borderline)).toBe(false)
    }
  })

  it('k-of-n gate: exactly 5 params above floor passes count', () => {
    // 5 params at 0.7, the rest at 0.4 — should count to exactly 5.
    const targetKeys: ScoreKey[] = ['credibility', 'depth', 'actionability', 'voice_fit', 'source_independence']
    const exactFive: ScoreBreakdown = {
      credibility: 0.7,
      recency: 0.4,
      depth: 0.7,
      actionability: 0.7,
      citation_density: 0.4,
      engagement_volume: 0.4,
      engagement_quality: 0.4,
      voice_fit: 0.7,
      source_independence: 0.7,
      accessibility: 0.4,
    }
    expect(targetKeys.every((k) => exactFive[k] > PER_PARAM_FLOOR)).toBe(true)
    expect(countAboveFloor(exactFive)).toBe(5)
  })

  it('k-of-n gate: exactly 4 params above floor fails the >= 5 threshold', () => {
    // 4 params at 0.7 — k-of-n gate (>= 5) should fail.
    const onlyFour: ScoreBreakdown = {
      credibility: 0.7,
      recency: 0.4,
      depth: 0.7,
      actionability: 0.7,
      citation_density: 0.4,
      engagement_volume: 0.4,
      engagement_quality: 0.4,
      voice_fit: 0.7, // bumped to 0.7 to make this actually 4 above floor
      source_independence: 0.4,
      accessibility: 0.4,
    }
    expect(countAboveFloor(onlyFour)).toBe(4)
    expect(countAboveFloor(onlyFour) >= 5).toBe(false)
  })

  it('weighted total sums to weight-sum * 10 when all scores are 1', () => {
    const allOnes: ScoreBreakdown = {
      credibility: 1,
      recency: 1,
      depth: 1,
      actionability: 1,
      citation_density: 1,
      engagement_volume: 1,
      engagement_quality: 1,
      voice_fit: 1,
      source_independence: 1,
      accessibility: 1,
    }
    const total = computeWeightedTotal(allOnes)
    const expected = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0) * 10
    expect(total).toBeCloseTo(expected, 6)
  })

  it('weighted total is 0 when all scores are 0', () => {
    const allZero: ScoreBreakdown = {
      credibility: 0,
      recency: 0,
      depth: 0,
      actionability: 0,
      citation_density: 0,
      engagement_volume: 0,
      engagement_quality: 0,
      voice_fit: 0,
      source_independence: 0,
      accessibility: 0,
    }
    expect(computeWeightedTotal(allZero)).toBe(0)
  })

  it('weighted total weights the core four correctly', () => {
    // Only credibility high — total should equal credibility weight * 10 = 1.5
    const onlyCred: ScoreBreakdown = {
      ...fixtureScores,
      credibility: 1.0,
      recency: 0,
      depth: 0,
      actionability: 0,
      citation_density: 0,
      engagement_volume: 0,
      engagement_quality: 0,
      voice_fit: 0,
      source_independence: 0,
      accessibility: 0,
    }
    expect(computeWeightedTotal(onlyCred)).toBeCloseTo(1.5, 6) // 0.15 * 10
  })
})

describe('config — model + thresholds', () => {
  it('REASONING_MODEL is a model string from the registry', () => {
    expect(typeof REASONING_MODEL).toBe('string')
    expect(REASONING_MODEL.length).toBeGreaterThan(0)
  })

  it('CHEAP_MODEL is a model string from the registry', () => {
    expect(typeof CHEAP_MODEL).toBe('string')
    expect(CHEAP_MODEL.length).toBeGreaterThan(0)
  })

  it('REASONING_PROVIDER / CHEAP_PROVIDER are distinct registry ids', () => {
    // The reasoning stage routes through the `claude` registry row
    // and the cheap frame stage through the `gemini` row. At MVP
    // both rows resolve to the same model on the wire, but the
    // provider ids stay distinct so we can pick a different model
    // later without changing call sites.
    expect(REASONING_PROVIDER).toBe('claude')
    expect(CHEAP_PROVIDER).toBe('gemini')
  })

  it('STAGE_TIMEOUTS has every stage we use', () => {
    expect(_internal.STAGE_TIMEOUTS).toHaveProperty('search')
    expect(_internal.STAGE_TIMEOUTS).toHaveProperty('fetch')
    expect(_internal.STAGE_TIMEOUTS).toHaveProperty('critique')
    expect(_internal.STAGE_TIMEOUTS).toHaveProperty('frame')
  })

  it('CORE_PARAMS has exactly 4 entries', () => {
    expect(_internal.CORE_PARAMS).toHaveLength(4)
  })
})
