-- GoalCoach migration 0009: keep public.users in sync with auth.users.
--
-- Why this exists
-- ---------------
-- Migration 0001 created public.users and pointed every user-owned table at it
-- (goals, reflections, threads, feedback). It also set RLS so each user can only
-- see their own row:  auth.uid() = id . The plan assumed an auth.users -> public.users
-- mirror trigger would exist; none does. The net result on the live Supabase DB
-- is that any user who signs in via Google OAuth gets a row in auth.users but
-- NOT in public.users, so the first FK constraint they hit (threads_user_id_fkey,
-- surfaced on every chat send) explodes.
--
-- What this migration does
-- ------------------------
-- 1. Defines handle_new_auth_user(), a SECURITY DEFINER trigger function that
--    mirrors an auth.users INSERT into public.users. It reads email and a best-
--    guess display name from the OAuth payload (full_name -> local-part of email).
--
-- 2. Wires the trigger ON auth.users INSERT. Auth users is owned by Supabase's
--    auth schema, so we have to CREATE TRIGGER ... IN SCHEMA auth (not public),
--    per Supabase docs.
--
-- 3. ON CONFLICT (id) DO NOTHING: the trigger is idempotent. If a public.users
--    row already exists (e.g. seeded by hand for an old user), the trigger
--    leaves it alone. After applying this migration, you can backfill manually:
--
--        insert into public.users (id, email, name)
--        select au.id, au.email,
--               coalesce(au.raw_user_meta_data->>'full_name',
--                        split_part(au.email, '@', 1))
--        from auth.users au
--        on conflict (id) do nothing;
--
-- Why SECURITY DEFINER
-- --------------------
-- The trigger runs with the privileges of the function owner (the migration
-- applier), not the calling user. That lets it INSERT into public.users even
-- though RLS would normally block cross-user writes. Without it, the trigger
-- could only mirror rows whose auth.uid() == new.id, which is the case we want
-- anyway, but DEFINER also handles pre-existing users whose schema cache may
-- not yet be warmed.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Re-runnable: drop + recreate so re-applying this migration is a no-op.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Make sure the migration applier can grant EXECUTE on this function to
-- authenticated / anon, in case a future RLS policy needs to call it.
grant execute on function public.handle_new_auth_user() to authenticated;
grant execute on function public.handle_new_auth_user() to anon;
