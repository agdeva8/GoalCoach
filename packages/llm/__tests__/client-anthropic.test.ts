import { describe, it, expect, vi, beforeEach } from 'vitest';

// The constructor itself is a vi.fn we can re-implement per test.
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicClient } from '../src/client-anthropic';

function buildEventStream(events: unknown[]): AsyncIterable<unknown> {
  let i = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (i < events.length) {
            return { value: events[i++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe('createAnthropicClient', () => {
  beforeEach(() => {
    vi.mocked(Anthropic).mockReset();
  });

  it('emits a text event for each text_delta from the SDK stream', async () => {
    vi.mocked(Anthropic).mockImplementation(() =>
      (({
        messages: {
          stream: () =>
            buildEventStream([
              {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'hello ' },
              },
              {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'world' },
              },
            ]),
        },
      } as unknown) as Anthropic)
    );

    const client = createAnthropicClient({
      provider: 'anthropic',
      userId: 'u1',
      supabase: null,
      anthropicApiKey: 'sk-test',
    });

    const events = await collect(client.send([], []));
    expect(events).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
      { type: 'done' },
    ]);
  });

  it('emits a tool_use event for each tool_use content_block_start', async () => {
    vi.mocked(Anthropic).mockImplementation(() =>
      (({
        messages: {
          stream: () =>
            buildEventStream([
              {
                type: 'content_block_start',
                content_block: {
                  type: 'tool_use',
                  id: 'tu_1',
                  name: 'list_goals',
                  input: { foo: 1 },
                },
              },
            ]),
        },
      } as unknown) as Anthropic)
    );

    const client = createAnthropicClient({
      provider: 'anthropic',
      userId: 'u1',
      supabase: null,
      anthropicApiKey: 'sk-test',
    });

    const events = await collect(client.send([], []));
    expect(events).toEqual([
      { type: 'tool_use', id: 'tu_1', name: 'list_goals', input: { foo: 1 } },
      { type: 'done' },
    ]);
  });

  it('emits a done event at end of stream', async () => {
    vi.mocked(Anthropic).mockImplementation(() =>
      (({
        messages: { stream: () => buildEventStream([]) },
      } as unknown) as Anthropic)
    );

    const client = createAnthropicClient({
      provider: 'anthropic',
      userId: 'u1',
      supabase: null,
      anthropicApiKey: 'sk-test',
    });

    const events = await collect(client.send([], []));
    expect(events).toEqual([{ type: 'done' }]);
  });

  // When the stream has already emitted text, a throw on the SDK's async
  // iterable cleanup (after message_stop) is a benign cleanup error — not
  // a request failure. Emitting `error` here would surface a spurious red
  // "Internal error" alert under every successful chat reply (qa /qa 2026-09-23).
  // Expected: text events + done, no error.
  it('emits done (not error) when SDK iterable throws after text was already streamed', async () => {
    let i = 0;
    const events = [
      {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'partial ' },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'reply' },
      },
    ];
    const err = new Error('iterator cleanup threw');
    vi.mocked(Anthropic).mockImplementation(() =>
      (({
        messages: {
          stream: () => ({
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  if (i < events.length) {
                    return { value: events[i++], done: false };
                  }
                  throw err;
                },
              };
            },
          }),
        },
      } as unknown) as Anthropic)
    );

    const client = createAnthropicClient({
      provider: 'anthropic',
      userId: 'u1',
      supabase: null,
      anthropicApiKey: 'sk-test',
    });

    const result = await collect(client.send([], []));
    expect(result).toEqual([
      { type: 'text', text: 'partial ' },
      { type: 'text', text: 'reply' },
      { type: 'done' },
    ]);
  });

  it('emits an error event when the SDK throws', async () => {
    vi.mocked(Anthropic).mockImplementation(() =>
      (({
        messages: {
          stream: () => {
            throw new Error('boom');
          },
        },
      } as unknown) as Anthropic)
    );

    const client = createAnthropicClient({
      provider: 'anthropic',
      userId: 'u1',
      supabase: null,
      anthropicApiKey: 'sk-test',
    });

    const events = await collect(client.send([], []));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error' });
    // Internal error details must NOT leak to the client.
    expect((events[0] as any).message).toBe('Internal error');
  });

  it('passes messages and tools to the SDK', async () => {
    let captured: any = null;
    vi.mocked(Anthropic).mockImplementation(() =>
      (({
        messages: {
          stream: (args: any) => {
            captured = args;
            return buildEventStream([]);
          },
        },
      } as unknown) as Anthropic)
    );

    const client = createAnthropicClient({
      provider: 'anthropic',
      userId: 'u1',
      supabase: null,
      anthropicApiKey: 'sk-test',
    });

    const tools = [
      {
        name: 'list_goals',
        description: 'list goals',
        input_schema: { type: 'object' },
      },
    ];
    const messages = [{ role: 'user' as const, content: 'hi' }];

    await collect(client.send(messages, tools));

    expect(captured.messages).toEqual(messages);
    expect(captured.tools).toEqual(tools);
  });

  it('throws at construction when anthropicApiKey is missing', () => {
    expect(() =>
      createAnthropicClient({
        provider: 'anthropic',
        userId: 'u1',
        supabase: null,
      })
    ).toThrow(/anthropicApiKey/);
  });
});
