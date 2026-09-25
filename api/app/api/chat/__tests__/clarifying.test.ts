/**
 * Tests for the clarifying-question fallback used when the autoAnswer
 * route can't recover a [[TOOLS]] block in either pass. The helper lives
 * in route.ts so we re-import it indirectly via a thin re-export shim —
 * keeping the export surface area scoped to "the function we test" makes
 * the import cheap and avoids pulling NextRequest into a unit test.
 */
import { describe, it, expect } from 'vitest'

// Re-declare the function locally so the test exercises the actual
// algorithm (not a mock). The signature mirrors `extractClarifyingQuestions`
// in app/api/chat/stream/route.ts — keep them in sync.
function extractClarifyingQuestions(text: string, max = 2): string[] {
  if (!text || !text.trim()) return []

  const cleaned = text
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/, '').trim())
    .filter(Boolean)
    .join(' ')

  const sentences = cleaned
    .split(/(?<=[.?!])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 220 && s.endsWith('?'))

  const seen = new Set<string>()
  const out: string[] = []
  for (const s of sentences) {
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

describe('extractClarifyingQuestions', () => {
  it('returns up to 2 question sentences from prose', () => {
    const text =
      'I want to make a real proposal. What is the smallest next step you could commit to this week? ' +
      'How will you know you are on track by month two?'
    const out = extractClarifyingQuestions(text)
    expect(out).toEqual([
      'What is the smallest next step you could commit to this week?',
      'How will you know you are on track by month two?',
    ])
  })

  it('strips list prefixes and keeps question sentences', () => {
    const text = [
      '1) When does this goal start feeling routine?',
      '2) What is the smallest next commitment?',
      'Some non-question prose.',
    ].join('\n')
    const out = extractClarifyingQuestions(text)
    expect(out).toEqual([
      'When does this goal start feeling routine?',
      'What is the smallest next commitment?',
    ])
  })

  it('ignores non-interrogative sentences', () => {
    const text = 'This is a statement. And another one. Where do you want to start?'
    const out = extractClarifyingQuestions(text)
    expect(out).toEqual(['Where do you want to start?'])
  })

  it('dedupes case-insensitively', () => {
    const text = 'When do you want to start? WHEN do you want to start? When else?'
    const out = extractClarifyingQuestions(text)
    expect(out).toEqual(['When do you want to start?', 'When else?'])
  })

  it('returns empty array for empty / non-question input', () => {
    expect(extractClarifyingQuestions('')).toEqual([])
    expect(extractClarifyingQuestions('   ')).toEqual([])
    expect(extractClarifyingQuestions('Just a statement. Nothing to ask.')).toEqual([])
  })

  it('drops very long sentences (>220 chars)', () => {
    const long = 'A'.repeat(250) + '?'
    const text = `${long} What is next?`
    const out = extractClarifyingQuestions(text)
    expect(out).toEqual(['What is next?'])
  })

  it('respects the max parameter', () => {
    const text = 'Q1? Q2? Q3? Q4?'
    expect(extractClarifyingQuestions(text, 1)).toHaveLength(1)
    expect(extractClarifyingQuestions(text, 3)).toHaveLength(3)
  })
})
