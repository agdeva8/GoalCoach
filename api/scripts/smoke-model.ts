#!/usr/bin/env tsx
/**
 * Smoke test for the Emergent LLM client.
 *
 * For every provider in `MODEL_REGISTRY`, send a 1-token test prompt
 * and stream the response. Report whether each provider responded
 * within the 10-second budget. Exit 0 if all providers succeed,
 * non-zero if any fails (so CI can gate deploys on it).
 *
 * Usage:
 *   pnpm tsx scripts/smoke-model.ts
 *
 * Required env vars:
 *   EMERGENT_LLM_KEY (single key for all providers)
 *   INTEGRATION_PROXY_URL (optional override)
 *
 * Note: this script bypasses `lib/env.ts` because env validation would
 * otherwise require DATABASE_URL — irrelevant to the smoke test and
 * unnecessary friction. We read `EMERGENT_LLM_KEY` directly via
 * `process.env`.
 */

import 'dotenv/config'

import { MODEL_REGISTRY, type ProviderId } from '@/lib/emergent/model-registry'
import { streamChat } from '@/lib/emergent/stream-chat'

const TIMEOUT_MS = 10_000

interface ProviderResult {
  id: ProviderId
  ok: boolean
  ms: number
  bytes: number
  error?: string
}

async function smokeOne(id: ProviderId): Promise<ProviderResult> {
  const start = Date.now()
  let bytes = 0
  try {
    const iter = streamChat({
      provider: id,
      system: 'You are a smoke-test assistant. Reply with one short word.',
      messages: [{ role: 'user', content: 'ping' }],
      sessionId: `smoke_${id}_${Date.now()}`,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    for await (const ev of iter) {
      if (ev.type === 'text_delta') bytes += ev.content.length
    }
    return { id, ok: true, ms: Date.now() - start, bytes }
  } catch (e) {
    return {
      id,
      ok: false,
      ms: Date.now() - start,
      bytes,
      error: (e as Error).message ?? String(e),
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.EMERGENT_LLM_KEY) {
    console.error('EMERGENT_LLM_KEY is not set. Aborting smoke test.')
    process.exit(2)
  }
  const ids = Object.keys(MODEL_REGISTRY) as ProviderId[]
  const results: ProviderResult[] = []
  for (const id of ids) {
    process.stdout.write(`[smoke] ${id.padEnd(24)} … `)
    const r = await smokeOne(id)
    results.push(r)
    console.log(
      r.ok
        ? `OK ${r.ms}ms, ${r.bytes} bytes`
        : `FAIL ${r.ms}ms: ${r.error ?? 'unknown error'}`,
    )
  }
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    console.error(`[smoke] ${failed.length} provider(s) failed.`)
    process.exit(1)
  }
  console.log(`[smoke] all ${results.length} providers OK.`)
  process.exit(0)
}

main().catch((e) => {
  console.error('[smoke] FATAL', e)
  process.exit(1)
})