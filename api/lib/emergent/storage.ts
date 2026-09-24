/**
 * Emergent Object Storage REST client.
 *
 * Source of truth: backend/server.py:776-807 (`init_storage`,
 * `put_object`, `get_object`).
 *
 * Wire protocol (discovered by reading `backend/server.py:776-807` +
 * the `migrate-from-mongo.ts` script that already calls the same
 * endpoints):
 *
 *   POST  {INTEGRATION_PROXY_URL}/objstore/api/v1/storage/init
 *        Body:   { "emergent_key": "<EMERGENT_LLM_KEY>" }
 *        200     { "storage_key": "<opaque-key>" }
 *
 *   PUT   {INTEGRATION_PROXY_URL}/objstore/api/v1/storage/objects/{path}
 *        Headers: X-Storage-Key: <storage_key>
 *                 Content-Type: <file mime>
 *        Body:   raw bytes
 *        200     { "storage_key": "...", "path": "...", "size": ..., ... }
 *
 *   GET   {INTEGRATION_PROXY_URL}/objstore/api/v1/storage/objects/{path}
 *        Headers: X-Storage-Key: <storage_key>
 *        200     raw bytes (Content-Type header set by the proxy)
 *
 *   DELETE  {INTEGRATION_PROXY_URL}/objstore/api/v1/storage/objects/{path}
 *        Headers: X-Storage-Key: <storage_key>
 *        200     { "ok": true, ... }
 *
 * `INTEGRATION_PROXY_URL` defaults to
 * `https://integrations.emergentagent.com`.
 *
 * The `storage_key` is cached for the lifetime of the process; if a
 * request 404s (the key was rotated server-side), we re-init and
 * retry once — matches Python's behavior in `put_object`.
 *
 * Server-only: reads `EMERGENT_LLM_KEY` and `INTEGRATION_PROXY_URL`
 * from `process.env`. Never bundle this into a client component.
 */

import 'server-only'

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_PROXY_URL = 'https://integrations.emergentagent.com'
const APP_NAMESPACE = 'goalcoach'

function resolveProxyUrl(): string {
  const fromEnv = process.env.INTEGRATION_PROXY_URL?.trim()
  return (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_PROXY_URL)
}

function resolveApiKey(): string {
  const k = process.env.EMERGENT_LLM_KEY
  if (!k || k.length === 0) {
    throw new Error(
      'EMERGENT_LLM_KEY is not set. Required for Emergent Object Storage.',
    )
  }
  return k
}

/* -------------------------------------------------------------------------- */
/* Storage key cache                                                          */
/*                                                                             */
/// Mirrors backend/server.py:780-790 `_storage_key` cache. We re-init on a   */
/* 404 (key was rotated server-side) and on the first call per process.     */
/* -------------------------------------------------------------------------- */

let _storageKey: string | null = null
let _storageKeyPromise: Promise<string> | null = null

async function initStorageKey(force = false): Promise<string> {
  if (!force && _storageKey) return _storageKey
  if (!force && _storageKeyPromise) return _storageKeyPromise

  const url = `${resolveProxyUrl().replace(/\/$/, '')}/objstore/api/v1/storage/init`
  const apiKey = resolveApiKey()

  const promise = (async () => {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emergent_key: apiKey }),
      // 30s ceiling matches Python `requests.post(..., timeout=30)`.
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    })
    if (!resp.ok) {
      let detail = ''
      try {
        detail = await resp.text()
      } catch {
        /* ignore */
      }
      throw new Error(
        `Emergent storage init failed: ${resp.status} ${detail.slice(0, 300)}`,
      )
    }
    const json = (await resp.json()) as { storage_key?: string }
    if (!json.storage_key) {
      throw new Error('Emergent storage init returned no storage_key')
    }
    _storageKey = json.storage_key
    _storageKeyPromise = null
    return json.storage_key
  })()

  _storageKeyPromise = promise
  return promise
}

/* -------------------------------------------------------------------------- */
/* Path helpers                                                                */
/*                                                                             */
/* Storage paths are scoped under `goalcoach/uploads/<user_id>/<sanitized>…` */
/* so cleanup / policy can target a user subtree without scanning the whole  */
/* bucket.                                                                    */
/* -------------------------------------------------------------------------- */

const BASE_PREFIX = `${APP_NAMESPACE}/uploads`

/**
 * Sanitize a filename for use as a storage path component. Mirrors
 * the Python `sanitize_filename` in `backend/server.py` and the
 * previous Vercel Blob shim. Strips shell-unsafe characters; caps
 * length at 200.
 */
