-- Beta tester signup and feedback tables
-- Run this in your Supabase SQL editor.

create table if not exists beta_signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null,
  last_name text not null,
  email text not null,
  role text not null,
  source text default 'beta_landing',
  user_agent text
);

create table if not exists beta_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid null references auth.users(id) on delete set null,
  type text not null,
  message text not null,
  map_zoom numeric,
  map_lat numeric,
  map_lng numeric,
  user_agent text
);

create index if not exists idx_beta_signups_created_at on beta_signups (created_at desc);
create index if not exists idx_beta_signups_email on beta_signups (email);
create index if not exists idx_beta_feedback_created_at on beta_feedback (created_at desc);
create index if not exists idx_beta_feedback_type on beta_feedback (type);

-- Optional RLS starter policy if RLS is enabled:
-- alter table beta_signups enable row level security;
-- alter table beta_feedback enable row level security;
-- create policy "allow beta signup inserts" on beta_signups for insert to anon with check (true);
-- create policy "allow beta feedback inserts" on beta_feedback for insert to anon with check (true);
