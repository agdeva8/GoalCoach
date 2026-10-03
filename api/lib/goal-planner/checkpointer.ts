/**
 * Goal Planner — LangGraph checkpointer.
 *
 * Durable execution for the planner graph, and the persistence layer that
 * makes HITL `interrupt()`/resume work across HTTP requests.
 *
 *   - Production (`DATABASE_URL` set): `PostgresSaver`. `.setup()` creates
 *     the LangGraph checkpoint tables on first use.
 *   - Dev/test (no `DATABASE_URL`): `MemorySaver` (per-process, no setup).
 *
 * Reads `process.env.DATABASE_URL` directly (rather than `lib/env.ts`) so
 * importing the orchestrator in unit tests never triggers boot validation —
 * same rationale as `goal-planner/config.ts`.
 *
 * The PostgresSaver import is dynamic so the `pg`-backed module is not
 * loaded in unit tests.
 */

import { MemorySaver } from '@langchain/langgraph'
import type { BaseCheckpointSaver } from '@langchain/langgraph'

let cached: BaseCheckpointSaver | null = null
let setupDone = false

export async function getPlanCheckpointer(): Promise<BaseCheckpointSaver> {
  if (cached) return cached
  const url = process.env.DATABASE_URL?.trim()
  if (url) {
    const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres')
    cached = PostgresSaver.fromConnString(url)
  } else {
    cached = new MemorySaver()
  }
  return cached
}

/** Create the checkpoint tables on first production use. Idempotent. */
export async function ensurePlanCheckpointerSetup(): Promise<void> {
  if (setupDone) return
  const cp = await getPlanCheckpointer()
  const maybe = cp as unknown as { setup?: () => Promise<void> }
  if (typeof maybe.setup === 'function') {
    await maybe.setup()
  }
  setupDone = true
}

/** True when the planner is backed by a durable (Postgres) checkpointer. */
export function isPlanPersistenceEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

/**
 * Drop any persisted state for a thread. Called before a FRESH run so the
 * graph starts clean — convention state (`rejects`, `modes`) uses reducers
 * that concatenate, and reusing a conversation thread across runs would
 * otherwise accumulate. Best-effort: a delete failure must not fail a run.
 */
export async function clearPlanThread(threadId: string): Promise<void> {
  const cp = await getPlanCheckpointer()
  const maybe = cp as unknown as { deleteThread?: (id: string) => Promise<void> }
  if (typeof maybe.deleteThread === 'function') {
    try {
      await maybe.deleteThread(threadId)
    } catch {
      /* best effort */
    }
  }
}
