import { getValidGeminiToken } from './token-store';
import type { ClientDeps, ClientMessage, LLMClient, StreamEvent, ToolSpec } from './types';

// PHASE 1 LIMITATION (per plan): Gemini tool_use (function calling) is
// NOT supported here. Tools passed via the `tools` argument are converted
// into a systemInstruction prompt section — Gemini sees them as
// conversational instructions only, and this client never yields
// `tool_use` events. The chat route's two-pass tool flow therefore does
// not fire for Gemini in Phase 1. Phase 1.5 will add proper function
// declarations. The plan's "Deferred" section captures this.

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

function toolsToSystemInstruction(tools: ToolSpec[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map((t) => `- ${t.name}: ${t.description}`);
  return [
    'You have access to the following tools, but you cannot call them directly in this mode.',
    'If the user asks something that needs a tool, describe the action you would take:',
    ...lines,
  ].join('\n');
}

function buildRequestBody(
  messages: ClientMessage[],
  tools: ToolSpec[],
  accessToken: string
): { url: string; init: RequestInit } {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}` +
    `:streamGenerateContent?alt=sse`;

  const systemText = toolsToSystemInstruction(tools);
  const systemInstruction = systemText
    ? { parts: [{ text: systemText }] }
    : undefined;

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        ...(systemInstruction ? { systemInstruction } : {}),
        contents,
      }),
    },
  };
}

// Parse a single SSE `data:` line into one or more JSON objects. Gemini
// occasionally packs multiple candidates into one data: line as a JSON
// array — handle that. Skip blank lines, comments, and `[DONE]` sentinels.
function parseDataLine(line: string): unknown[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return [];
  if (!trimmed.startsWith('data:')) return [];
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return [];
  // Strip a single trailing comma some servers append.
  const cleaned = payload.endsWith(',') ? payload.slice(0, -1) : payload;
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    // Multi-object on one line, separated by `},{`. Split + repair.
    if (cleaned.includes('},{')) {
      const fixed = '[' + cleaned.replace(/\}\,\{/g, '},{') + ']';
      try {
        const parsed = JSON.parse(fixed);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }
    return [];
  }
}

function extractText(json: unknown): string | null {
  // Gemini candidate shape: { candidates: [{ content: { parts: [{ text }] } }] }
  const obj = json as any;
  const parts = obj?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .join('');
  return text || null;
}

export function createGeminiClient(deps: ClientDeps): LLMClient {
  return {
    async *send(messages: ClientMessage[], tools: ToolSpec[]): AsyncIterable<StreamEvent> {
      // Tracks whether we've already streamed a real event. If a throw
      // happens AFTER we have streamed, it's almost certainly a body-
      // reader cleanup error (see parallel fix in client-anthropic.ts),
      // not a request failure. Surfacing it as `error` produces a
      // spurious red "Internal error" alert under every successful
      // chat reply (qa /qa 2026-09-23).
      let emittedAny = false;
      try {
        const accessToken = await getValidGeminiToken(deps.supabase, deps.userId);
        const { url, init } = buildRequestBody(messages, tools, accessToken);

        const res = await fetch(url, init);
        if (!res.ok || !res.body) {
          yield { type: 'error', message: 'Internal error' };
          return;
        }

        // Use a streaming TextDecoder to handle chunks that split a
        // multi-byte UTF-8 character across boundaries.
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: false });
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Split on SSE event boundary (\n\n or \r\n\r\n).
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? '';

          for (const ev of events) {
            const lines = ev.split(/\r?\n/);
            for (const line of lines) {
              const objects = parseDataLine(line);
              for (const obj of objects) {
                const text = extractText(obj);
                if (text) {
                  emittedAny = true;
                  yield { type: 'text', text };
                }
              }
            }
          }
        }

        // Flush any tail the decoder is holding (final chunk).
        buffer += decoder.decode();
        if (buffer.trim()) {
          for (const line of buffer.split(/\r?\n/)) {
            const objects = parseDataLine(line);
            for (const obj of objects) {
              const text = extractText(obj);
              if (text) {
                emittedAny = true;
                yield { type: 'text', text };
              }
            }
          }
        }

        // Always emit done so the caller can finalize the SSE stream
        // and persist the assistant message.
        if (!emittedAny) {
          // Empty response — still close cleanly so the chat route can
          // record the turn.
          yield { type: 'text', text: '' };
        }
        yield { type: 'done' };
      } catch (_err) {
        // Cleanup-only error: we already streamed something to the user,
        // so reporting `error` would contradict the partial response.
        // Emit `done` so the chat route can persist the partial turn.
        // (Regression caught by /qa 2026-09-23 in the parallel Anthropic
        // client; applied here for symmetry.)
        if (emittedAny) {
          yield { type: 'done' };
          return;
        }
        // Token refresh failures and any other internal error collapse
        // to a single redacted error event.
        yield { type: 'error', message: 'Internal error' };
      }
    },
  };
}
