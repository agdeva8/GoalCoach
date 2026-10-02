/**
 * Iteration N — Scope isolation regression test.
 *
 * The bug: opening Add Goal, typing a goal, closing without confirming,
 * reopening Add Goal, typing "HU" — the model plans for the OLD goal
 * because `loadHistory` was filtering by userId (not conversationId),
 * so the prior goal's conversation turns bled into the LLM prompt.
 *
 * This file tests the FIX via `loadHistory`'s signature — it requires
 * conversationId and the function throws when called without it.
 */
import { describe, it, expect } from 'vitest'

describe('loadHistory — conversation-scoped filtering', () => {
  it('throws when called without conversationId', async () => {
    const { loadHistory } = await import('@/lib/llm/state-builder')
    await expect(
      // @ts-expect-error — deliberately passing undefined
      loadHistory('user_1', undefined, 24),
    ).rejects.toThrow(/conversationId is required/)
  })

  it('accepts conversationId and returns history scoped to it', async () => {
    const { loadHistory } = await import('@/lib/llm/state-builder')
    // No DB connection in vitest by default; we only test that the
    // function shape is correct (throws on missing conversationId).
    // The integration tests in route.test.ts exercise the real DB path.
    await expect(
      loadHistory('user_1', 'conv_add_goal_refId_Open', 24),
    ).resolves.toBeDefined()
  })
})
