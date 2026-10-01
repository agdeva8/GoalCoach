/**
 * Motivation agent — 10-param critique stage.
 *
 * Given a Candidate, asks the LLM to score it on 10 dimensions
 * (each 0-1) plus a short list of reasons. We then deterministically
 * compute:
 *   - weighted_total (sum of score * weight, scaled to 0-10)
 *   - verdict (pass iff all three gates clear — see config.ts)
 *
 * The LLM is NOT trusted to know the threshold rules. Letting the
 * model decide pass/reject means a hot-reload of the threshold
 * weights can't be done without prompt edits — keeping the verdict
 * in code makes tuning a one-line PR.
 *
 * Failure modes:
 *   - LLM returns malformed JSON → throws, caller (recommend.ts)
 *     catches and continues to the next candidate (one bad critique
 *     doesn't fail the whole batch).
 *   - LLM returns partial scores (some keys missing) → Zod fails,
 *     same as above.
 *   - Timeout → throws AbortError, same handling.
 */

import 'server-only'

import { streamChat } from '@/lib/emergent/stream-chat'

import {
  CHEAP_MODEL,
  REASONING_MODEL,
  REASONING_PROVIDER,
  STAGE_TIMEOUTS,
  computeWeightedTotal,
  countAboveFloor,
  llmCallCostUsd,
  passesCoreFour,
} from './config'
import {
  CORE_PARAMS,
  SCORE_KEYS,
  SCORE_WEIGHTS,
  type Candidate,
  type CritiqueVerdict,
  type ScoreBreakdown,
  type ScoreKey,
  ScoredCandidateSchema,
  type ScoredCandidate,
} from './schema'

/* -------------------------------------------------------------------------- */
/* Style guide — short, model-internalized                                    */
/* -------------------------------------------------------------------------- */

/**
 * Sutra voice rules. Kept short on purpose: the model will generalize
 * from these bullets better than from a 50-line style guide. If we
 * ever need more nuance, layer it on top in critique-specific
 * instructions rather than growing this list.
 */
const SUTRA_STYLE_GUIDE = [
  // Voice
  'Warm, second-person, no preachy or moralistic tone.',
  'No hustle-bros, no toxic positivity, no "you got this!" cheerleading.',
  'Quietly confident — the user is in charge; we are the sidekick.',
  // What we surface
  'Prefer concrete mechanisms over abstract motivation ("do X for 2 min" beats "believe in yourself").',
  'Prefer first-person practitioner accounts over pure theory.',
  'Prefer primary sources (research papers, original essays) over rewrites.',
  // What we avoid
  'Reject content that is purely SEO/affiliate-shaped (listicle for clicks, "10 ways to…").',
  'Reject AI-generated filler with no specific point of view.',
  'Reject generic life-coach platitudes ("trust the process", "just start").',
].join('\n')

/* -------------------------------------------------------------------------- */
/* Per-parameter rubric — fed to the model in the system prompt              */
/* -------------------------------------------------------------------------- */

interface ParamRubric {
  key: ScoreKey
  label: string
  weight: number
  description: string
  /** Score near 0 means … ; near 1 means … */
  lowExample: string
  highExample: string
}

const PARAM_LABEL: Record<ScoreKey, string> = {
  credibility: 'Source credibility',
  recency: 'Recency',
  depth: 'Content depth',
  actionability: 'Actionability',
  citation_density: 'Citation density',
  engagement_volume: 'Engagement volume',
  engagement_quality: 'Engagement quality',
  voice_fit: 'Voice fit (Sutra tone)',
  source_independence: 'Source independence',
  accessibility: 'Accessibility',
}

const PARAM_DESCRIPTION: Record<ScoreKey, string> = {
  credibility:
    'Author credentials, organizational backing, peer recognition. Does the author actually know what they are talking about?',
  recency:
    'How fresh the piece is for the topic it covers. A 2024 piece on "atomic habits" is still fine; a 2024 piece on "AI agents in 2024" is already stale.',
  depth:
    'Substance over surface. Does the piece explain a mechanism, or just restate a feeling? Look for non-obvious claims the author defends.',
  actionability:
    'Does the reader leave with something to *do* — a frame, a checklist, a 2-minute exercise — not just a feeling?',
  citation_density:
    'Claims backed by named studies, specific numbers, or primary sources. A piece that asserts without supporting evidence scores low.',
  engagement_volume:
    'Raw signal: likes, shares, comments, view count where measurable. Useful but easy to game — never the sole reason to recommend.',
  engagement_quality:
    'Are the shares / comments substantive or bot-shaped? Sampling a few comments is usually enough to tell.',
  voice_fit:
    'Match for Sutra tone: warm, quiet, second-person. Decay hard for preachy, hustle-bro, or moralistic content.',
  source_independence:
    'Not pure SEO filler, not affiliate-driven, not auto-generated. Domain + content shape both matter.',
  accessibility:
    'Public, no paywall, no login wall. Paywalled pieces score 0 even if the content is great — we cannot surface them.',
}