export function sanitizeFilename(fn: string): string {
  const cleaned = String(fn)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 200)
  return cleaned || 'file'
}

/** Build the full storage path for a user upload. */
export function buildStoragePath(userId: string, filename: string): string {
  const safe = sanitizeFilename(filename)
  // Suffix is added by the storage proxy in its upload_url response.
  return `${BASE_PREFIX}/${userId}/${safe}`
}

/* -------------------------------------------------------------------------- */
/* uploadFile                                                                 */
/*                                                                             */
/* Returns the storage path the row should persist in `sources.storage_path` */
/* and the storage_key the row should persist in `sources.storage_key` (if  */
/* you choose to add that column — currently the row just stores path).     */
/* -------------------------------------------------------------------------- */

export interface UploadResult {
  /** Storage path (without the proxy host) — what the row should remember. */
  storagePath: string
  /** Storage key returned by /init — needed for direct GETs/DELs. */
  storageKey: string
  /** Size in bytes echoed back by the proxy (may be undefined). */
  size?: number
}

/**
 * Upload a file buffer to Emergent Object Storage.
 *
 * @param userId   — used to scope the storage path (`goalcoach/uploads/<userId>/<sanitized>`).
 * @param filename — original filename; sanitized for the path.
 * @param buffer   — file bytes.
 * @param contentType — MIME type (e.g. `application/pdf`).
 */
export async function uploadFile(
  userId: string,
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<UploadResult> {
  const storageKey = await initStorageKey()
  const path = buildStoragePath(userId, filename)
  const url = `${resolveProxyUrl().replace(/\/$/, '')}/objstore/api/v1/storage/objects/${path}`

  const doPut = async (key: string) => {
    return fetch(url, {
      method: 'PUT',
      headers: {
        'X-Storage-Key': key,
        'Content-Type': contentType || 'application/octet-stream',
      },
      // `fetch` BodyInit accepts Uint8Array at runtime; cast through
      // BodyInit to work around a Node 20 TypeScript lib mismatch that
      // narrows the parameter type to URLSearchParams | ReadableStream
      // | etc., neither of which Buffer / Uint8Array satisfy.
      body: new Uint8Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength,
      ) as unknown as BodyInit,
      signal: AbortSignal.timeout(120_000),
      cache: 'no-store',
    })
  }

  let resp = await doPut(storageKey)

  // 404 → key was rotated server-side; re-init and retry once.
  // Matches Python server.py:797.
  if (resp.status === 404) {
    const fresh = await initStorageKey(true)
    resp = await doPut(fresh)
  }

  if (!resp.ok) {
    let detail = ''
    try {
      detail = await resp.text()
    } catch {
      /* ignore */
    }
    throw new Error(
      `Emergent storage PUT ${path} failed: ${resp.status} ${detail.slice(0, 300)}`,
    )
  }

  // The proxy returns metadata JSON; we don't need to parse it for
  // the storage path (we already know it). Best-effort parse for size.
  let size: number | undefined
  try {
    const json = (await resp.clone().json()) as { size?: number }
    size = typeof json.size === 'number' ? json.size : undefined
  } catch {
    /* response body may not be JSON; ignore */
  }

  return {
    storagePath: path,
    storageKey,
    size,
  }
}

/* -------------------------------------------------------------------------- */
/* deleteFile                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Delete a file from Emergent Object Storage.
 *
 * No-op if the path is empty (the source was a link or never persisted).
 */
export async function deleteFile(storagePath: string): Promise<void> {
  if (!storagePath) return
  const storageKey = await initStorageKey()
  const url = `${resolveProxyUrl().replace(/\/$/, '')}/objstore/api/v1/storage/objects/${storagePath}`

  const doDelete = async (key: string) =>
    fetch(url, {
      method: 'DELETE',
      headers: { 'X-Storage-Key': key },
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    })

  let resp = await doDelete(storageKey)
  if (resp.status === 404) {
    const fresh = await initStorageKey(true)
    resp = await doDelete(fresh)
  }

  // 404 on DELETE is fine — file already gone. Anything else is a real
  // error worth surfacing.
  if (!resp.ok && resp.status !== 404) {
    let detail = ''
    try {
      detail = await resp.text()
    } catch {
      /* ignore */
    }
    throw new Error(
      `Emergent storage DELETE ${storagePath} failed: ${resp.status} ${detail.slice(0, 300)}`,
    )
  }
}

