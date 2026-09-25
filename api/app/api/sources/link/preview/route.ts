/**
 * POST /api/sources/link/preview — pre-flight metadata for the link
 * attach dialog.
 *
 * Body: { url: string }
 * Response:
 *   {
 *     ok: boolean,
 *     url: string,
 *     host: string | null,
 *     final_url: string | null,        // post any redirects
 *     title: string | null,            // <title> or og:title, fallback to URL
 *     description: string | null,      // og:description / meta description
 *     image: string | null,            // og:image (absolute)
 *     favicon: string | null,          // best-effort /favicon.ico
 *     snippet: string,                 // ~400 chars of cleaned body text
 *     content_type: string | null,
 *     status: number | null,           // HTTP status if reachable, else null
 *     error: string | null,            // human error when ok: false
 *   }
 *
 * The route does NOT persist anything; it's purely a preview pass so
 * the front-end dialog can render a card before the user commits.
 * Returns 200 even on fetch failure so the UI can render the
 * "couldn't reach this URL — save as raw link" affordance.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchLinkText } from '@/lib/sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PREVIEW_TIMEOUT_MS = 12_000
const PREVIEW_MAX_BYTES = 256 * 1024
const SNIPPET_LEN = 400

interface PreviewResult {
  ok: boolean
  url: string
  host: string | null
  final_url?: string | null
  title?: string | null
  description?: string | null
  image?: string | null
  favicon?: string | null
  snippet?: string
  content_type?: string | null
  status?: number | null
  error: string | null
}

function hostOf(u: string): string | null {
  try {
    return new URL(u).host
  } catch {
    return null
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .trim()
}

function extractMeta(html: string, name: string): string | null {
  // og: and twitter: variants
  const og = html.match(
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      'i',
    ),
  )
  if (og && og[1]) return decodeEntities(og[1])
  // Reverse order: content first, property/name second.
  const og2 = html.match(
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`,
      'i',
    ),
  )
  if (og2 && og2[1]) return decodeEntities(og2[1])
  return null
}

function extractTitle(html: string): string | null {
  const og = extractMeta(html, 'og:title') ?? extractMeta(html, 'twitter:title')
  if (og) return og
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (t && t[1]) return decodeEntities(t[1].replace(/\s+/g, ' ').trim())
  return null
}

function extractDescription(html: string): string | null {
  const og =
    extractMeta(html, 'og:description') ?? extractMeta(html, 'twitter:description')
  if (og) return og
  const m = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  )
  if (m && m[1]) return decodeEntities(m[1].replace(/\s+/g, ' ').trim())
  return null
}

function extractImage(html: string, baseUrl: string | null): string | null {
  const candidates = [
    extractMeta(html, 'og:image'),
    extractMeta(html, 'og:image:url'),
    extractMeta(html, 'twitter:image'),
    extractMeta(html, 'twitter:image:src'),
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    try {
      return new URL(c, baseUrl ?? undefined).toString()
    } catch {
      /* ignore */
    }
  }
  return null
}

function extractFavicon(html: string, baseUrl: string | null): string | null {
  const link = html.match(
    /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i,
  )
  if (link && link[1]) {
    try {
      return new URL(link[1], baseUrl ?? undefined).toString()
    } catch {
      /* ignore */
    }
  }
  if (baseUrl) {
    try {
      const u = new URL(baseUrl)
      return `${u.protocol}//${u.host}/favicon.ico`
    } catch {
      /* ignore */
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const url = String(body?.url ?? '').trim()
  if (!url) {
    return NextResponse.json(
      { ok: false, error: 'No URL provided', url: '', host: null } satisfies PreviewResult,
      { status: 400 },
    )
  }

  // Validate the URL — every preview pass has to fail loud if the user
  // pasted garbage rather than silently returning a fake success.
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: 'That doesn’t look like a valid URL.',
        url,
        host: hostOf(url),
      },
      { status: 200 },
    )
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Only http and https URLs are supported.',
        url,
        host: parsed.host,
      },
      { status: 200 },
    )
  }

  // Fetch the URL ourselves so we can extract <meta> tags the existing
  // \`fetchLinkText\` strips away. Bounded timeout + body size so a
  // hostile / large URL can't wedge the server.
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GoalCoach/1.0 (+preview)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
  } catch (e) {
    clearTimeout(tid)
    const isAbort = (e as Error)?.name === 'AbortError'
    return NextResponse.json(
      {
        ok: false,
        error: isAbort
          ? 'Took too long to respond (12s timeout).'
          : 'Could not reach this URL.',
        url,
        host: parsed.host,
        final_url: null,
        title: null,
        description: null,
        image: null,
        favicon: null,
        snippet: '',
        content_type: null,
        status: null,
      },
      { status: 200 },
    )
  }
  clearTimeout(tid)

  const status = response.status
  const contentType = response.headers.get('content-type') ?? ''
  const finalUrl = response.url || url

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 401 || status === 403
            ? 'This link is private or requires sign-in — preview not available.'
            : status === 404
              ? 'Page not found (404).'
              : status >= 500
                ? 'The site seems down — try again later.'
                : `Got HTTP ${status} from the site.`,
        url,
        host: parsed.host,
        final_url: finalUrl,
        title: null,
        description: null,
        image: null,
        favicon: null,
        snippet: '',
        content_type: contentType || null,
        status,
      },
      { status: 200 },
    )
  }

  if (!contentType.includes('text/html') && !contentType.includes('xml')) {
    // Non-HTML: don't try to extract og tags, but still return the URL.
    return NextResponse.json(
      {
        ok: true,
        url,
        host: parsed.host,
        final_url: finalUrl,
        title: finalUrl,
        description: null,
        image: null,
        favicon: extractFavicon('', finalUrl),
        snippet: '',
        content_type: contentType || null,
        status,
        error: null,
      },
      { status: 200 },
    )
  }

  // Read at most PREVIEW_MAX_BYTES so a 10MB HTML page doesn't blast
  // memory. \`getReader()\` lets us bail early once we've consumed
  // enough — meta tags appear in the head, well before the body.
  let html = ''
  try {
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('no body')
    }
    let bytes = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      chunks.push(value)
      if (bytes >= PREVIEW_MAX_BYTES) break
    }
    html = Buffer.concat(chunks).toString('utf-8')
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: 'Could not read the page body.',
        url,
        host: parsed.host,
        final_url: finalUrl,
        title: null,
        description: null,
        image: null,
        favicon: null,
        snippet: '',
        content_type: contentType || null,
        status,
      },
      { status: 200 },
    )
  }

  const title = extractTitle(html)
  const description = extractDescription(html)
  const image = extractImage(html, finalUrl)
  const favicon = extractFavicon(html, finalUrl)
  const snippetRaw = await fetchLinkText(finalUrl)
  const snippet = snippetRaw.slice(0, SNIPPET_LEN).trim()

  return NextResponse.json(
    {
      ok: true,
      url,
      host: parsed.host,
      final_url: finalUrl,
      title,
      description,
      image,
      favicon,
      snippet,
      content_type: contentType,
      status,
      error: null,
    },
    { status: 200 },
  )
}
