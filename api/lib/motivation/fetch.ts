/**
 * Motivation agent — URL fetcher + public-content filter + normalizer.
 *
 * Takes raw Tavily results, fetches each URL with a 3s per-URL timeout,
 * parses HTML with cheerio for metadata, and normalizes into
 * `Candidate` rows. Drops paywalled, auth-walled, or empty results
 * before they reach the critique stage.
 *
 * Stage timeout: STAGE_TIMEOUTS.fetch (6s) — total budget across all
 * URLs. We race the whole batch against this deadline.
 *
 * Failure modes (per URL):
 *   - 401/402/403   → drop (auth/paywall)
 *   - 4xx/5xx       → drop (broken)
 *   - redirect loop → drop
 *   - body < 300 chars → drop (likely error page or stub)
 *   - paywall keywords in body ("subscribe to continue", "sign in to read")
 *                    → drop
 *
 * Kind inference (URL heuristics — good enough for MVP):
 *   youtube.com / youtu.be / vimeo.com  → 'video'
 *   ted.com/talks                       → 'talk'
 *   amazon / goodreads (book pages)     → 'book'
 *   everything else                     → 'article'
 *
 * Author extraction:
 *   - og:article:author meta tag
 *   - twitter:creator meta tag
 *   - <meta name="author">
 *   - byline parsed from JSON-LD (article schema)
 *
 * Duration:
 *   - article: ceil(word_count / 200) "min read"
 *   - video/talk/book: kind label (precise duration needs page-specific scraping)
 *
 * Id:
 *   - sha256(url) sliced to 16 hex chars — stable, collision-safe for our scale
 */

import 'server-only'

import { load, type CheerioAPI } from 'cheerio'
import { createHash } from 'node:crypto'

import {
  MAX_CANDIDATES_FETCHED,
  STAGE_TIMEOUTS,
} from './config'
import {
  type Bucket,
  CandidateSchema,
  type Candidate,
  type Kind,
} from './schema'
import type { TavilyRawResult } from './search'

/* -------------------------------------------------------------------------- */
/* Paywall detection                                                          */
/* -------------------------------------------------------------------------- */

const PAYWALL_PHRASES = [
  'subscribe to continue',
  'subscribe to read',
  'sign in to read',
  'sign in to continue',
  'this article is for subscribers',
  'this story is for subscribers',
  'for paid subscribers',
  'members-only content',
  'to continue reading, subscribe',
]

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Fetch and normalize a batch of Tavily results.
 *
 * Returns up to MAX_CANDIDATES_FETCHED normalized Candidates. Order
 * matches Tavily's score (descending) so the critique stage sees the
 * highest-relevance items first.
 */
export async function fetchCandidates(args: {
  results: TavilyRawResult[]
  bucket: Bucket
  signal?: AbortSignal
}): Promise<Candidate[]> {
  const { results, bucket, signal } = args
  if (results.length === 0) return []

  const deadline = makeDeadline(STAGE_TIMEOUTS.fetch, signal)
  try {
    const settled = await Promise.allSettled(
      results
        .slice(0, MAX_CANDIDATES_FETCHED)
        .map((r) => fetchOne(r, bucket, deadline.signal)),
    )

    const out: Candidate[] = []
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        out.push(r.value)
      }
    }
    return out
  } finally {
    deadline.cancel()
  }
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

async function fetchOne(
  raw: TavilyRawResult,
  bucket: Bucket,
  signal: AbortSignal,
): Promise<Candidate | null> {
  const url = raw.url
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal,
      headers: {
        // Some sites gate on User-Agent. A real browser UA improves success.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      cache: 'no-store',
    })
  } catch {
    // Network error / timeout / abort — drop quietly.
    return null
  }

  // Hard gates — auth / payment / not found / server error.
  if (resp.status === 401 || resp.status === 402 || resp.status === 403) {
    return null
  }
  if (!resp.ok) {
    return null
  }

  // Cheap content-type check — skip non-HTML (PDFs, images, JSON APIs).
  const ctype = resp.headers.get('content-type') ?? ''
  if (!ctype.includes('text/html') && !ctype.includes('application/xhtml')) {
    return null
  }

  const html = await resp.text()
  if (html.length < 300) {
    return null
  }

  // Soft paywall detection — substring scan on the lowercased HTML.
  const lc = html.toLowerCase()
  for (const phrase of PAYWALL_PHRASES) {
    if (lc.includes(phrase)) return null
  }

  const $ = load(html)

  const title =
    pickMeta($, ['og:title', 'twitter:title']) ||
    $('title').first().text().trim() ||
    raw.title ||
    ''

  const excerpt =
    pickMeta($, ['og:description', 'twitter:description', 'description']) ||
    extractFirstParagraph($) ||
    raw.content ||
    ''

  const author = extractAuthor($, html)

  const kind = inferKind(url, $)

  const duration = estimateDuration(kind, $)

  const candidate = {
    id: hashUrl(url),
    bucket,
    kind,
    title: cleanText(title),
    author: cleanText(author) || 'Unknown',
    url,
    duration,
    excerpt: cleanText(excerpt).slice(0, 500),
    sourceMeta: {
      tavily_score: raw.score,
      domain: safeDomain(url),
    },
  }

  // Validate — defensive against cheerio / HTML edge cases.
  const parsed = CandidateSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/* -------------------------------------------------------------------------- */
