import Link from 'next/link';
import { ChatThread } from '@/components/ChatThread';
import { getServerSupabase } from '@/lib/supabase/server';
import type { Horizon } from '@goalcoach/db';

// The set of horizons the coach supports today. The design doc enumerates
// more (daily / weekly / monthly / quarterly / yearly / five_year) but we
// ship the five the user can currently pick from. Adding more is a one-line
// change here + a Horizon enum update.
const VALID_HORIZONS = new Set<Horizon>([
  'week',
  'month',
  'quarter',
  'year',
  'multi-year',
]);

export const dynamic = 'force-dynamic';

// /chat is auth-gated: it shows the chat thread for authenticated users
// and a sign-in CTA for anonymous visitors. ?horizon= is now optional;
// invalid values fall back to 'week' rather than redirecting.
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ horizon?: string }>;
}) {
  const params = await searchParams;
  const requested = params.horizon as Horizon | undefined;
  const persona: Horizon = requested && VALID_HORIZONS.has(requested) ? requested : 'week';

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="chat-gate">
        <h1 className="chat-gate__title">Sign in to start</h1>
        <p className="chat-gate__body">
          GoalCoach uses Google to authenticate you and call Gemini on your behalf.
        </p>
        <Link
          href="/api/auth/google?returnTo=%2Fchat"
          className="navbar__cta"
          data-testid="sign-in-link"
          prefetch={false}
        >
          Sign in with Google
        </Link>
      </main>
    );
  }

  return (
    <main>
      <p className="chat__context">Working on: {persona}</p>
      <ChatThread persona={persona} />
    </main>
  );
}
