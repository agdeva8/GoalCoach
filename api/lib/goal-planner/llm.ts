/**
 * Goal Planner — typed structured-output client (Slices 2 + 3b).
 *
 * Three paths, tried in order, all pointed at the SAME backend the streaming
 * chat uses (`resolveBackend()`: DeepSeek when `DEEPSEEK_API_KEY` is set,
 * otherwise the Emergent proxy). This is a client wrapper, not a provider
 * swap — the Emergent integration/key is unchanged (hard constraint #1).
 *
 *   1. OBJECT (opt-in, `GOAL_PLANNER_USE_OBJECT_MODE=true`): the Vercel AI
 *      SDK's `generateObject`, which sends OpenAI-style
 *      `response_format: json_schema`. Only real OpenAI / capable proxies
 *      accept this — DeepSeek rejects it.
 *   2. JSON (default): a raw `response_format: { type: 'json_object' }`
 *      completion. DeepSeek supports this; it is ONE call and far faster than
 *      the old text fallback (Slice 3b latency fix).
 *   3. TEXT (last resort): AI SDK `generateText` + JSON extraction.
 *
 * Every path is followed by Zod validation and ONE repair retry (the raw
 * answer + validation errors are sent back and corrected JSON is requested).
 * Capability caches remember which paths a backend rejects, so the doomed
 * attempt is paid once per process, not per call.
 *
 * NOTE: deliberately does NOT `import 'server-only'` — mirroring
 * `lib/emergent/stream-chat.ts`, so smoke scripts can import it under tsx.
 * The Next-facing orchestrator carries the `server-only` guard.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateObject, generateText, zodSchema } from 'ai'
import { z } from 'zod'

import { getModel } from '@/lib/emergent/model-registry'
import type { ProviderId } from '@/lib/emergent/model-registry'
import { resolveBackend } from '@/lib/emergent/stream-chat'

export interface CompleteJsonArgs<S extends z.ZodTypeAny> {
  provider: ProviderId
  schema: S
  schemaName?: string
  schemaDescription?: string
  system?: string
  prompt: string
  abortSignal?: AbortSignal
  /** Test/injection hook. When set, provider caching is bypassed. */
  fetch?: typeof fetch
}

export type CompleteJsonMode = 'object' | 'json' | 'text-fallback'

export interface CompleteJsonMeta {
  mode: CompleteJsonMode
}

const FALLBACK_SUFFIX =
  'Respond with ONLY a single JSON object matching the required shape. ' +
  'Include EVERY required field, using the exact key names. ' +
  'No prose, no markdown fences, no commentary.'

/** Opt-in native structured outputs (json_schema). Off by default. */
const USE_OBJECT_MODE = process.env.GOAL_PLANNER_USE_OBJECT_MODE === 'true'

let cachedProvider: ReturnType<typeof createOpenAI> | null = null
let cachedKey: string | null = null

/** Backends that rejected json_schema / json_object — skip straight past them. */
const objectModeUnsupported = new Set<string>()
const jsonModeUnsupported = new Set<string>()

/** Test hook — clears provider + capability caches between tests. */
export function __resetLlmCaches(): void {
  cachedProvider = null
  cachedKey = null
  objectModeUnsupported.clear()
  jsonModeUnsupported.clear()
}

function getProvider(fetchImpl?: typeof fetch) {
  const backend = resolveBackend()
  if (fetchImpl) {
    return createOpenAI({ baseURL: backend.url, apiKey: backend.apiKey, name: 'sutra', fetch: fetchImpl })
  }
  const key = `${backend.url}|${backend.apiKey}`
  if (!cachedProvider || cachedKey !== key) {
    cachedProvider = createOpenAI({ baseURL: backend.url, apiKey: backend.apiKey, name: 'sutra' })
    cachedKey = key
  }
  return cachedProvider
}

/** Extract the first top-level JSON object from arbitrary text. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON object found in model response')
  }
  return JSON.parse(text.slice(start, end + 1))
}

function zodIssues(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
  }
  return err instanceof Error ? err.message : String(err)
}

function fallbackSystem(system?: string): string {
  return system ? `${system}\n\n${FALLBACK_SUFFIX}` : FALLBACK_SUFFIX
}

/**
 * Raw JSON-mode completion (`response_format: json_object`). Returns the
 * assistant content string. Throws on non-2xx (caller records the backend as
 * json-mode-unsupported and falls through).
 */