/* Metadata extraction helpers                                                */
/* -------------------------------------------------------------------------- */

function pickMeta($: CheerioAPI, keys: string[]): string {
  for (const key of keys) {
    const v = $(`meta[property="${key}"]`).attr('content')
    if (v && v.trim().length > 0) return v.trim()
    const v2 = $(`meta[name="${key}"]`).attr('content')
    if (v2 && v2.trim().length > 0) return v2.trim()
  }
  return ''
}

function extractFirstParagraph($: CheerioAPI): string {
  // Prefer <article> > <main> > body — most relevant prose first.
  const article = $('article').first()
  if (article.length) return article.find('p').first().text().trim()
  const main = $('main').first()
  if (main.length) return main.find('p').first().text().trim()
  return $('p').first().text().trim()
}

function extractAuthor($: CheerioAPI, html: string): string {
  // 1. Explicit meta tags (highest signal).
  const meta = pickMeta($, [
    'article:author',
    'og:article:author',
    'author',
    'twitter:creator',
    'byl',
  ])
  if (meta) return meta

  // 2. JSON-LD article schema — most reliable when present.
  const ldAuthor = extractJsonLdAuthor($)
  if (ldAuthor) return ldAuthor

  // 3. Byline microdata.
  const byline = $('[itemprop="author"]').first().text().trim()
  if (byline) return byline

  // 4. Cheap regex on raw HTML — "By Jane Doe" pattern, common in Medium et al.
  const m = html.match(/[Bb]y\s+([A-Z][a-zA-Z'-]{1,40}(?:\s+[A-Z][a-zA-Z'-]{1,40}){0,3})/)
  return m ? m[1] : ''
}

function extractJsonLdAuthor($: CheerioAPI): string {
  let out = ''
  $('script[type="application/ld+json"]').each((_, el) => {
    if (out) return
    try {
      const data = JSON.parse($(el).text())
      const nodes = Array.isArray(data) ? data : [data]
      for (const node of nodes) {
        const author = node?.author
        if (typeof author === 'string') {
          out = author
          break
        }
        if (Array.isArray(author) && typeof author[0] === 'string') {
          out = author[0]
          break
        }
        if (author && typeof author === 'object' && typeof author.name === 'string') {
          out = author.name
          break
        }
        // @graph shape
        if (Array.isArray(node?.['@graph'])) {
          for (const g of node['@graph']) {
            if (typeof g?.author === 'string') { out = g.author; break }
            if (g?.author && typeof g.author.name === 'string') { out = g.author.name; break }
          }
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  })
  return out
}

/* -------------------------------------------------------------------------- */
/* Kind inference                                                             */
/* -------------------------------------------------------------------------- */

function inferKind(url: string, $: CheerioAPI): Kind {
  const host = safeDomain(url).toLowerCase()
  // Video hosts
  if (
    host.endsWith('youtube.com') ||
    host.endsWith('youtu.be') ||
    host.endsWith('vimeo.com')
  ) {
    return 'video'
  }
  // Talks
  if (host.endsWith('ted.com')) return 'talk'
  // Books
  if (host.includes('amazon.') && /\/dp\/|\/gp\/product\//.test(url)) return 'book'
  if (host.endsWith('goodreads.com')) return 'book'
  // og:type meta tag is a strong signal too
  const ogType = pickMeta($, ['og:type']).toLowerCase()
  if (ogType === 'video.other' || ogType === 'video.movie') return 'video'
  if (ogType === 'book') return 'book'
  return 'article'
}

/* -------------------------------------------------------------------------- */
/* Duration estimate                                                          */
/* -------------------------------------------------------------------------- */

function estimateDuration(kind: Kind, $: CheerioAPI): string {
  if (kind === 'video') return 'video'
  if (kind === 'talk') return 'talk'
  if (kind === 'book') return 'book'

  // Article: prefer the publisher's read-time meta, fall back to
  // word-count / 200wpm.
  const meta = pickMeta($, ['twitter:label1', 'article:reading_time'])
  if (meta) return `${meta} read`

  const text = $('article, main').text() || $('body').text()
  const words = text.split(/\s+/).filter(Boolean).length
  const minutes = Math.max(1, Math.round(words / 200))
  return `${minutes} min read`
}

/* -------------------------------------------------------------------------- */
/* Misc helpers                                                               */
/* -------------------------------------------------------------------------- */

function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16)
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function makeDeadline(
  ms: number,
  parent?: AbortSignal,
): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  const onParent = () => ctrl.abort()
  parent?.addEventListener('abort', onParent, { once: true })
  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onParent)
      ctrl.abort()
    },
  }
}
