/**
 * POST /api/chat/guest_stream
 *
 * Unauthenticated preview-mode chat — no session, no DB persistence.
 * Ports `backend/server.py:715-773` to Next.js Route Handler + Emergent LLM.
 *
 * Request body: { message: string, history?: ChatMessage[], auto_answer?: boolean }
 * Response: text/event-stream in legacy wire format.
 */

import { randomUUID } from 'node:crypto'

import { NextRequest } from 'next/server'

import {
  parseProposals,
  splitProseAndTools,
  streamChat,
} from '@/lib/emergent/llm'
import { SYSTEM_PROMPT } from '@/lib/llm/prompts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface GuestChatBody {
  message?: unknown
  history?: Array<{ role?: string; content?: string }>
  auto_answer?: boolean
}

export async function POST(req: NextRequest) {
  let body: GuestChatBody
  try {
    body = (await req.json()) as GuestChatBody
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    return new Response('Bad request', { status: 400 })
  }

  const autoAnswer = body.auto_answer === true
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = (body.history ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content ?? '') }))

  const today = new Date().toISOString().split('T')[0]
  const ctx: string[] = [
    `Today is ${today}.`,
    `AUTO-ANSWER MODE: ${autoAnswer ? 'on' : 'off'}.`,
    'PREVIEW MODE: the user is NOT signed in. There is no saved state or long-term memory. You may synthesize and PROPOSE tool calls normally, but they will not be saved until the user signs in.',
  ]
  if (history.length > 0) {
    ctx.push('\nRECENT CONVERSATION (oldest first):')
    for (const m of history.slice(-16)) {
      const role = m.role === 'user' ? 'User' : 'Coach'
      ctx.push(`${role}: ${m.content}`)
    }
  }
  const system = SYSTEM_PROMPT + '\n\n=== LIVE STATE & MEMORY ===\n' + ctx.join('\n')

  const encoder = new TextEncoder()
  const sessionId = `guest_${randomUUID().slice(0, 8)}`

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          /* stream closed */
        }
      }

      try {
        let full = ''
        let proseEmitted = 0
        let inTools = false

        for await (const ev of streamChat({
          provider: 'gemini',
          model: 'gemini-3-flash-preview',
          system,
          messages: history,
          sessionId,
        })) {
          if (ev.type === 'text_delta') {
            full += ev.content
            if (!inTools) {
              const toolStart = '[[TOOLS]]'
              const idx = full.indexOf(toolStart)
              if (idx === -1) {
                const safeUpTo = Math.max(proseEmitted, full.length - toolStart.length)
                if (safeUpTo > proseEmitted) {
                  enqueue({ type: 'delta', content: full.slice(proseEmitted, safeUpTo) })
                  proseEmitted = safeUpTo
                }
              } else {
                if (idx > proseEmitted) {
                  enqueue({ type: 'delta', content: full.slice(proseEmitted, idx) })
                }
                proseEmitted = idx
                inTools = true
              }
            }
          } else if (ev.type === 'stream_done') {
            break
          }
        }

        if (!inTools && proseEmitted < full.length) {
          enqueue({ type: 'delta', content: full.slice(proseEmitted) })
        }

        const { prose } = splitProseAndTools(full)
        const proposals = parseProposals(prose)
        if (proposals.length > 0) {
          enqueue({ type: 'tools', message_id: 'guest', proposals })
        }
        enqueue({ type: 'done', message_id: 'guest', provider: 'gemini' })
      } catch (e) {
        enqueue({ type: 'error', content: `Model error: ${(e as Error).message ?? String(e)}` })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}
