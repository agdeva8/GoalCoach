#!/usr/bin/env tsx
/**
 * Smoke test for the Goal Planner typed-output client (Slice 2).
 *
 * Verifies that `completeJson` can pull a Zod-validated object out of the
 * ACTIVE backend (DeepSeek when DEEPSEEK_API_KEY is set, otherwise the
 * Emergent proxy). Two cases:
 *   1. a trivial schema — proves the round trip;
 *   2. a mini plan-shaped schema — proves the structured shape the pipeline
 *      depends on survives the provider's JSON handling.
 *
 * Usage:
 *   pnpm tsx scripts/smoke-plan-model.ts
 *
 * Exits non-zero on failure so CI/deploy can gate on it.
 */

import 'dotenv/config'

import { z } from 'zod'

import { completeJsonWithMeta } from '@/lib/goal-planner/llm'

const Trivial = z.object({
  ok: z.boolean(),
  label: z.string(),
  n: z.number().int(),
})

const MiniPlan = z.object({
  title: z.string(),
  weekly_hours: z.number(),
  phases: z.array(z.string()),
  first_action: z.string(),
})

async function run<S extends z.ZodTypeAny>(
  name: string,
  schema: S,
  prompt: string,
): Promise<boolean> {
  const start = Date.now()
  try {
    const { object, meta } = await completeJsonWithMeta({
      provider: 'gemini',
      schema,
      schemaName: name,
      prompt,
      abortSignal: AbortSignal.timeout(30_000),
    })
    console.log(
      `[smoke] ${name.padEnd(12)} OK ${Date.now() - start}ms ` +
        `(via ${meta.mode}) → ${JSON.stringify(object)}`,
    )
    return true
  } catch (e) {
    console.log(
      `[smoke] ${name.padEnd(12)} FAIL ${Date.now() - start}ms: ${(e as Error).message}`,
    )
    return false
  }
}

async function main(): Promise<void> {
  const results = await Promise.all([
    run(
      'trivial',
      Trivial,
      'Return an object with ok=true, label="sutra", and n=7.',
    ),
    run(
      'mini-plan',
      MiniPlan,
      'Propose a tiny goal: title "Learn tRPC", weekly_hours 5, ' +
        'phases ["Foundations","Active"], first_action "Read the docs intro".',
    ),
  ])
  const failed = results.filter((ok) => !ok).length
  if (failed > 0) {
    console.error(`[smoke] ${failed} case(s) failed.`)
    process.exit(1)
  }
  console.log('[smoke] all cases OK.')
  process.exit(0)
}

main().catch((e) => {
  console.error('[smoke] FATAL', e)
  process.exit(1)
})
