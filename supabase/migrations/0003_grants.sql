-- GoalCoach migration 0003: table-level GRANTs.
--
-- Why this exists:
--   The 0001_init migration enables RLS on users/goals/reflections/
--   threads/feedback and defines per-user policies. RLS policies only
--   evaluate when the role already has the table-level privilege
--   (SELECT/INSERT/UPDATE/DELETE). Without explicit GRANTs, the
--   authenticated role gets 42501 "permission denied for table X" from
--   PostgREST BEFORE the policy gets a chance to run. The hint on that
--   error literally says "Grant the required privileges to the current
--   role with: GRANT SELECT ON public.threads TO authenticated".
--
-- The Supabase CLI's `db push` adds these GRANTs automatically when it
-- generates migrations. Our 0001 was authored by hand and applied via the
-- SQL editor, so the implicit GRANTs were skipped.
--
-- What this grants:
--   - USAGE on the public schema to anon and authenticated (required
--     before any table grant in that schema takes effect for those
--     roles).
--   - SELECT, INSERT, UPDATE, DELETE on each user-scoped table to
--     authenticated. The existing per-user RLS policies then scope which
--     rows each user can see.
--   - ALL on each user-scoped table to service_role, so cron/admin
--     operations that use SUPABASE_SERVICE_ROLE_KEY can read across
--     users as designed.

grant usage on schema public to anon;
grant usage on schema public to authenticated;

grant select, insert, update, delete on public.users        to authenticated;
grant select, insert, update, delete on public.goals        to authenticated;
grant select, insert, update, delete on public.reflections  to authenticated;
grant select, insert, update, delete on public.threads      to authenticated;
grant select, insert, update, delete on public.feedback     to authenticated;

grant all on public.users        to service_role;
grant all on public.goals        to service_role;
grant all on public.reflections  to service_role;
grant all on public.threads      to service_role;
grant all on public.feedback     to service_role;
