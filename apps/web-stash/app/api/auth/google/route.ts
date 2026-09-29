import { redirect } from 'next/navigation';
import { getServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Accepts only same-origin relative paths. Absolute URLs (https://evil/...)
// and protocol-relative URLs (//evil/...) are open-redirect risks and
// collapse back to '/'. The caller (e.g. /chat when unauthenticated)
// chooses what to send; the auth route validates it.
function sanitizeReturnTo(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

// Kicks off the Google OAuth flow. The scopes string includes the
// Generative Language API scopes so the access token we receive on the
// callback can be used to call Gemini on the user's behalf. Google
// publishes two scopes for this API: cloud-platform (broad GCP scope
// covering all enabled services) and generative-language.retriever
// (semantic retrieval). Together they let the user's OAuth token call
// streamGenerateContent. The user must explicitly consent on Google's
// consent screen; re-publish the consent screen in Google Cloud Console
// if you change this list after going live. See docs/DEPLOY.md.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));

  const callbackUrl = new URL('/api/auth/callback', url);
  if (returnTo !== '/') {
    callbackUrl.searchParams.set('returnTo', returnTo);
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const redirectTo = `${appUrl}${callbackUrl.pathname}${callbackUrl.search}`;

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/generative-language.retriever',
      ].join(' '),
      redirectTo,
    },
  });
  if (error) throw error;
  redirect(data.url);
}