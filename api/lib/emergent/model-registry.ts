/**
 * Client-safe provider model registry.
 *
 * This module contains ONLY pure data: types, the MODEL_REGISTRY constant,
 * the derived MODEL_OPTIONS array, and the getModel() lookup function.
 * No environment access, no server-only imports.
 *
 * Split from `lib/emergent/llm.ts` so client components (e.g. the model
 * switcher in `components/coach/Header.tsx`) can import MODEL_OPTIONS without
 * pulling `server-only` into the browser bundle.
 */

/** Bare provider name expected by the Emergent proxy. */
export type EmergentProvider = 'gemini' | 'openai' | 'anthropic'

/**
 * Identifier for a known LLM provider. Mirrors the entries in
 * `backend/server.py`'s `PROVIDER_MODELS` plus the model-switcher
 * entries the chat UI exposes (see `components/coach/Header.tsx`).
 *
 * The chat UI treats this set as the source of truth for what shows
 * up in the model-switcher dropdown; we keep `MODEL_OPTIONS` derived
 * from this table so adding/removing a provider here is the only edit
 * needed.
 */
export type ProviderId =
  | 'gemini'
  | 'openai'
  | 'claude'

export interface ModelEntry {
  id: ProviderId
  /** Human label for the model switcher. */
  label: string
  /** Small subtitle shown next to the label. */
  hint: string
  /** The provider name the Emergent proxy will route to. */
  provider: EmergentProvider
  /** Model name passed in the OpenAI `model` field (proxy will prefix
   *  `gemini/` for gemini requests automatically). */
  model: string
}

/**
 * Registry — single source of truth for provider selection.
 *
 * The chat route and the model-switcher UI both import this; legacy
 * AI-SDK `getModel()` calls are routed through `getModel()` below.
 *
 * MVP note: when `DEEPSEEK_API_KEY` is set in env, `streamChat`
 * (lib/emergent/stream-chat.ts) routes through DeepSeek instead of the
 * Emergent proxy. DeepSeek only accepts its own model ids, so every row's
 * `model` field is a DeepSeek model id rather than an Emergent-flavored
 * one. For MVP, all three user-facing rows (Gemini / Claude / OpenAI)
 * route to the same backend model — `deepseek-flash`. The UI labels are
 * preserved so the user thinks they're picking the provider they
 * recognize; the actual LLM underneath is uniform. To re-enable Emergent
 * proxy routing per row, restore the prior strings
 * (`gemini/gemini-3-flash-preview`, `claude-sonnet-4-5`, `gpt-5.4`) and
 * unset `DEEPSEEK_API_KEY`.
 */
export const MODEL_REGISTRY: Record<ProviderId, ModelEntry> = {
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    hint: '3 Flash',
    provider: 'gemini',
    model: 'deepseek-flash',
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    hint: 'Sonnet 4.5',
    provider: 'anthropic',
    model: 'deepseek-flash',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    hint: 'GPT-5.4',
    provider: 'openai',
    model: 'deepseek-flash',
  },
}

/** Drop-in shape for the model-switcher UI: `{ value, label, hint }[]`. */
export const MODEL_OPTIONS: ReadonlyArray<{
  value: ProviderId
  label: string
  hint: string
}> = (Object.values(MODEL_REGISTRY) as ModelEntry[]).map((entry) => ({
  value: entry.id,
  label: entry.label,
  hint: entry.hint,
}))

/**
 * Resolve a provider id to its (provider, model) pair.
 *
 * Throws on unknown ids so a typo in a route handler or DB row
 * surfaces as a 500 with a clear message rather than silently picking
 * the default provider.
 */
export function getModel(id: ProviderId): ModelEntry {
  const entry = MODEL_REGISTRY[id]
  if (!entry) throw new Error(`Unknown model: ${id}`)
  return entry
}
