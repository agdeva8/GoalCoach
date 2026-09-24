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
 * Note: the python PROVIDER_MODELS uses the key `openai` for what the
 * architecture plan calls `claude` (i.e. Anthropic). We keep both
 * `claude` and `anthropic` keys here mapping to the same model so
 * legacy `model_provider='anthropic'` requests keep working.
 */
export const MODEL_REGISTRY: Record<ProviderId, ModelEntry> = {
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    hint: '3 Flash',
    provider: 'gemini',
    // Emergent requires the `gemini/` prefix on this model id.
    model: 'gemini/gemini-3-flash-preview',
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    hint: 'Sonnet 4.5',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    hint: 'GPT-5.4',
    provider: 'openai',
    model: 'gpt-5.4',
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
