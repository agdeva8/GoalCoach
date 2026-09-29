import { getServerSupabase } from '@/lib/supabase/server';
import { getAreas, setUserAreaPreferences, type AreaKey } from '@goalcoach/db';

export const runtime = 'edge';

// Ruling T5a: derive the allowed set from getAreas(), not a hardcoded list.
// Consistent with setUserAreaPreferences (queries.ts:248) and Task 4's
// home page server action. The global constraint: no hardcoded domain rules.
const ALLOWED = new Set<AreaKey>(getAreas().map((a) => a.key));

export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const areasRaw = (body as { areas?: unknown })?.areas;
  if (!Array.isArray(areasRaw)) {
    return new Response(JSON.stringify({ error: 'areas must be an array' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Drop any keys not in the allowed set -- defense in depth. The
  // setUserAreaPreferences helper also filters, but the route is the
  // outer gate and must not forward unknowns.
  const areaKeys = areasRaw.filter(
    (k): k is AreaKey => typeof k === 'string' && ALLOWED.has(k as AreaKey)
  );

  await setUserAreaPreferences(supabase, user.id, areaKeys);

  return new Response(JSON.stringify({ ok: true, saved: areaKeys }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
