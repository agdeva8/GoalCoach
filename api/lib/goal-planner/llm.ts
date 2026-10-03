/**
 * Goal Planner — typed structured-output client.
 *
 * DELEGATES to the shared AI SDK client (`lib/llm/client.ts`) so motivation,
 * the planner, and the streaming transport all share one provider +
 * structured-output implementation. Kept as a module (rather than deleting
 * it) because `orchestrator.ts` and the unit tests import from here.
 *
 * Three paths, tried in order by the shared client:
 *   1. OBJECT (opt-in): AI SDK `generateObject` (json_schema).
 *   2. JSON (default): raw `response_format: { type: 'json_object' }`.
 *   3. TEXT (last resort): AI SDK `generateText` + JSON extraction.
 *
 * NOTE: no `import 'server-only'` (mirrors `stream-chat.ts`) so smoke scripts
 * can import it under tsx.
 */

export {
  completeJsonWithMeta,
  completeJson,
  __resetLlmCaches,
  extractJsonObject,
  getSutraProvider,
  sutraChatModel,
  type CompleteJsonArgs,
  type CompleteJsonMode,
  type CompleteJsonMeta,
} from '@/lib/llm/client'
