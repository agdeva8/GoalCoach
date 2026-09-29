import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AreaCarousel } from '@/components/AreaCarousel';
import { getServerSupabase } from '@/lib/supabase/server';
import { getAreas, getUserAreaPreferences, setUserAreaPreferences } from '@goalcoach/db';
import { AreaCarouselClient } from '@/components/AreaCarouselClient';

export const dynamic = 'force-dynamic';

async function persistAndGoToChat(formData: FormData) {
  'use server';
  const raw = formData.get('areas');
  const parsed: string[] = raw ? JSON.parse(String(raw)) : [];
  // Filter against the AreaKey enum via getAreas() (same pattern as
  // setUserAreaPreferences' internal guard). Defense-in-depth, not hardcoding.
  const allowed = new Set(getAreas().map((a) => a.key));
  const areaKeys = parsed.filter((k): k is typeof allowed extends Set<infer T> ? T : never =>
    allowed.has(k as any)
  );

  const supabase2 = await getServerSupabase();
  const { data: { user: u2 } } = await supabase2.auth.getUser();
  if (!u2) redirect('/');

  await setUserAreaPreferences(supabase2, u2.id, areaKeys);
  redirect('/chat');
}

export default async function HomePage() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="home-gate">
        <h1 className="home-gate__title">Think through your goals, out loud.</h1>
        <p className="home-gate__body">
          Sign in with Google to pick the areas you care about, then chat with your coach.
        </p>
        <Link
          href="/api/auth/google"
          className="navbar__cta"
          data-testid="sign-in-link"
          prefetch={false}
        >
          Sign in with Google
        </Link>
      </main>
    );
  }

  const prefs = await getUserAreaPreferences(supabase, user.id);
  if (prefs.length > 0) {
    redirect('/chat');
  }

  return (
    <main>
      <form action={persistAndGoToChat}>
        <input type="hidden" name="areas" id="areas-input" defaultValue="" />
        <AreaCarouselClient />
      </form>
    </main>
  );
}
