export class ToolError extends Error {
  constructor(message: string, public tool: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export type ToolHandler<I = unknown, O = unknown, C = unknown> = (
  input: I,
  ctx: C
) => Promise<O>;

export type HandlerMap<I = unknown, O = unknown, C = unknown> = Record<
  string,
  ToolHandler<I, O, C>
>;

// Eng D9 hardening: cap input size + reject null bytes
const MAX_INPUT_BYTES = 8 * 1024;

function containsNullByte(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(containsNullByte);
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsNullByte);
  }
  return false;
}

function checkInputSafety(input: unknown): void {
  const serialized = JSON.stringify(input ?? {});
  if (serialized.length > MAX_INPUT_BYTES) {
    throw new ToolError(`input too large: ${serialized.length} bytes`, 'router');
  }
  if (containsNullByte(input)) {
    throw new ToolError('input contains null byte', 'router');
  }
}

export async function runTool<I = unknown, O = unknown, C = unknown>(
  name: string,
  input: I,
  handlers: HandlerMap,
  ctx: C = {} as C
): Promise<O> {
  checkInputSafety(input);
  const handler = handlers[name];
  if (!handler) {
    throw new ToolError(`unknown tool: ${name}`, name);
  }
  return (await handler(input, ctx)) as O;
}

// L3 D13: models occasionally emit malformed tool-call args (e.g. a
// truncated JSON blob) — one retry lets the model correct the call
// instead of failing the turn. Only `malformed args` is retryable;
// every other error (unknown tool, oversized input, domain failures)
// is re-thrown immediately, so retries never mask real faults.
export async function runToolWithRetry<I = unknown, O = unknown, C = unknown>(
  handler: ToolHandler<I, O, C>,
  input: I,
  ctx: C,
  opts: { retries: number } = { retries: 1 }
): Promise<O> {
  // Defense-in-depth: this wrapper is the dispatch entry point for
  // LLM-emitted tool calls, so it must screen input itself rather than
  // relying on `runTool` (which it bypasses).
  checkInputSafety(input);
  let lastErr: unknown;
  for (let i = 0; i <= opts.retries; i += 1) {
    try {
      return await handler(input, ctx);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof ToolError) || err.message !== 'malformed args') throw err;
    }
  }
  throw lastErr;
}
