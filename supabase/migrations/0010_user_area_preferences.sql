-- GoalCoach migration 0010: persist user area preferences.
--
-- Why this exists
-- ---------------
-- Per L0 §"Onboarding & Personalization" (revised 2026-09-23), areas are a
-- first-class personalization axis — not a presentation-layer concept.
-- The home     page renders an AreaCarousel on first sign-in; the user picks
-- areas (or skips); the selection persists across sessions and devices
-- and is fed into the chat system prompt as context.
--
-- Why a table, not a users.areas TEXT[] column
-- --------------------------------------------
-- A normalized table lets us add per-area metadata later (selected_at,
-- source, last-shown, etc.) without a destructive column migration. The
-- primary key on (user_id, area_key) makes the upsert idempotent — the
-- "Skip" path and the "Continue" path can both POST without race-prone
-- read-modify-write logic.
--
-- What this migration does
-- ------------------------
-- 1. Defines user_area_preferences with (user_id, area_key) PK.
-- 2. Adds an index on user_id so the per-user lookup is O(log n).
-- 3. Enables RLS and creates a policy that lets each user only read or
--    write their own rows.
-- 4. Grants SELECT/INSERT/UPDATE/DELETE on the table to the authenticated
--    role (RLS still applies; anon gets nothing).

create table if not exists public.user_area_preferences (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  area_key    text        not null check (area_key in ('career','health','relationships','finance','learning','fun')),
  selected_at timestamptz not null default now(),
  primary key (user_id, area_key)
);

create index if not exists user_area_preferences_user_id_idx
  on public.user_area_preferences (user_id);

alter table public.user_area_preferences enable row level security;

drop policy if exists user_area_preferences_select_own on public.user_area_preferences;
create policy user_area_preferences_select_own on public.user_area_preferences
  for select using (auth.uid() = user_id);

drop policy if exists user_area_preferences_insert_own on public.user_area_preferences;
create policy user_area_preferences_insert_own on public.user_area_preferences
  for insert with check (auth.uid() = user_id);

drop policy if exists user_area_preferences_update_own on public.user_area_preferences;
create policy user_area_preferences_update_own on public.user_area_preferences
  for update using (auth.uid() = user_id);

drop policy if exists user_area_preferences_delete_own on public.user_area_preferences;
create policy user_area_preferences_delete_own on public.user_area_preferences
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_area_preferences to authenticated;
