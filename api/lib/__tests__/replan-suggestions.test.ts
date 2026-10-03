import { describe, expect, it } from 'vitest'

import { computeReplanSuggestions } from '../replan-suggestions'

const TODAY = '2026-10-03'

function dropAudit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit_1',
    type: 'drop:goal',
    summary: "Dropped goal 'Learn Spanish'",
    created_at: '2026-10-02T10:00:00Z',
    payload: {
      goal_id: 'goal_1',
      goal_title: 'Learn Spanish',
      freed_weekly_hours: 8,
    },
    ...overrides,
  }
}

const remainingGoal = {
  id: 'goal_2',
  title: 'Run a half',
  status: 'active',
  start_date: '2026-09-01',
  target_date: '2026-12-01',
  drift_status: 'on_track',
}

describe('computeReplanSuggestions', () => {
  it('offers a re-plan when a recent drop freed capacity and goals remain', () => {
    const out = computeReplanSuggestions({
      goals: [remainingGoal],
      blockers: [],
      recentAudit: [dropAudit()],
      today: TODAY,
    })
    expect(out).toHaveLength(1)
    expect(out[0].trigger).toBe('capacity_freed')
    expect(out[0].freed_weekly_hours).toBe(8)
    expect(out[0].prefill).toContain('Learn Spanish')
  })

  it('does not offer capacity_freed when nothing is left to re-plan', () => {
    const out = computeReplanSuggestions({
      goals: [], // the dropped goal was the only one
      blockers: [],
      recentAudit: [dropAudit()],
      today: TODAY,
    })
    expect(out).toHaveLength(0)
  })

  it('offers freed capacity after pausing an active goal', () => {
    const out = computeReplanSuggestions({
      goals: [remainingGoal],
      blockers: [],
      recentAudit: [
        {
          id: 'audit_pause',
          type: 'confirm:pause_goal',
          summary: "Paused goal 'Learn Spanish'",
          created_at: '2026-10-02T10:00:00Z',
          payload: {
            goal_id: 'goal_1',
            goal_title: 'Learn Spanish',
            freed_weekly_hours: 8,
          },
        },
      ],
      today: TODAY,
    })
    expect(out).toHaveLength(1)
    expect(out[0].trigger).toBe('capacity_freed')
    expect(out[0].message).toContain('Pausing')
  })

  it('ignores drops older than the 7-day window', () => {
    const out = computeReplanSuggestions({
      goals: [remainingGoal],
      blockers: [],
      recentAudit: [dropAudit({ created_at: '2026-09-01T10:00:00Z' })],
      today: TODAY,
    })
    expect(out).toHaveLength(0)
  })

  it('flags an at-risk goal', () => {
    const out = computeReplanSuggestions({
      goals: [{ ...remainingGoal, drift_status: 'at_risk' }],
      blockers: [],
      recentAudit: [],
      today: TODAY,
    })
    expect(out).toHaveLength(1)
    expect(out[0].trigger).toBe('drift')
    expect(out[0].goal_id).toBe('goal_2')
  })

  it('flags a blocker that overlaps an active goal window', () => {
    const out = computeReplanSuggestions({
      goals: [remainingGoal],
      blockers: [
        {
          id: 'blk_1',
          title: 'Work trip',
          start_date: '2026-10-10',
          end_date: '2026-10-20',
        },
      ],
      recentAudit: [],
      today: TODAY,
    })
    expect(out).toHaveLength(1)
    expect(out[0].trigger).toBe('blocker_collision')
    expect(out[0].blocker_title).toBe('Work trip')
  })

  it('does not flag a blocker outside the goal window', () => {
    const out = computeReplanSuggestions({
      goals: [remainingGoal],
      blockers: [
        {
          id: 'blk_1',
          title: 'Work trip',
          start_date: '2027-01-10',
          end_date: '2027-01-20',
        },
      ],
      recentAudit: [],
      today: TODAY,
    })
    expect(out).toHaveLength(0)
  })

  it('flags a goal-linked timetable block scheduled after its goal target', () => {
    const out = computeReplanSuggestions({
      goals: [remainingGoal],
      blockers: [],
      timetableBlocks: [
        {
          id: 'tblock_1',
          label: 'Final prep',
          goal_id: 'goal_2',
          block_date: '2026-12-10',
          start_time: '09:00',
          end_time: '10:00',
        },
      ],
      recentAudit: [],
      today: TODAY,
    })
    expect(out).toHaveLength(1)
    expect(out[0].trigger).toBe('timetable_collision')
    expect(out[0].reasons[0]).toContain('after the goal target date')
  })

  it('flags a goal-linked timetable block scheduled during a blocker', () => {
    const out = computeReplanSuggestions({
      goals: [remainingGoal],
      blockers: [
        {
          id: 'blk_1',
          title: 'Work trip',
          start_date: '2026-10-10',
          end_date: '2026-10-20',
        },
      ],
      timetableBlocks: [
        {
          id: 'tblock_1',
          label: 'Study slot',
          goal_id: 'goal_2',
          block_date: '2026-10-14',
          start_time: '09:00',
          end_time: '10:00',
        },
      ],
      recentAudit: [],
      today: TODAY,
    })
    expect(out).toHaveLength(2)
    const timetable = out.find((s) => s.trigger === 'timetable_collision')
    expect(timetable?.blocker_title).toBe('Work trip')
    expect(timetable?.reasons[0]).toContain('overlaps blocker')
  })

  it('flags a recent date edit when the target is past and children extend beyond it', () => {
    const out = computeReplanSuggestions({
      goals: [{ ...remainingGoal, target_date: '2026-10-01' }],
      blockers: [],
      milestones: [
        {
          id: 'mile_1',
          goal_id: 'goal_2',
          title: 'Final exam',
          target_date: '2026-10-10',
          status: 'open',
        },
      ],
      commitments: [
        {
          id: 'commit_1',
          goal_id: 'goal_2',
          text: 'Practice exam',
          due: '2026-10-05',
          status: 'open',
        },
      ],
      recentAudit: [
        {
          id: 'audit_dates',
          type: 'confirm:set_goal_dates',
          summary: 'Timeline changed',
          created_at: '2026-10-02T10:00:00Z',
          payload: { goal_id: 'goal_2', args: { target_date: '2026-10-01' } },
        },
      ],
      today: TODAY,
    })
    expect(out[0].trigger).toBe('infeasible_edit')
    expect(out[0].reasons.join(' ')).toContain('already passed')
    expect(out[0].reasons.join(' ')).toContain('open milestone')
    expect(out[0].reasons.join(' ')).toContain('open commitment')
  })

  it('flags a weekly-hours edit that pushes active goals over capacity', () => {
    const out = computeReplanSuggestions({
      goals: [
        { ...remainingGoal, weekly_hours: 12 },
        {
          id: 'goal_3',
          title: 'Learn Spanish',
          status: 'active',
          weekly_hours: 11,
          start_date: '2026-09-01',
          target_date: '2026-12-01',
        },
      ],
      blockers: [],
      availableWeeklyHours: 20,
      recentAudit: [
        {
          id: 'audit_hours',
          type: 'confirm:update_goal',
          summary: 'Updated goal',
          created_at: '2026-10-02T10:00:00Z',
          payload: { goal_id: 'goal_3', args: { weekly_hours: 11 } },
        },
      ],
      today: TODAY,
    })
    expect(out).toHaveLength(1)
    expect(out[0].trigger).toBe('infeasible_edit')
    expect(out[0].message).toContain('23h/week against a 20h/week capacity')
  })

  it('returns nothing for a clean account', () => {
    const out = computeReplanSuggestions({
      goals: [remainingGoal],
      blockers: [],
      recentAudit: [],
      today: TODAY,
    })
    expect(out).toEqual([])
  })
})