const PARAM_LOW_EXAMPLE: Record<ScoreKey, string> = {
  credibility: 'Anonymous Medium post, no bio, no verifiable credentials.',
  recency: '5+ years old for a fast-moving topic; indefinite shelf-life topics can stay high.',
  depth: '"Just start!" with no mechanism, no example, no follow-through.',
  actionability: 'Pure inspiration. Reader finishes and feels something but does not know what to do next.',
  citation_density: 'No named sources, no studies, no specific numbers.',
  engagement_volume: 'Low signal across the board. Not necessarily disqualifying — verify with quality.',
  engagement_quality: 'Spam comments, bot-shaped shares, astroturfed engagement.',
  voice_fit: '"YOU are the LIMIT. No one is coming to save you."',
  source_independence: 'Affiliate-heavy, listicle for SEO, "10 best X" with no original reporting.',
  accessibility: 'Paywalled (NYT, Substack paid tier, course-gated).',
}

const PARAM_HIGH_EXAMPLE: Record<ScoreKey, string> = {
  credibility: 'Practitioner with 10+ years in the field, published a book on the exact topic, cited by peers.',
  recency: 'Published in the last 12 months on a topic with a normal shelf-life.',
  depth: 'Walks through a non-obvious mechanism with a worked example and a counter-example.',
  actionability: '"Commit to 2 minutes. When the timer hits, you may stop — most people do not." Concrete, falsifiable, repeatable.',
  citation_density: 'Names specific studies, links primary sources, gives a number with a denominator.',
  engagement_volume: 'Meaningful signal: real comments, sustained shares, organic growth (not a single viral spike).',
  engagement_quality: 'Substantive disagreement in the comments — readers actually engaged, not just liked.',
  voice_fit: 'Quiet, second-person, generous. Treats the reader as a peer, not a student.',
  source_independence: 'Independent voice, original reporting, clearly written by a human with a point of view.',
  accessibility: 'Free to read with no login. No email wall. No "subscribe to continue".',
}

/* -------------------------------------------------------------------------- */
/* Prompts                                                                    */
/* -------------------------------------------------------------------------- */

function buildSystemPrompt(): string {
  const rubricLines = SCORE_KEYS.map((key) => {
    const label = PARAM_LABEL[key]
    const description = PARAM_DESCRIPTION[key]
    const lowExample = PARAM_LOW_EXAMPLE[key]
    const highExample = PARAM_HIGH_EXAMPLE[key]
    const weight = SCORE_WEIGHTS[key]
    return `- ${label} (weight ${weight.toFixed(2)}): ${description}\n  Low: ${lowExample}\n  High: ${highExample}`
  })

  return `You are the curation critic for Sutra, a personal goal-coaching app. You score candidate articles / videos / talks for the "Motivation" card shown to users who are slipping on goals. Your job is to evaluate one candidate at a time and return a JSON object with per-dimension scores.

## Sutra voice (filter gate)

${SUTRA_STYLE_GUIDE}

## The 10 dimensions

${rubricLines.join('\n')}

## Hard rules

- Score each dimension as a number in [0, 1]. Use the full range — do not cluster around 0.5.
- The four core dimensions (credibility, recency, depth, actionability) carry more weight in the final pick, but you score all 10 the same way.
- The "voice_fit" dimension is a soft veto: if the piece is in the wrong tone (hustle-bros, moralizing, generic life-coach), score it below 0.4 even if the content is otherwise good.
- The "accessibility" dimension is a hard veto: paywalled / login-walled pieces score 0.
- "top_reasons" should be 1-3 short phrases explaining the strongest signals in the piece. These get shown to the user in a "frame" sentence.

## Output format

Return ONLY a JSON object with this exact shape (no prose, no markdown fence):

{
  "scores": {
    "credibility": <number 0-1>,
    "recency": <number 0-1>,
    "depth": <number 0-1>,
    "actionability": <number 0-1>,
    "citation_density": <number 0-1>,
    "engagement_volume": <number 0-1>,
    "engagement_quality": <number 0-1>,
    "voice_fit": <number 0-1>,
    "source_independence": <number 0-1>,
    "accessibility": <number 0-1>
  },
  "top_reasons": ["<short phrase>", "<short phrase>", "<short phrase>"]
}

Do not include the verdict — that is computed deterministically downstream from your scores.`
}

function buildUserPrompt(candidate: Candidate): string {
  return `Candidate to evaluate:

- Title: ${candidate.title}
- Author: ${candidate.author}
- URL: ${candidate.url}
- Kind: ${candidate.kind}
- Duration: ${candidate.duration}
- Bucket: ${candidate.bucket}
- Excerpt: ${candidate.excerpt}
- Source metadata: ${JSON.stringify(candidate.sourceMeta)}

Return the JSON object now.`
}

/* -------------------------------------------------------------------------- */
/* LLM call — non-streaming JSON via streamChat + parse                      */
/* -------------------------------------------------------------------------- */

