import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Phase 1 admin endpoint for flipping the per-user LLM provider. Used
// by the founder to switch between Anthropic and Gemini without a
// settings UI. Phase 1.5 will replace this with a real toggle.
//
// Auth: required. We reuse the cookie-scoped Supabase client so the
// user updates only their own row (RLS users_self). No CSRF guard here
// because the cookie-scoped client already enforces identity - a
// cross-origin attacker cannot obtain the user's session cookie.
export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const provider = (body as any)?.provider;
  if (provider !== 'anthropic' && provider !== 'gemini') {
    return NextResponse.json({ error: 'unknown provider' }, { status: 400 });
  }

  const { error } = await supabase
    .from('users')
    .update({ llm_provider: provider })
    .eq('id', user.id);

  if (error) {
    return NextResponse.json({ error: 'update failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, provider });
}
