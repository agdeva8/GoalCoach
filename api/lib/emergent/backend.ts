/**
 * LLM backend resolution.
 *
 * Split out of `stream-chat.ts` so the AI SDK client (`lib/llm/client.ts`)
 * can resolve the active backend without importing the streaming module
 * (which would create a cycle: client → stream-chat → client).
 *
 * No `server-only` guard here — it mirrors `stream-chat.ts` and stays
 * importable by smoke scripts running under `tsx`.
 *
 * Env precedence:
 *   1. DeepSeek  — `DEEPSEEK_API_KEY` set → DeepSeek (URL defaults to
 *                  `https://api.deepseek.com`).
 *   2. Emergent  — `EMERGENT_LLM_KEY` (with optional `INTEGRATION_PROXY_URL`).
 *
 * Throws when neither path has the keys it needs.
 */

const DEFAULT_PROXY_URL = 'https://integrations.emergentagent.com'
const DEFAULT_DEEPSEEK_URL = 'https://api.deepseek.com'

export function resolveBackend(): { url: string; apiKey: string } {
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (deepseekKey && deepseekKey.length > 0) {
    const deepseekUrl = process.env.DEEPSEEK_API_URL?.trim()
    return {
      url: (deepseekUrl && deepseekUrl.length > 0
        ? deepseekUrl
        : DEFAULT_DEEPSEEK_URL
      ).replace(/\/$/, ''),
      apiKey: deepseekKey,
    }
  }

  const emergentKey = process.env.EMERGENT_LLM_KEY
  if (!emergentKey || emergentKey.length === 0) {
    throw new Error(
      'No LLM backend configured. Set DEEPSEEK_API_KEY (and optionally DEEPSEEK_API_URL) for DeepSeek, or EMERGENT_LLM_KEY for the Emergent proxy.',
    )
  }
  if (!emergentKey.startsWith('sk-emergent-')) {
    throw new Error(
      'EMERGENT_LLM_KEY must start with "sk-emergent-". Direct provider keys are rejected by the Emergent proxy.',
    )
  }
  const emergentUrl = process.env.INTEGRATION_PROXY_URL?.trim()
  return {
    url: (emergentUrl && emergentUrl.length > 0 ? emergentUrl : DEFAULT_PROXY_URL).replace(/\/$/, ''),
    apiKey: emergentKey,
  }
}