/* -------------------------------------------------------------------------- */
/// downloadFile + getSignedDownloadUrl                                          */
/*                                                                             */
/* The frontend's `/api/sources/[id]/download` route hands the browser a URL */
/* it can `fetch()` directly. Emergent doesn't expose signed/temporary URLs  */
/* like Vercel Blob, so we route the download through our own endpoint. The  */
/* route handler re-uses this client to read the file bytes server-side and  */
/* forward them, OR — preferred — the client follows a redirect to a small   */
/* Node handler that streams the bytes back. For now `getSignedDownloadUrl`  */
/* returns the proxy URL with the storage key attached; the route returns    */
/* that URL to the browser (the storage key grants GET access).              */
/* -------------------------------------------------------------------------- */

/**
 * Download a file from Emergent Object Storage.
 *
 * Returns the raw bytes plus the content type. The route handler at
 * `/api/sources/[id]/download` uses this to stream the file back to
 * the browser.
 */
export async function downloadFile(
  storagePath: string,
): Promise<{ data: Buffer; contentType: string }> {
  if (!storagePath) {
    throw new Error('downloadFile: storagePath is required')
  }
  const storageKey = await initStorageKey()
  const url = `${resolveProxyUrl().replace(/\/$/, '')}/objstore/api/v1/storage/objects/${storagePath}`

  const doGet = async (key: string) =>
    fetch(url, {
      method: 'GET',
      headers: { 'X-Storage-Key': key },
      signal: AbortSignal.timeout(60_000),
      cache: 'no-store',
    })

  let resp = await doGet(storageKey)
  if (resp.status === 404) {
    const fresh = await initStorageKey(true)
    resp = await doGet(fresh)
  }

  if (!resp.ok) {
    let detail = ''
    try {
      detail = await resp.text()
    } catch {
      /* ignore */
    }
    throw new Error(
      `Emergent storage GET ${storagePath} failed: ${resp.status} ${detail.slice(0, 300)}`,
    )
  }

  const ab = await resp.arrayBuffer()
  return {
    data: Buffer.from(ab),
    contentType: resp.headers.get('content-type') ?? 'application/octet-stream',
  }
}

/**
 * Return a URL the browser can `fetch()` directly to download the file.
 *
 * Emergent's storage proxy doesn't issue signed/temporary URLs the way
 * Vercel Blob does, so we route the download through our own route
 * handler `/api/sources/[id]/download`. The handler verifies the user
 * owns the source, then streams the file bytes back via this client.
 *
 * To keep the legacy API surface stable, this function returns a
 * relative URL the browser can `fetch()` — the route handler decides
 * whether to proxy the bytes or return the proxy URL with the key.
 */
export async function getSignedDownloadUrl(
  storagePath: string,
): Promise<string> {
  if (!storagePath) {
    throw new Error('getSignedDownloadUrl: storagePath is required')
  }
  // Return the proxy URL directly with the storage key. The route
  // handler is responsible for converting that into a relative URL
  // the browser can hit, but keeping the proxy host explicit means
  // a future move to signed/temporary URLs is a one-line change.
  const key = await initStorageKey()
  const base = resolveProxyUrl().replace(/\/$/, '')
  return `${base}/objstore/api/v1/storage/objects/${storagePath}?storage_key=${encodeURIComponent(key)}`
}

/**
 * Proxy a download request — used by `/api/sources/[id]/download` to
 * stream a file back through Next.js without exposing the storage
 * key to the browser. The handler calls this and writes the result
 * onto its `Response`.
 */
export async function streamObjectAsResponse(
  storagePath: string,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
  if (!storagePath) {
    throw new Error('streamObjectAsResponse: storagePath is required')
  }
  const key = await initStorageKey()
  const base = resolveProxyUrl().replace(/\/$/, '')
  const url = `${base}/objstore/api/v1/storage/objects/${storagePath}`

  const doFetch = async (k: string) =>
    fetch(url, {
      method: 'GET',
      headers: { 'X-Storage-Key': k },
      signal: AbortSignal.timeout(60_000),
      cache: 'no-store',
    })

  let resp = await doFetch(key)
  if (resp.status === 404) {
    const fresh = await initStorageKey(true)
    resp = await doFetch(fresh)
  }
  if (!resp.ok || !resp.body) {
    let detail = ''
    try {
      detail = await resp.text()
    } catch {
      /* ignore */
    }
    throw new Error(
      `Emergent storage GET ${storagePath} failed: ${resp.status} ${detail.slice(0, 300)}`,
    )
  }
  return {
    body: resp.body,
    contentType: resp.headers.get('content-type') ?? 'application/octet-stream',
  }
}