import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Accepts only same-origin relative paths. Absolute URLs (https://evil/...)
// and protocol-relative URLs (//evil/...) are open-redirect risks and
// collapse back to '/'. The /api/auth/google route validates returnTo
// before encoding it into the callback URL; we re-validate here in case
// anyone ever crafts a callback URL directly.
function sanitizeReturnTo(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

// OAuth callback handler. Exchanges the authorization code for a
// session, then persists Gemini-specific provider tokens (when present)
// onto the app's `users` row. Tokens are server-only - the UI never
// reads the `users` table directly.
//
// On success, redirects to the `returnTo` query param if it was passed
// through the OAuth round-trip (e.g. /chat?horizon=week). Falls back
// to `/` when absent or unsafe.
//
// Magic-link flows arrive here too (no `code`, no provider tokens);
// in that case we still honor `returnTo` so the deep-link survives.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));

  if (code) {
    const supabase = await getServerSupabase();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL(returnTo, request.url));
    }
    const session = data?.session;
    const providerToken = session?.provider_token;
    const providerRefreshToken = session?.provider_refresh_token;
    const expiresAt = session?.expires_at;
    const userId = session?.user?.id;

    if (userId && (providerToken || providerRefreshToken)) {
      const patch: Record<string, unknown> = {};
      if (providerToken) patch.gemini_access_token = providerToken;
      if (providerRefreshToken) patch.gemini_refresh_token = providerRefreshToken;
      if (expiresAt) {
        patch.gemini_token_expiry = new Date(expiresAt * 1000).toISOString();
      }
      // RLS lets the just-authenticated user update their own row.
      await supabase.from('users').update(patch).eq('id', userId);
    }
  }

  return NextResponse.redirect(new URL(returnTo, request.url));
}
