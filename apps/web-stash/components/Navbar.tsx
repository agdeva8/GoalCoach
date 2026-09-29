import Link from 'next/link';
import { getServerSupabase } from '@/lib/supabase/server';

// Server component. Reads the current user from the cookie-backed
// session via @supabase/ssr. Renders nothing user-specific when the
// user is anonymous.
export async function Navbar() {
  let email: string | null = null;
  try {
    const supabase = await getServerSupabase();
    const { data } = await supabase.auth.getUser();
    email = data?.user?.email ?? null;
  } catch {
    // getServerSupabase throws on missing env. In dev, falling back to
    // an unauthenticated navbar is fine; the user can still sign in.
  }

  return (
    <nav className="navbar" aria-label="primary">
      <Link href="/" className="navbar__brand" data-testid="navbar-brand">
        GoalCoach
      </Link>
      <span className="navbar__spacer" aria-hidden="true" />
      {email ? (
        <div className="navbar__user">
          <span className="navbar__email" data-testid="navbar-email">
            {email}
          </span>
          <form action="/api/auth/signout" method="post" className="navbar__signout-form">
            <button
              type="submit"
              className="navbar__cta"
              data-testid="navbar-signout"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : (
        <Link
          href="/api/auth/google?returnTo=/"
          className="navbar__cta"
          data-testid="navbar-signin"
          prefetch={false}
        >
          Sign in with Google
        </Link>
      )}
    </nav>
  );
}
