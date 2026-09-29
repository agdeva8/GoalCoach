import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Area,
  AreaKey,
  Goal,
  Reflection,
  Thread,
  Feedback,
  Horizon,
  GoalStatus,
  UserAreaPreference,
} from './types';

// Areas are a static enum; the *selection* is persisted per user in the
// user_area_preferences table (migration 0010). `AREAS` stays the source of
// truth for the allowed keys.
const AREAS: Area[] = [
  { key: 'career', label: 'Career', color: 'var(--moss)' },
  { key: 'health', label: 'Health', color: 'var(--moss)' },
  { key: 'relationships', label: 'Relationships', color: 'var(--moss)' },
  { key: 'finance', label: 'Finance', color: 'var(--moss)' },
  { key: 'learning', label: 'Learning', color: 'var(--moss)' },
  { key: 'fun', label: 'Fun', color: 'var(--moss)' },
];

export function getAreas(): Area[] {
  return AREAS;
}

export async function getGoalsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<Goal[]> {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Goal[];
}

export type GoalsByStatus = {
  active: Goal[];
  paused: Goal[];
  completed: Goal[];
};

export type GoalsByHorizon = {
  week: Goal[];
  month: Goal[];
  quarter: Goal[];
  year: Goal[];
  'multi-year': Goal[];
};

// Pure helper: bucket goals by horizon. Always returns all five keys,
// each an array (possibly empty) so the UI can render per-horizon
// empty states without conditionals (Review Focus 3).
export function bucketGoalsByHorizon(goals: Goal[]): GoalsByHorizon {
  const out: GoalsByHorizon = {
    week: [],
    month: [],
    quarter: [],
    year: [],
    'multi-year': [],
  };
  for (const g of goals) {
    out[g.horizon].push(g);
  }
  return out;
}

// One query, bucket client-side. Eng D4 fold: single round-trip, three views.
export async function getGoalsBucketedByStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<GoalsByStatus> {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const goals = (data ?? []) as Goal[];
  return {
    active: goals.filter((g) => g.status === 'active'),
    paused: goals.filter((g) => g.status === 'paused'),
    completed: goals.filter((g) => g.status === 'completed'),
  };
}

export async function insertGoal(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  horizon: Horizon
): Promise<Goal> {
  const { data, error } = await supabase
    .from('goals')
    .insert({ user_id: userId, title, horizon })
    .select()
    .single();
  if (error) throw error;
  return data as Goal;
}

export async function updateGoal(
  supabase: SupabaseClient,
  goalId: string,
  patch: { status?: GoalStatus; title?: string }
): Promise<Goal> {
  const { data, error } = await supabase
    .from('goals')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', goalId)
    .select()
    .single();
  if (error) throw error;
  return data as Goal;
}

export async function insertReflection(
  supabase: SupabaseClient,
  userId: string,
  body: string,
  goalId?: string,
  horizon?: Horizon
): Promise<Reflection> {
  const { data, error } = await supabase
    .from('reflections')
    .insert({
      user_id: userId,
      body,
      goal_id: goalId ?? null,
      horizon: horizon ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Reflection;
}

// Belt-and-suspenders: most users get a public.users row auto-created by the
// AFTER INSERT trigger in migration 0009. This helper covers the gaps —
// auth.users rows that predate 0009 being applied, schema-cache races where
// the trigger fired but the row hasn't propagated, and any future code path
// that authenticates without going through auth.signIn. ON CONFLICT is silent
// so this is safe to call repeatedly.
export async function ensureUserExists(
  supabase: SupabaseClient,
  userId: string,
  email: string | null | undefined,
  name?: string | null
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .upsert(
      {
        id: userId,
        email: email ?? null,
        name: name ?? null,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function appendThread(
  supabase: SupabaseClient,
  userId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  userEmail?: string | null,
  userName?: string | null
): Promise<Thread> {
  await ensureUserExists(supabase, userId, userEmail, userName);
  const { data, error } = await supabase
    .from('threads')
    .insert({ user_id: userId, role, content })
    .select()
    .single();
  if (error) throw error;
  return data as Thread;
}

export async function getRecentThreads(
  supabase: SupabaseClient,
  userId: string,
  limit = 50
): Promise<Thread[]> {
  const { data, error } = await supabase
    .from('threads')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Reverse to chronological order for prompt context
  return ((data ?? []) as Thread[]).reverse();
}

export async function recordFeedback(
  supabase: SupabaseClient,
  userId: string,
  messageId: string | null,
  sentiment: 'up' | 'down',
  comment?: string
): Promise<Feedback> {
  const { data, error } = await supabase
    .from('feedback')
    .insert({
      user_id: userId,
      message_id: messageId,
      sentiment,
      comment: comment ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Feedback;
}

// All areas the user CAN pick. Reading from getAreas() keeps this in sync
// with the enum if a future area is added.
export async function getUserAreaPreferences(
  supabase: SupabaseClient,
  userId: string
): Promise<UserAreaPreference[]> {
  const { data, error } = await supabase
    .from('user_area_preferences')
    .select('user_id, area_key, selected_at')
    .eq('user_id', userId)
    .order('selected_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as UserAreaPreference[];
}

export async function setUserAreaPreferences(
  supabase: SupabaseClient,
  userId: string,
  areaKeys: AreaKey[]
): Promise<void> {
  // Validate against the enum so a stray string in the request body can't
  // be persisted. Server routes also validate, but the helper is the
  // contract surface and must not silently accept unknowns. The table's
  // CHECK constraint is the final backstop.
  const allowed = new Set(getAreas().map((a) => a.key));
  const filtered = areaKeys.filter((k) => allowed.has(k));

  // One upsert per row against the (user_id, area_key) primary key, so
  // re-saving the same selection is idempotent and never clobbers
  // selected_at semantics for untouched rows.
  for (const area_key of filtered) {
    const { error } = await supabase
      .from('user_area_preferences')
      .upsert({ user_id: userId, area_key }, { onConflict: 'user_id,area_key' });
    if (error) throw error;
  }

  // Delete any rows for this user that aren't in the new set, so un-picking
  // an area removes it. When every allowed key was picked, `toDelete` is
  // empty and this is a no-op.
  const toDelete = getAreas()
    .map((a) => a.key)
    .filter((k) => !filtered.includes(k));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from('user_area_preferences')
      .delete()
      .eq('user_id', userId)
      .in('area_key', toDelete);
    if (error) throw error;
  }
}
