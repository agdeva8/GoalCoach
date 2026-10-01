/**
 * GET /api/preferences/models — list the LLM providers the user can switch
 * to in the model switcher dropdown.
 *
 * Single source of truth: `MODEL_REGISTRY` in `lib/emergent/llm.ts`. We
 * expose just `{ id, label, hint, model }` for each entry — no creds, no
 * internal flags. Open to all callers (it's just metadata).
 *
 * The Header on the frontend used to hardcode its own PROVIDERS array
 * which drifted from the registry (label said "Sonnet 4.6" while the
 * registry says "Sonnet 4.5"). Header now fetches this endpoint on
 * mount; both sides read the same registry entry.
 */

import { NextResponse } from 'next/server'
import { MODEL_OPTIONS } from '@/lib/emergent/llm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ models: MODEL_OPTIONS })
}