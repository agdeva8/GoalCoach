import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// POST so the Navbar sign-out button can be a real <form method="post">
// (no client JS, no CSRF surface for state-changing GETs). We return 303
// See Other so the browser issues a GET on the redirect target rather
// than re-POSTing. Some Supabase SSR helpers also accept GET for signOut;
// POST+303 is the canonical "POST then redirect" pattern.
export async function POST(request: Request) {
  try {
    const supabase = await getServerSupabase();
    await supabase.auth.signOut();
  } catch {
    // Sign-out is best-effort; still bounce the user home so they see
    // a fresh, unauthenticated UI.
  }
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}