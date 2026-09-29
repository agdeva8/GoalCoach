import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getGoalsForUser,
  insertGoal,
  updateGoal,
  insertReflection,
  getRecentThreads,
} from '@goalcoach/db';
import type { Horizon, GoalStatus } from '@goalcoach/db';

// pnpm hoists two distinct copies of @supabase/supabase-js — one bare
// (used by @goalcoach/db) and one @opentelemetry-instrumented (used by
// @supabase/ssr). TS treats them as distinct nominal types even though
// they share the same name. Cast at the boundary so callers don't have to.
export type AnySupabase = SupabaseClient<any, any, any>;

export function createHandlers(supabase: AnySupabase, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = supabase as any;
  return {
    list_goals: async (_input: Record<string, never>) => {
      return await getGoalsForUser(s, userId);
    },

    create_goal: async (input: { title: string; horizon: Horizon }) => {
      return await insertGoal(s, userId, input.title, input.horizon);
    },

    update_goal: async (input: {
      goal_id: string;
      status?: GoalStatus;
      title?: string;
    }) => {
      const patch: { status?: GoalStatus; title?: string } = {};
      if (input.status) patch.status = input.status;
      if (input.title) patch.title = input.title;
      return await updateGoal(s, input.goal_id, patch);
    },

    log_reflection: async (input: {
      body: string;
      goal_id?: string;
      horizon?: Horizon;
    }) => {
      return await insertReflection(
        s,
        userId,
        input.body,
        input.goal_id,
        input.horizon
      );
    },

    search_threads: async (input: { q: string; limit?: number }) => {
      const threads = await getRecentThreads(s, userId, input.limit ?? 20);
      const ql = input.q.toLowerCase();
      return threads.filter((t) => t.content.toLowerCase().includes(ql));
    },
  };
}
