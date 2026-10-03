/**
 * Tests for the deterministic drop/pause resolver in `lib/emergent/llm.ts`.
 *
 * The drop flow opens a focused surface titled `Drop "X"?`. The coach may
 * first ask "Pause or drop?"; when the user taps a generic choice ("Drop it
 * for good") the decision is in the message but the goal name is only in
 * the title. `parseDropIntent`'s `contextText` option is what keeps that
 * answer from dead-ending on an unresolved target.
 */
import { describe, it, expect } from 'vitest'

import { parseDropIntent } from '../llm'

const GOALS = [
  { title: 'Switch jobs', goalId: 'goal_switch' },
  { title: 'Run a half marathon', goalId: 'goal_run' },
  { title: 'Learn Japanese', goalId: 'goal_jp' },
]

const TITLE = 'Drop "Switch jobs"?'

describe('parseDropIntent — message-driven (unchanged)', () => {
  it('resolves a quoted goal named in the message', () => {
    const p = parseDropIntent('I want to drop "Switch jobs".', GOALS)
    expect(p?.action).toBe('drop_goal')
    expect(p?.args.goal_title).toBe('Switch jobs')
    expect(p?.args.goal_id).toBe('goal_switch')
  })

  it('treats pause vocabulary as pause_goal', () => {
    const p = parseDropIntent('Pause "Switch jobs" for now.', GOALS)
    expect(p?.action).toBe('pause_goal')
    expect(p?.args.goal_title).toBe('Switch jobs')
  })
})

describe('parseDropIntent — conversation-title fallback', () => {
  it('resolves "Drop it for good" against the modal title', () => {
    const p = parseDropIntent('Drop it for good', GOALS, {
      contextText: TITLE,
    })
    expect(p?.action).toBe('drop_goal')
    expect(p?.args.goal_title).toBe('Switch jobs')
  })

  it('resolves "Pause until the launch lands" as pause_goal', () => {
    const p = parseDropIntent('Pause until the launch lands', GOALS, {
      contextText: TITLE,
    })
    expect(p?.action).toBe('pause_goal')
    expect(p?.args.goal_title).toBe('Switch jobs')
  })

  it('returns null for a generic message with no matching context', () => {
    const p = parseDropIntent('Drop it for good', GOALS)
    expect(p).toBeNull()
  })

  it('returns null when the title names no known goal', () => {
    const p = parseDropIntent('Drop it for good', GOALS, {
      contextText: 'Drop "Ship the MVP"?',
    })
    expect(p).toBeNull()
  })
})

describe('parseDropIntent — keep/negation guards', () => {
  it('never resolves "Keep it active" to a drop', () => {
    expect(
      parseDropIntent('Keep it active', GOALS, { contextText: TITLE }),
    ).toBeNull()
  })

  it('never resolves "don\'t drop it" to a drop', () => {
    expect(
      parseDropIntent("don't drop it", GOALS, { contextText: TITLE }),
    ).toBeNull()
  })
})
