import { describe, expect, it, vi } from 'vitest'

// daily-log.ts pulls @/lib/db for its DB wrappers; the pure helpers below
// don't need it, and a real import would trigger env validation under vitest.
vi.mock('@/lib/db', () => ({ db: {} }))

import { mergeDailyLog, withCommitmentNote } from '../daily-log'

describe('mergeDailyLog', () => {
  it('starts a fresh row', () => {
    const r = mergeDailyLog(null, '2026-10-03', { text: 'hi' }, 't0')
    expect(r).toEqual({
      date: '2026-10-03',
      text: 'hi',
      commitments: [],
      blockers: [],
      updated_at: 't0',
    })
  })

  it('patches text without wiping existing commitments', () => {
    const existing = {
      date: '2026-10-03',
      text: 'a',
      commitments: [{ commitment_id: 'c1', completed: true, note: 'x' }],
      blockers: [],
      updated_at: 't1',
    }
    const r = mergeDailyLog(existing, '2026-10-03', { text: 'b' }, 't2')
    expect(r.text).toBe('b')
    expect(r.commitments).toEqual(existing.commitments)
    expect(r.updated_at).toBe('t2')
  })

  it('replaces commitments when the patch provides them', () => {
    const existing = {
      date: '2026-10-03',
      text: '',
      commitments: [{ commitment_id: 'c1', completed: false, note: '' }],
      blockers: [],
      updated_at: 't1',
    }
    const r = mergeDailyLog(
      existing,
      '2026-10-03',
      { commitments: [{ commitment_id: 'c2', completed: true, note: 'y' }] },
      't2',
    )
    expect(r.commitments).toEqual([{ commitment_id: 'c2', completed: true, note: 'y' }])
  })
})

describe('withCommitmentNote', () => {
  it('adds a new entry', () => {
    expect(withCommitmentNote([], 'c1', 'n')).toEqual([
      { commitment_id: 'c1', completed: false, note: 'n' },
    ])
  })

  it('updates an existing entry, optionally setting completed', () => {
    const r = withCommitmentNote(
      [{ commitment_id: 'c1', completed: false, note: 'old' }],
      'c1',
      'new',
      true,
    )
    expect(r).toEqual([{ commitment_id: 'c1', completed: true, note: 'new' }])
  })
})