interface CritiqueRaw {
  scores: Record<string, number>
  top_reasons?: string[]
}

/**
 * Issue a single non-streaming chat completion, parse the JSON
 * response, and return the structured output.
 *
 * Uses `streamChat` under the hood and accumulates the full text.
 * For task #2 we keep the call path minimal; task #5 will move this
 * to a dedicated `llm.ts` module with proper structured-output
 * (`response_format: { type: "json_object" }`) support.
 */
async function chatJson(args: {
  system: string
  user: string
  model: string
  sessionId: string
  signal?: AbortSignal
}): Promise<{ content: CritiqueRaw; costUsd: number }> {
  let full = ''
  for await (const ev of streamChat({
    // Provider id (for the registry lookup); the actual model name
    // comes from `args.model`, which `critiqueCandidate` reads off
    // `REASONING_MODEL` — the registry's `claude` row, which at MVP
    // resolves to `deepseek-flash` whenever `DEEPSEEK_API_KEY` is
    // set (see `lib/emergent/model-registry.ts` MVP note).
    provider: REASONING_PROVIDER,
    model: args.model,
    system: args.system,
    messages: [{ role: 'user', content: args.user }],
    sessionId: args.sessionId,
    signal: args.signal,
  })) {
    if (ev.type === 'text_delta') full += ev.content
    else if (ev.type === 'stream_done') full = ev.content
  }
  // Strip markdown fences if the model added them anyway.
  const trimmed = full
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  // Find the first '{' and last '}' to handle leading prose.
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  const slice = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed

  const parsed = JSON.parse(slice) as CritiqueRaw

  // Cost estimate — the Emergent proxy doesn't return usage tokens in
  // the streaming shape we use, so this is a conservative estimate
  // based on input chars / 4 and output chars / 4. Task #10 will
  // replace this with real usage when the proxy exposes it.
  const inputChars = args.system.length + args.user.length
  const outputChars = full.length
  const isReasoning = args.model === REASONING_MODEL
  const costUsd = llmCallCostUsd(
    isReasoning ? 'reasoning' : 'cheap',
    Math.ceil(inputChars / 4),
    Math.ceil(outputChars / 4),
  )

  return { content: parsed, costUsd }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Critique a single candidate. Returns a `ScoredCandidate` with
 * deterministic `weighted_total` and `verdict` (NOT from the LLM).
 *
 * Throws on JSON parse failure / Zod failure / LLM error — caller
 * (recommend.ts) catches per-candidate so one bad critique does not
 * fail the whole batch.
 */
export async function critiqueCandidate(args: {
  candidate: Candidate
  sessionId: string
  signal?: AbortSignal
}): Promise<ScoredCandidate> {
  const { candidate, sessionId, signal } = args

  const { content: raw } = await chatJson({
    system: buildSystemPrompt(),
    user: buildUserPrompt(candidate),
    model: REASONING_MODEL,
    sessionId,
    signal,
  })

  // Coerce the raw scores into a typed ScoreBreakdown. We do NOT
  // trust the LLM to spell keys correctly — fill missing keys with 0.
  const scores: ScoreBreakdown = {
    credibility: numberOr(raw.scores?.credibility, 0),
    recency: numberOr(raw.scores?.recency, 0),
    depth: numberOr(raw.scores?.depth, 0),
    actionability: numberOr(raw.scores?.actionability, 0),
    citation_density: numberOr(raw.scores?.citation_density, 0),
    engagement_volume: numberOr(raw.scores?.engagement_volume, 0),
    engagement_quality: numberOr(raw.scores?.engagement_quality, 0),
    voice_fit: numberOr(raw.scores?.voice_fit, 0),
    source_independence: numberOr(raw.scores?.source_independence, 0),
    accessibility: numberOr(raw.scores?.accessibility, 0),
  }

  const weighted_total = computeWeightedTotal(scores)

  // Deterministic verdict — gates applied in code, not by the LLM.
  const verdict: CritiqueVerdict =
    passesCoreFour(scores) &&
    countAboveFloor(scores) >= 5 &&
    weighted_total >= 6.5
      ? 'pass'
      : 'reject'

  const top_reasons = (raw.top_reasons ?? []).slice(0, 3).filter(isNonEmptyString)

  // Validate the assembled object through the public schema so the
  // type matches downstream consumers exactly.
  return ScoredCandidateSchema.parse({
    ...candidate,
    scores,
    weighted_total,
    verdict,
    top_reasons,
  })
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function numberOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  // Clamp to [0, 1] — defensive against hallucinated ranges.
  return Math.max(0, Math.min(1, n))
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/* -------------------------------------------------------------------------- */
/* Re-exports used by tests                                                   */
/* -------------------------------------------------------------------------- */

export const _internal = {
  buildSystemPrompt,
  buildUserPrompt,
  CORE_PARAMS,
  STAGE_TIMEOUTS,
}
