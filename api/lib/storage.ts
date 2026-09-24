/**
 * Storage helpers — Emergent Object Storage.
 *
 * Thin wrapper over `lib/emergent/storage.ts` that preserves the
 * pre-swap public API (`uploadFile`, `deleteFile`,
 * `getSignedDownloadUrl`, `sanitizeFilename`). The previous
 * Vercel Blob shim used the same names, so route handlers don't have
 * to change.
 *
 * Why a thin wrapper:
 *   - Keeps the call sites (`app/api/sources/upload/route.ts`,
 *     `app/api/sources/[id]/download/route.ts`) decoupled from the
 *     exact REST contract.
 *   - If/when we swap storage providers again, only this file moves.
 *
 * Source of truth: migration/discovery/03-nextjs-architecture.md
 * Section 1 (`lib/storage.ts` — Vercel Blob wrapper) + the new
 * Section 6 (Emergent-only world).
 */

import 'server-only'

import {
  deleteFile as emergentDelete,
  getSignedDownloadUrl as emergentGetSigned,
  sanitizeFilename as emergentSanitize,
  streamObjectAsResponse,
  uploadFile as emergentUpload,
} from '@/lib/emergent/storage'

/* -------------------------------------------------------------------------- */
/* Re-exports — same names as the previous Vercel Blob shim.                 */
/* -------------------------------------------------------------------------- */

export interface UploadResult {
  pathname: string
  url: string
}

export async function uploadFile(
  userId: string,
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<UploadResult> {
  const result = await emergentUpload(userId, filename, buffer, contentType)
  return {
    pathname: result.storagePath,
    // The browser can't directly GET from the Emergent proxy with the
    // storage key (the key is meant for server-side use), so we hand
    // back a relative URL the route can resolve to a signed link.
    url: `/api/sources/_/download?path=${encodeURIComponent(result.storagePath)}`,
  }
}

export async function deleteFile(storagePath: string): Promise<void> {
  return emergentDelete(storagePath)
}

export async function getSignedDownloadUrl(storagePath: string): Promise<string> {
  return emergentGetSigned(storagePath)
}

export function sanitizeFilename(fn: string): string {
  return emergentSanitize(fn)
}

/**
 * Stream an object as a `Response` body. Exposed for
 * `/api/sources/[id]/download` when the caller wants to proxy the
 * file bytes through Next.js instead of handing the browser a
 * proxy URL with the storage key in the query string.
 */
export async function streamObjectAsResponseHelper(
  storagePath: string,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
  return streamObjectAsResponse(storagePath)
}