/**
 * Motivation agent — frame generator.
 *
 * Writes the one-line sentence that sits under each item title in the
 * MotivationCard. The frame is the moment of personal relevance: a
 * 1-2 sentence note that puts the candidate in the user's current
 * moment (overdue vs. dormant vs. stuck).
 *
 * Implementation:
 *   - Calls the CHEAP_MODEL (gemini-3-flash) with a short prompt.
 *   - Falls back to a deterministic template on parse failure,
 *     timeout, or any error — never throw.
 *
 * Stage timeout: STAGE_TIMEOUTS.frame (2s) — same deadline discipline
 * as the rest of the pipeline.
 */

import 'server-only'

import { streamChat } from '@/lib/emergent/stream-chat'

import { CHEAP_MODEL, CHEAP_PROVIDER, STAGE_TIMEOUTS } from './config'
import type { Bucket, ScoredCandidate } from './schema'

/* -------------------------------------------------------------------------- */
/* Style guide (mirrors the critique prompt, kept short)                      */
/* -------------------------------------------------------------------------- */

const FRAME_STYLE = [
  'Warm, second-person, no preachy or moralistic tone.',
  'No hustle-bros, no toxic positivity, no "you got this!" cheerleading.',
  'Quietly confident — the user is in charge; we are the sidekick.',
  'Tie the item to the user\u2019s current state in one short sentence.',
  'Then offer one concrete micro-action the user could try in the next 2 minutes.',
].join('\n')

const STATE_SENTENCE: Record<Bucket, string> = {
  overdue: 'Right now, you have items past due.',
  dormant: 'Right now, things have been quiet for a while.',
  stuck: "Right now, you're in the hard middle.",
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Frame a single candidate. Returns either the LLM-generated frame
 * or the deterministic fallback — never throws.
 */
export async function frameCandidate(args: {
  candidate: ScoredCandidate
  bucket: Bucket
  sessionId: string
}): Promise<string> {
  const { candidate, bucket, sessionId } = args
  const fallback = fallbackFrame(candidate, bucket)

  try {
    return await callFrame({
      candidate,
      bucket,
      sessionId,
      timeoutMs: STAGE_TIMEOUTS.frame,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[motivation] frame LLM failed, using fallback:', err)
    return fallback
  }
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

async function callFrame(args: {
  candidate: ScoredCandidate
  bucket: Bucket
  sessionId: string
  timeoutMs: number
}): Promise<string> {
  const { candidate, bucket, sessionId, timeoutMs } = args

  const systemPrompt = [
    'You are the voice of Sutra, a personal goal-coaching app.',
    'Your job: write ONE short sentence (15-30 words) that frames a piece',
    'of curated content for a user who is slipping on a goal.',
    '',
    '## Voice',
    FRAME_STYLE,
    '',
    '## Output format',
    'Return ONLY the sentence. No preamble, no quotes, no JSON.',
  ].join('\n')

  const stateLine = STATE_SENTENCE[bucket]
  const themesLine = candidate.top_reasons.length
    ? `\nWhy this piece fits: ${candidate.top_reasons.slice(0, 3).join('; ')}.`
    : ''
  const userPrompt =
    `User state: ${stateLine}\n` +
    `Item: "${candidate.title}" by ${candidate.author} (${candidate.kind}, ${candidate.duration}).\n` +
    `Excerpt: ${candidate.excerpt}${themesLine}\n\n` +
    `Write the frame sentence now.`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  let full = ''
  try {
    for await (const ev of streamChat({
      // Provider id (for the registry lookup); the actual model name
      // comes from `CHEAP_MODEL`, which reads `MODEL_REGISTRY.gemini.model`
      // — at MVP that resolves to `deepseek-flash` whenever
      // `DEEPSEEK_API_KEY` is set (see `lib/emergent/model-registry.ts`
      // MVP note).
      provider: CHEAP_PROVIDER,
      model: CHEAP_MODEL,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      sessionId,
      signal: ctrl.signal,
    })) {
      if (ev.type === 'text_delta') full += ev.content
      else if (ev.type === 'stream_done') full = ev.content
    }
  } finally {
    clearTimeout(timer)
  }

  const cleaned = full
    .trim()
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Reject if empty, suspiciously long, or just an echo of the prompt.
  if (cleaned.length < 10) throw new Error('frame_too_short')
  if (cleaned.length > 240) throw new Error('frame_too_long')
  if (cleaned.toLowerCase() === userPrompt.trim().toLowerCase()) {
    throw new Error('frame_echoed_prompt')
  }

  return cleaned
}

/* -------------------------------------------------------------------------- */
/* Deterministic fallback                                                     */
/* -------------------------------------------------------------------------- */

export function fallbackFrame(
  candidate: ScoredCandidate,
  bucket: Bucket,
): string {
  const stateLine = STATE_SENTENCE[bucket]
  // Truncate the excerpt so the fallback line stays card-friendly.
  const trimmed = candidate.excerpt.length > 180
    ? `${candidate.excerpt.slice(0, 177).trimEnd()}\u2026`
    : candidate.excerpt
  return `${stateLine} ${trimmed}`
}
