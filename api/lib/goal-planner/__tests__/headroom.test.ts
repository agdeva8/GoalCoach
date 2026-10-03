import { describe, expect, it } from 'vitest'

import { checkHeadroom } from '../headroom'

const goal = (weeklyHours: number | null) => ({ weeklyHours })

describe('checkHeadroom (Stage 3.5)', () => {
  it('is advisory, with no free value, when no budget is set', () => {
    const r = checkHeadroom({
      budgetHours: null,
      activeGoals: [goal(5), goal(5)],
      newWeeklyHours: 7,
    })
    expect(r.decision).toBe('advisory')
    expect(r.free).toBeNull()
    expect(r.total).toBe(17)
  })

  it('proceeds when the new plan fits the budget', () => {
    const r = checkHeadroom({
      budgetHours: 40,
      activeGoals: [goal(5), goal(5)],
      newWeeklyHours: 7,
    })
    expect(r.decision).toBe('proceed')
    expect(r.total).toBe(17)
    expect(r.free).toBe(23)
  })

  it('proceeds tighly when the overshoot is within the slack (free >= -5)', () => {
    const r = checkHeadroom({
      budgetHours: 10,
      activeGoals: [goal(5), goal(5)],
      newWeeklyHours: 2,
    })
    expect(r.decision).toBe('proceed_tight')
    expect(r.free).toBe(-2)
  })

  it('renegotiates when the overshoot exceeds the slack (free < -5)', () => {
    const r = checkHeadroom({
      budgetHours: 10,
      activeGoals: [goal(5), goal(5)],
      newWeeklyHours: 7,
    })
    expect(r.decision).toBe('renegotiate')
    expect(r.free).toBe(-7)
  })

  it('is advisory (never renegotiates) when a goal lacks an estimate', () => {
    const r = checkHeadroom({
      budgetHours: 40,
      activeGoals: [goal(null), goal(5)],
      newWeeklyHours: 30,
    })
    expect(r.decision).toBe('advisory')
    expect(r.unknownGoalCount).toBe(1)
    // total only counts the known 5h, but we still refuse to gate on it.
    expect(r.total).toBe(35)
  })

  it('rounds to one decimal', () => {
    const r = checkHeadroom({
      budgetHours: 40,
      activeGoals: [goal(7.5)],
      newWeeklyHours: 7.5,
    })
    expect(r.decision).toBe('proceed')
    expect(r.total).toBe(15)
    expect(r.free).toBe(25)
  })
})
