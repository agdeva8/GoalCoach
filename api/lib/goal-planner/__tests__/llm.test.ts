import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { __resetLlmCaches, completeJsonWithMeta, extractJsonObject } from '../llm'

const Schema = z.object({
  ok: z.boolean(),
  label: z.string(),
  n: z.number().int(),
})

function chatJson(content: string): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 0,
      model: 'deepseek-flash',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

type Init = { body?: string }

describe('extractJsonObject', () => {
  it('pulls the object out of surrounding prose/fences', () => {
    expect(extractJsonObject('here: ```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('throws when there is no object', () => {
    expect(() => extractJsonObject('no json here')).toThrow(/no JSON object/)
  })
})

describe('completeJsonWithMeta paths', () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'sk-test'
    __resetLlmCaches()
  })
  afterEach(() => {
    delete process.env.DEEPSEEK_API_KEY
  })

  it('uses JSON mode in a single call when the backend accepts json_object', async () => {
    const stats = { jsonCalls: 0, plainCalls: 0 }
    const fetchMock = (async (_u: unknown, init: Init) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      if (body.response_format?.type === 'json_object') {
        stats.jsonCalls++
        return chatJson(JSON.stringify({ ok: true, label: 'sutra', n: 7 }))
      }
      stats.plainCalls++
      return chatJson(JSON.stringify({ ok: true, label: 'sutra', n: 7 }))
    }) as unknown as typeof fetch

    const r = await completeJsonWithMeta({ provider: 'gemini', schema: Schema, prompt: 'x', fetch: fetchMock })
    expect(r.meta.mode).toBe('json')
    expect(r.object).toEqual({ ok: true, label: 'sutra', n: 7 })
    expect(stats.jsonCalls).toBe(1)
    expect(stats.plainCalls).toBe(0)
  })

  it('falls back to text when json_object is rejected, and skips it next time', async () => {
    const stats = { jsonCalls: 0, plainCalls: 0 }
    const fetchMock = (async (_u: unknown, init: Init) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      if (body.response_format) {
        stats.jsonCalls++
        return new Response(JSON.stringify({ error: { message: 'response_format not supported' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }
      stats.plainCalls++
      return chatJson(JSON.stringify({ ok: true, label: 'sutra', n: 7 }))
    }) as unknown as typeof fetch

    const r1 = await completeJsonWithMeta({ provider: 'gemini', schema: Schema, prompt: 'a', fetch: fetchMock })
    expect(r1.meta.mode).toBe('text-fallback')

    const r2 = await completeJsonWithMeta({ provider: 'gemini', schema: Schema, prompt: 'b', fetch: fetchMock })
    expect(r2.meta.mode).toBe('text-fallback')

    expect(stats.jsonCalls).toBe(1) // capability cache skipped the doomed retry
    expect(stats.plainCalls).toBe(2)
  })

  it('rejects output that never validates, even after a repair', async () => {
    const fetchMock = (async () => chatJson('{"ok":"not-a-bool"}')) as unknown as typeof fetch
    await expect(
      completeJsonWithMeta({ provider: 'gemini', schema: Schema, prompt: 'x', fetch: fetchMock }),
    ).rejects.toThrow()
  })
})
