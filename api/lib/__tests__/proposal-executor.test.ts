import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as schema from '@/db/schema'

import { applyProposal } from '../proposal-executor'

/**
 * Fake DB that captures every `insert(...).values(...)` and resolves goal
 * lookups to a single fixed row, so the executor's `resolveGoalRef` title path
 * works without a real connection. We do NOT mock `@/db/schema` — the real
 * drizzle columns are needed for `eq(...)` to build.
 */
const mocks = vi.hoisted(() => {
  const captured: Array<{ table: unknown; values: any }> = []
  const goalRow = { id: 'goal_1', title: 'T' }
  const tx = {
    insert: (table: unknown) => ({
      values: async (values: any) => {
        captured.push({ table, values })
      },
    }),
  }
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => [goalRow],
  }
  const db = {
    select: () => chain,
    transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
  }
  return { captured, db }
})

vi.mock('@/lib/db', () => ({ db: mocks.db }))

function insertedFor(table: unknown): any {
  return mocks.captured.find((c) => c.table === table)?.values
}

describe('applyProposal — Goal Planner field persistence (Iteration 10)', () => {
  beforeEach(() => {
    mocks.captured.length = 0
  })

  it('create_goal persists weekly_hours, phase_objectives, life_area', async () => {
    const res = await applyProposal('u1', {
      id: 'p1',
      action: 'create_goal',
      args: {
        title: 'Switch to senior SDE',
        horizon: 'short',
        weekly_hours: 7.5,
        phase_objectives: { Foundations: 'x', Mocks: 'y' },
        life_area: 'Career',
      },
    })
    expect(res.success).toBe(true)
    const goal = insertedFor(schema.goals)
    expect(goal.weeklyHours).toBe(8) // 7.5 rounded to the integer column
    expect(goal.phaseObjectives).toEqual({ Foundations: 'x', Mocks: 'y' })
    expect(goal.lifeArea).toBe('Career')
  })

  it('create_goal tolerates the legacy shape (no plan fields)', async () => {
    await applyProposal('u1', {
      id: 'p2',
      action: 'create_goal',
      args: { title: 'Legacy goal', horizon: 'medium' },
    })
    const goal = insertedFor(schema.goals)
    expect(goal.weeklyHours).toBeNull()
    expect(goal.phaseObjectives).toEqual({})
    expect(goal.lifeArea).toBe('')
  })

  it('add_milestone persists phase', async () => {
    const res = await applyProposal('u1', {
      id: 'p3',
      action: 'add_milestone',
      args: { goal_title: 'T', title: 'SD fundamentals', target_date: '2026-11-05', phase: 'Foundations' },
    })
    expect(res.success).toBe(true)
    expect(insertedFor(schema.milestones).phase).toBe('Foundations')
    expect(insertedFor(schema.milestones).goalId).toBe('goal_1')
  })

  it('add_commitment persists phase', async () => {
    const res = await applyProposal('u1', {
      id: 'p4',
      action: 'add_commitment',
      args: { goal_title: 'T', text: 'Pick a resource', due: '2026-10-02', phase: 'Mocks' },
    })
    expect(res.success).toBe(true)
    expect(insertedFor(schema.commitments).phase).toBe('Mocks')
  })
})