async function rawJsonCompletion(args: {
  backend: { url: string; apiKey: string }
  modelId: string
  system: string
  prompt: string
  abortSignal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<string> {
  const doFetch = args.fetchImpl ?? fetch
  const resp = await doFetch(`${args.backend.url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.backend.apiKey}`,
    },
    body: JSON.stringify({
      model: args.modelId,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
    signal: args.abortSignal,
    cache: 'no-store',
  })
  if (!resp.ok) {
    let detail = ''
    try {
      detail = (await resp.text()).slice(0, 300)
    } catch {
      /* ignore */
    }
    throw new Error(`json-mode ${resp.status}${detail ? `: ${detail}` : ''}`)
  }
  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('json-mode returned empty content')
  }
  return content
}

/** Run a text-producing call, Zod-parse it, and repair once on failure. */
async function runWithRepair<S extends z.ZodTypeAny>(
  call: (prompt: string) => Promise<string>,
  schema: S,
  basePrompt: string,
): Promise<z.infer<S>> {
  const first = await call(basePrompt)
  try {
    return schema.parse(extractJsonObject(first)) as z.infer<S>
  } catch (firstErr) {
    const repairPrompt =
      `${basePrompt}\n\nYour previous answer did not match the required JSON shape.\n` +
      `Previous answer:\n${first}\n\n` +
      `Problems:\n${zodIssues(firstErr)}\n\n` +
      'Return ONLY corrected JSON with every required field present.'
    const second = await call(repairPrompt)
    try {
      return schema.parse(extractJsonObject(second)) as z.infer<S>
    } catch (secondErr) {
      throw new Error(
        `failed after repair. first: ${zodIssues(firstErr)} | second: ${zodIssues(secondErr)}`,
      )
    }
  }
}

/**
 * Typed structured completion. Returns a value already validated against
 * `args.schema`; throws only when every path fails. Callers (the
 * orchestrator) catch and degrade to `no_change`.
 */
export async function completeJsonWithMeta<S extends z.ZodTypeAny>(
  args: CompleteJsonArgs<S>,
): Promise<{ object: z.infer<S>; meta: CompleteJsonMeta }> {
  const backend = resolveBackend()
  const modelId = getModel(args.provider).model
  const capKey = `${backend.url}|${modelId}${args.fetch ? ':custom' : ''}`
  const system = fallbackSystem(args.system)

  // Path 1 — native json_schema (opt-in).
  if (USE_OBJECT_MODE && !objectModeUnsupported.has(capKey)) {
    try {
      const model = getProvider(args.fetch).chat(modelId)
      const { object } = await generateObject({
        model,
        schema: zodSchema(args.schema),
        schemaName: args.schemaName,
        schemaDescription: args.schemaDescription,
        system: args.system,
        prompt: args.prompt,
        abortSignal: args.abortSignal,
      })
      return { object: object as z.infer<S>, meta: { mode: 'object' } }
    } catch (e) {
      objectModeUnsupported.add(capKey)
      if (args.abortSignal?.aborted) throw e
    }
  }

  // Path 2 — JSON mode (default; fast, DeepSeek-friendly).
  if (!jsonModeUnsupported.has(capKey)) {
    try {
      const object = await runWithRepair(
        (prompt) =>
          rawJsonCompletion({
            backend,
            modelId,
            system,
            prompt,
            abortSignal: args.abortSignal,
            fetchImpl: args.fetch,
          }),
        args.schema,
        args.prompt,
      )
      return { object, meta: { mode: 'json' } }
    } catch (e) {
      // If the endpoint itself rejected json_object, remember it. If it was a
      // validation failure, the text path may still succeed.
      if (isJsonModeUnsupported(e)) jsonModeUnsupported.add(capKey)
      if (args.abortSignal?.aborted) throw e
    }
  }

  // Path 3 — plain text + repair.
  const model = getProvider(args.fetch).chat(modelId)
  const object = await runWithRepair(
    async (prompt) => {
      const { text } = await generateText({
        model,
        system,
        prompt,
        abortSignal: args.abortSignal,
      })
      return text
    },
    args.schema,
    args.prompt,
  )
  return { object, meta: { mode: 'text-fallback' } }
}

/** True when the failure was the endpoint rejecting json_object (vs. bad output). */
function isJsonModeUnsupported(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.startsWith('json-mode ') || msg === 'json-mode returned empty content'
}

/** Convenience wrapper — the object without the path metadata. */
export async function completeJson<S extends z.ZodTypeAny>(
  args: CompleteJsonArgs<S>,
): Promise<z.infer<S>> {
  return (await completeJsonWithMeta(args)).object
}
