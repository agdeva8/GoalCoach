import { redirect } from 'next/navigation';
import { getGoalsForUser } from '@goalcoach/db';
import { PlansByHorizon } from '@/components/PlansByHorizon';
import { StaleDataBanner } from '@/components/StaleDataBanner';
import { getServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// /plans is auth-gated: it shows every goal the user has, grouped by horizon.
// Anonymous visitors go back to / to sign in; not yet linked from the nav.
export default async function PlansPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  const goals = await getGoalsForUser(supabase, user.id);

  return (
    <main>
      <h1>Plans</h1>
      <PlansByHorizon goals={goals} />
      {/* Placeholder staleness: real staleness calculation lands in a later slice. */}
      <StaleDataBanner minutesAgo={5} />
    </main>
  );
}
