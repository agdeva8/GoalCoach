import { describe, expect, it } from 'vitest'

import { computeDrift, isoMinusDays } from '../drift'

describe('isoMinusDays', () => {
  it('subtracts across a month boundary without TZ drift', () => {
    expect(isoMinusDays('2026-10-03', 7)).toBe('2026-09-26')
    expect(isoMinusDays('2026-01-01', 1)).toBe('2025-12-31')
  })
})

describe('computeDrift', () => {
  it('is on_track when nothing has slipped', () => {
    const r = computeDrift({
      today: '2026-10-10',
      milestones: [
        { title: 'M1', targetDate: '2026-11-01', status: 'open' },
      ],
      commitments: [
        { id: 'c1', text: 'x', due: '2026-10-20', status: 'open' },
      ],
    })
    expect(r.status).toBe('on_track')
    expect(r.reasons).toEqual([])
  })

  it('flags an overdue incomplete milestone', () => {
    const r = computeDrift({
      today: '2026-10-10',
      milestones: [
        { title: 'Pass 5 mocks', targetDate: '2026-10-05', status: 'open' },
      ],
      commitments: [],
    })
    expect(r.status).toBe('at_risk')
    expect(r.reasons[0]).toContain('Pass 5 mocks')
  })

  it('does not flag a milestone that is overdue but done', () => {
    const r = computeDrift({
      today: '2026-10-10',
      milestones: [
        { title: 'Pass 5 mocks', targetDate: '2026-10-05', status: 'done' },
      ],
      commitments: [],
    })
    expect(r.status).toBe('on_track')
  })

  it('flags 3 overdue commitments inside the trailing week', () => {
    const r = computeDrift({
      today: '2026-10-10',
      milestones: [],
      commitments: [
        { id: 'c1', text: 'a', due: '2026-10-05', status: 'open' },
        { id: 'c2', text: 'b', due: '2026-10-06', status: 'open' },
        { id: 'c3', text: 'c', due: '2026-10-08', status: 'open' },
      ],
    })
    expect(r.status).toBe('at_risk')
    expect(r.reasons[0]).toContain('3 commitments overdue')
  })

  it('ignores overdue commitments older than the trailing week', () => {
    const r = computeDrift({
      today: '2026-10-10',
      milestones: [],
      commitments: [
        { id: 'c1', text: 'a', due: '2026-09-01', status: 'open' },
        { id: 'c2', text: 'b', due: '2026-09-20', status: 'open' },
        { id: 'c3', text: 'c', due: '2026-09-25', status: 'open' },
      ],
    })
    expect(r.status).toBe('on_track')
  })

  it('ignores done commitments', () => {
    const r = computeDrift({
      today: '2026-10-10',
      milestones: [],
      commitments: [
        { id: 'c1', text: 'a', due: '2026-10-05', status: 'done' },
        { id: 'c2', text: 'b', due: '2026-10-06', status: 'done' },
        { id: 'c3', text: 'c', due: '2026-10-08', status: 'done' },
      ],
    })
    expect(r.status).toBe('on_track')
  })
})
