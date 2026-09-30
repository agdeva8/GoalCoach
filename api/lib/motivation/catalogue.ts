/**
 * Motivation agent — built-in fallback catalogue.
 *
 * Same 12 items that previously lived inline in
 * `api/app/api/motivation/recommend/route.ts`. They are split out so
 * the orchestrator (`recommend.ts`) and the route's manual fallback
 * path share a single source of truth.
 *
 * Used in three situations:
 *   1. `MOTIVATION_AGENT_ENABLED` is false (the MVP / dev default).
 *   2. The pipeline runs but produces 0 passing candidates.
 *   3. The pipeline errors, times out, or breaches the cost cap.
 *
 * Each entry is hand-picked to fit one of three buckets — overdue,
 * dormant, stuck. The route handler picks a subset based on the user's
 * current state and frames each item with a deterministic sentence.
 */

import 'server-only'

import type { Bucket, Kind } from './schema'

/** A seed in the hand-curated catalogue. Same shape as `Candidate`. */
export interface CatalogueSeed {
  id: string
  bucket: Bucket
  kind: Kind
  title: string
  author: string
  url: string
  duration: string
  excerpt: string
}

export const CATALOGUE: CatalogueSeed[] = [
  // ----- overdue / momentum -----
  {
    id: 'atomic-habbits-recovery',
    bucket: 'overdue',
    kind: 'book',
    title: 'Atomic Habits — The 4 Laws of Behaviour Change',
    author: 'James Clear',
    url: 'https://jamesclear.com/atomic-habits',
    duration: '7 min chapter',
    excerpt:
      '\u201cYou do not rise to the level of your goals. You fall to the level of your systems.\u201d A small read for the day the streak slipped.',
  },
  {
    id: 'still-processing-aulya',
    bucket: 'overdue',
    kind: 'video',
    title: 'How to keep going when you don\u2019t feel like it',
    author: 'Aulya Kirana',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    duration: '12 min watch',
    excerpt:
      '\u201cMotivation isn\u2019t a trait. It\u2019s a practice. Here\u2019s the simplest one I know.\u201d',
  },
  {
    id: 'the-2-day-rule',
    bucket: 'overdue',
    kind: 'article',
    title: 'The 2-Day Rule (don\u2019t skip twice)',
    author: 'James Clear',
    url: 'https://jamesclear.com/how-to-stop-procrastinating',
    duration: '4 min read',
    excerpt:
      'Missing once is an accident. Missing twice is the start of a new habit.',
  },

  // ----- dormant / find the why -----
  {
    id: 'start-with-why-sinek',
    bucket: 'dormant',
    kind: 'book',
    title: 'Start with Why',
    author: 'Simon Sinek',
    url: 'https://www.startwithwhy.com/',
    duration: '30 min cheat-sheet',
    excerpt: 'Why does the goal matter to you, specifically? Anchor on the why first.',
  },
  {
    id: 'tiny-experiments-steve',
    bucket: 'dormant',
    kind: 'article',
    title: 'When you don\u2019t want to do anything \u2014 start microscopic',
    author: 'Steve Pavlina',
    url: 'https://www.stevepavlina.com/blog/2009/02/how-to-motivate-yourself/',
    duration: '6 min read',
    excerpt:
      'If you can\u2019t get out of bed to do the hour, commit to two minutes. The momentum is downstream.',
  },
  {
    id: 'kahneman-system-1',
    bucket: 'dormant',
    kind: 'talk',
    title: 'Thinking, Fast and Slow \u2014 System 1 vs System 2',
    author: 'Daniel Kahneman',
    url: 'https://www.ted.com/',
    duration: '45 min talk',
    excerpt: 'Why routine beats intensity \u2014 and why willpower is a finite reserve.',
  },

  // ----- stuck / pattern-break -----
  {
    id: 'gross-doing-better',
    bucket: 'stuck',
    kind: 'article',
    title: 'The Habit Loop \u2014 cue, routine, reward',
    author: 'Charles Duhigg',
    url: 'https://charlesduhigg.com/the-power-of-habit/',
    duration: '5 min read',
    excerpt:
      'Most habit failures are wired loops that reward the wrong thing. Rewrite the cue.',
  },
  {
    id: 'rephrased-frameworks',
    bucket: 'stuck',
    kind: 'article',
    title: 'Mountain vs. Marshmallow \u2014 reframing the boring middle',
    author: 'Scott Galloway',
    url: 'https://www.profgalloway.com/',
    duration: '8 min read',
    excerpt: 'Why the middle of a goal feels like failure \u2014 even when it isn\u2019t.',
  },
  {
    id: 'pomodoro-cirillo',
    bucket: 'stuck',
    kind: 'article',
    title: 'The Pomodoro \u2014 25 minutes is a contract with yourself',
    author: 'Francesco Cirillo',
    url: 'https://francescocirillo.com/pages/pomodoro-technique',
    duration: '3 min read',
    excerpt:
      'Time-boxed, interruption-free, twenty-five minute sessions. Start one before you finish this sentence.',
  },
]

/**
 * Deterministic frame for a fallback catalogue item. Used when the LLM
 * frame call (see `frame.ts`) is unavailable or fails.
 *
 * Kept short and warm: a one-sentence acknowledgment of the user's
 * current state plus the seed's curated excerpt.
 */
export function fallbackFrame(seed: CatalogueSeed, bucket: Bucket): string {
  const timerLabel =
    bucket === 'overdue'
      ? 'you have items past due'
      : bucket === 'dormant'
        ? 'things have been quiet for a while'
        : "you're in the hard middle"
  return `Right now, ${timerLabel}. ${seed.excerpt}`
}

/**
 * Pick up to `count` catalogue items for a bucket, randomised. Used
 * by the route handler when the agent is disabled or has failed.
 */
export function pickFromCatalogue(
  bucket: Bucket,
  count: number,
): CatalogueSeed[] {
  const pool = CATALOGUE.filter((s) => s.bucket === bucket)
  return [...pool].sort(() => Math.random() - 0.5).slice(0, count)
}
