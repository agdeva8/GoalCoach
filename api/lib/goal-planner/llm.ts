/**
 * Goal Planner — typed structured-output client (Slices 2 + 3b + 3c).
 *
 * Three paths, tried in order, all pointed at the SAME backend the streaming
 * chat uses (`resolveBackend()`: DeepSeek when `DEEPSEEK_API_KEY` is set,
 * otherwise the Emergent proxy). Client wrapper, not a provider swap — the
 * Emergent key/integration is unchanged (hard constraint #1).
 *
 *   1. OBJECT (opt-in, `GOAL_PLANNER_USE_OBJECT_MODE=true`): AI SDK
 *      `generateObject` (json_schema). DeepSeek rejects it; OpenAI honors it.
 *   2. JSON (default): raw `response_format: { type: 'json_object' }`.
 *   3. TEXT (last resort): AI SDK `generateText` + JSON extraction.
 *
 * Reasoning is DISABLED by default (`reasoning_effort: 'none'`). The MVP
 * backend (`deepseek-flash`) is a reasoning model: its hidden
 * `reasoning_content` counts against `max_tokens` and was consuming ~1100
 * tokens on a trivial task, truncating/emptying the JSON. Disabling it fixes
 * both reliability (Slice 3c) and latency. Override with
 * `GOAL_PLANNER_REASONING_EFFORT`.
 *
 * Every path is Zod-validated with one repair retry; a truncated response is
 * labelled so the repair asks for a SHORTER answer.
 *
 * NOTE: no `import 'server-only'` (mirrors stream-chat.ts) so smoke scripts
 * can import it under tsx. The Next-facing orchestrator carries the guard.
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

/** Reasoning effort sent to OpenAI-compatible backends. Default disables it. */
const REASONING_EFFORT = process.env.GOAL_PLANNER_REASONING_EFFORT ?? 'none'

/** Output cap (reasoning excluded now). Was 1400, which truncated once
 *  reasoning tokens were counted. */
const MAX_TOKENS = Number(process.env.GOAL_PLANNER_MAX_TOKENS ?? 3000)

/** Opt-in native structured outputs (json_schema). Off by default. */
const USE_OBJECT_MODE = process.env.GOAL_PLANNER_USE_OBJECT_MODE === 'true'

const FALLBACK_SUFFIX =
  'Respond with ONLY a single JSON object matching the required shape. ' +
  'Include EVERY required field, using the exact key names. Be concise. ' +
  'No prose, no markdown fences, no commentary.'

let cachedProvider: ReturnType<typeof createOpenAI> | null = null
let cachedKey: string | null = null

const objectModeUnsupported = new Set<string>()
const jsonModeUnsupported = new Set<string>()

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

type CompletionCall = (prompt: string) => Promise<{ text: string; truncated: boolean }>

/** Raw JSON-mode completion. Returns content + whether it hit the token cap. */
async function rawJsonCompletion(args: {
  backend: { url: string; apiKey: string }
  modelId: string
  system: string
  prompt: string
  abortSignal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<{ text: string; truncated: boolean }> {
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
      reasoning_effort: REASONING_EFFORT,
      max_tokens: MAX_TOKENS,
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
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>
  }
  const choice = json?.choices?.[0]
  const content = choice?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('json-mode returned empty content')
  }
  return { text: content, truncated: choice?.finish_reason === 'length' }
}

/** Run a completion call, Zod-parse it, and repair once on failure. */
async function runWithRepair<S extends z.ZodTypeAny>(
  call: CompletionCall,
  schema: S,
  basePrompt: string,
): Promise<z.infer<S>> {
  const first = await call(basePrompt)
  try {
    return schema.parse(extractJsonObject(first.text)) as z.infer<S>
  } catch (firstErr) {
    const hint = first.truncated
      ? 'Your previous answer was TRUNCATED because it was too long. ' +
        'Return a SHORTER response that still includes every required field.'
      : 'Your previous answer did not match the required JSON shape.'
    const repairPrompt =
      `${basePrompt}\n\n${hint}\nPrevious answer:\n${first.text}\n\n` +
      `Problems:\n${zodIssues(firstErr)}\n\nReturn ONLY corrected JSON.`
    const second = await call(repairPrompt)
    try {
      return schema.parse(extractJsonObject(second.text)) as z.infer<S>
    } catch (secondErr) {
      throw new Error(
        `failed after repair. first: ${zodIssues(firstErr)} | second: ${zodIssues(secondErr)}`,
      )
    }
  }
}

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
        maxOutputTokens: MAX_TOKENS,
        providerOptions: { openai: { reasoningEffort: REASONING_EFFORT } },
        abortSignal: args.abortSignal,
      })
      return { object: object as z.infer<S>, meta: { mode: 'object' } }
    } catch (e) {
      objectModeUnsupported.add(capKey)
      if (args.abortSignal?.aborted) throw e
    }
  }

  // Path 2 — JSON mode (default).
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
      if (isJsonModeUnsupported(e)) jsonModeUnsupported.add(capKey)
      if (args.abortSignal?.aborted) throw e
    }
  }

  // Path 3 — plain text + repair.
  const model = getProvider(args.fetch).chat(modelId)
  const object = await runWithRepair(
    async (prompt) => {
      const { text, finishReason } = await generateText({
        model,
        system,
        prompt,
        maxOutputTokens: MAX_TOKENS,
        providerOptions: { openai: { reasoningEffort: REASONING_EFFORT } },
        abortSignal: args.abortSignal,
      })
      return { text, truncated: finishReason === 'length' }
    },
    args.schema,
    args.prompt,
  )
  return { object, meta: { mode: 'text-fallback' } }
}

function isJsonModeUnsupported(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.startsWith('json-mode ') || msg === 'json-mode returned empty content'
}

export async function completeJson<S extends z.ZodTypeAny>(
  args: CompleteJsonArgs<S>,
): Promise<z.infer<S>> {
  return (await completeJsonWithMeta(args)).object
}
