-- GoalCoach Phase 1 schema
-- Migration 0001: initial tables

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  created_at timestamptz default now()
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  title text not null,
  horizon text check (horizon in ('week','month','quarter','year','multi-year')) not null,
  status text check (status in ('active','paused','completed','abandoned')) default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  body text not null,
  goal_id uuid references goals(id) on delete set null,
  horizon text check (horizon in ('week','month','quarter','year','multi-year')),
  created_at timestamptz default now()
);

create table threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  role text check (role in ('user','assistant','system')) not null,
  content text not null,
  created_at timestamptz default now()
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  message_id uuid,
  sentiment text check (sentiment in ('up','down')) not null,
  comment text,
  created_at timestamptz default now()
);

create index goals_user_idx on goals(user_id);
create index reflections_user_idx on reflections(user_id);
create index threads_user_idx on threads(user_id);
create index feedback_user_idx on feedback(user_id);

-- Row Level Security: every signed-in user only sees their own rows.
-- The service_role key bypasses RLS, so cron routes that use
-- SUPABASE_SERVICE_ROLE_KEY continue to read across users as designed.
alter table users       enable row level security;
alter table goals       enable row level security;
alter table reflections enable row level security;
alter table threads     enable row level security;
alter table feedback    enable row level security;

create policy users_self on users
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy goals_self on goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy reflections_self on reflections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy threads_self on threads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy feedback_self on feedback
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
