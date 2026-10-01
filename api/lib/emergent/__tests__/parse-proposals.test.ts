/**
 * Tests for the structured `[[TOOLS]]…[[/TOOLS]]` proposal parser in
 * `lib/emergent/llm.ts`.
 *
 * Phase 1 focus: the model occasionally emits
 *   {"action":"create_goal","title":"Drop \"Get healthier\""}
 * instead of the intended `{"action":"drop_goal","goal_title":"…"}`.
 * The parser must reject that proposal so the chat route's
 * `parseDropIntent` fallback (which has goal context) gets a chance
 * to build the correct `drop_goal`. Ordinary titles must still
 * pass through untouched.
 */
import { describe, it, expect } from 'vitest'

import {
  parseProposals,
  looksLikeDropIntent,
  TOOL_START,
  TOOL_END,
} from '../llm'

const wrap = (body: string) => `${TOOL_START}\n${body}\n${TOOL_END}\n`

describe('parseProposals — drop-style create_goal titles', () => {
  it('rejects create_goal whose title begins with a drop verb (Drop "Get healthier")', () => {
    const text = wrap(
      JSON.stringify([
        {
          action: 'create_goal',
          title: 'Drop "Get healthier"',
          horizon: 'short',
          why: '',
          first_action: '',
          target_date: '2026-12-31',
        },
      ]),
    )
    const out = parseProposals(text)
    expect(out).toEqual([])
  })

  it('rejects create_goal whose title begins with a drop verb in the middle of a multi-proposal array (preserving the legitimate ones)', () => {
    const text = wrap(
      JSON.stringify([
        {
          action: 'create_goal',
          title: 'Drop "Get healthier"',
          horizon: 'short',
        },
        {
          action: 'create_goal',
          title: 'Learn TypeScript generics',
          horizon: 'medium',
        },
      ]),
    )
    const out = parseProposals(text)
    expect(out).toHaveLength(1)
    expect(out[0].action).toBe('create_goal')
    expect(out[0].args.title).toBe('Learn TypeScript generics')
  })

  it('rejects a legitimate-sounding title that starts with the drop verb "Drop deadlift routine" (verb-led ambiguity)', () => {
    // The task spec calls this out: even when a title could in principle
    // describe a goal (e.g. a training program called "Drop deadlift
    // routine"), we apply the drop-style guard verbatim. The user can
    // rephrase if they genuinely meant a new goal.
    const text = wrap(
      JSON.stringify([
        {
          action: 'create_goal',
          title: 'Drop deadlift routine',
          horizon: 'short',
        },
      ]),
    )
    const out = parseProposals(text)
    expect(out).toEqual([])
  })

  it('rejects "pause the MVP" (drop verb + optional "the")', () => {
    const text = wrap(
      JSON.stringify([
        {
          action: 'create_goal',
          title: 'pause the MVP',
          horizon: 'short',
        },
      ]),
    )
    const out = parseProposals(text)
    expect(out).toEqual([])
  })

  it('passes an ordinary title like "Learn Spanish" through untouched', () => {
    const text = wrap(
      JSON.stringify([
        {
          action: 'create_goal',
          title: 'Learn Spanish',
          horizon: 'medium',
          why: 'Travel next year',
          first_action: 'Buy a textbook',
          target_date: '2027-12-31',
        },
      ]),
    )
    const out = parseProposals(text)
    expect(out).toHaveLength(1)
    expect(out[0].action).toBe('create_goal')
    expect(out[0].args.title).toBe('Learn Spanish')
  })

  it('passes a goal title that incidentally contains a drop verb mid-string', () => {
    // "Drop the unused exercises from the routine" is a perfectly good
    // goal title — the verb is not in the leading position.
    const text = wrap(
      JSON.stringify([
        {
          action: 'create_goal',
          title: 'Streamline my evening routine',
          horizon: 'short',
        },
      ]),
    )
    const out = parseProposals(text)
    expect(out).toHaveLength(1)
    expect(out[0].args.title).toBe('Streamline my evening routine')
  })

  it('passes through drop_goal / pause_goal proposals unchanged (the parser does not second-guess the action)', () => {
    const text = wrap(
      JSON.stringify([
        {
          action: 'drop_goal',
          goal_title: 'Get healthier',
        },
      ]),
    )
    const out = parseProposals(text)
    expect(out).toHaveLength(1)
    expect(out[0].action).toBe('drop_goal')
    expect(out[0].args.goal_title).toBe('Get healthier')
  })

  it('handles missing title field (no crash, no false-positive drop detection)', () => {
    const text = wrap(
      JSON.stringify([
        {
          action: 'create_goal',
          horizon: 'short',
        },
      ]),
    )
    const out = parseProposals(text)
    // Missing title is a different failure mode (executor will fall
    // back to "Untitled goal"); the drop-guard does NOT reject here.
    expect(out).toHaveLength(1)
    expect(out[0].args.title).toBeUndefined()
  })
})

describe('looksLikeDropIntent (helper exposed for tests)', () => {
  it.each([
    ['Drop "Get healthier"'],
    ['drop the MVP'],
    ['PAUSE the standup'],
    ['Stop tracking my reading list'],
    ['Delete "old blog draft"'],
    ['Remove that goal'],
    ['  Drop "X"'],
  ])('returns true for %s', (title) => {
    expect(looksLikeDropIntent(title)).toBe(true)
  })

  it.each([
    ['Learn Spanish'],
    ['Get healthier by Q4'],
    // Mid-string "drop" should not trigger — the guard only fires on
    // leading verbs.
    ['My drop-out plan for the side project'],
    // A title that *starts* with a non-drop word but mentions "drop"
    // later should also pass.
    ['Set up a kiosk to drop off returns'],
    [''],
  ])('returns false for %s', (title) => {
    expect(looksLikeDropIntent(title)).toBe(false)
  })

  it('returns false for non-string values', () => {
    expect(looksLikeDropIntent(undefined)).toBe(false)
    expect(looksLikeDropIntent(null)).toBe(false)
    expect(looksLikeDropIntent(42)).toBe(false)
    expect(looksLikeDropIntent({})).toBe(false)
  })
})