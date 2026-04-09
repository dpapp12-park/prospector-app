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
  map_bearing numeric,
  map_pitch numeric,
  map_bounds_sw_lat numeric,
  map_bounds_sw_lng numeric,
  map_bounds_ne_lat numeric,
  map_bounds_ne_lng numeric,
  page_path text,
  app_section text,
  map_style text,
  active_layers jsonb default '[]'::jsonb,
  lidar_styles jsonb default '[]'::jsonb,
  has_gps_fix boolean default false,
  gps_lat numeric,
  gps_lng numeric,
  viewport_width int,
  viewport_height int,
  device_pixel_ratio numeric,
  language text,
  timezone text,
  current_url text,
  referrer text,
  release_channel text,
  session_id text,
  feedback_page text,
  feedback_path text,
  feedback_url text,
  session_status text,
  active_lidar_styles jsonb default '[]'::jsonb,
  camera_pitch numeric,
  camera_bearing numeric,
  view_bounds jsonb default '{}'::jsonb,
  view_center jsonb default '{}'::jsonb,
  gps_state text,
  user_agent text
);

alter table beta_feedback add column if not exists page_path text;
alter table beta_feedback add column if not exists app_section text;
alter table beta_feedback add column if not exists referrer text;
alter table beta_feedback add column if not exists map_style text;
alter table beta_feedback add column if not exists has_gps_fix boolean default false;
alter table beta_feedback add column if not exists gps_lat numeric;
alter table beta_feedback add column if not exists gps_lng numeric;
alter table beta_feedback add column if not exists map_pitch numeric;
alter table beta_feedback add column if not exists map_bearing numeric;
alter table beta_feedback add column if not exists map_bounds_sw_lat numeric;
alter table beta_feedback add column if not exists map_bounds_sw_lng numeric;
alter table beta_feedback add column if not exists map_bounds_ne_lat numeric;
alter table beta_feedback add column if not exists map_bounds_ne_lng numeric;
alter table beta_feedback add column if not exists viewport_width int;
alter table beta_feedback add column if not exists viewport_height int;
alter table beta_feedback add column if not exists device_pixel_ratio numeric;
alter table beta_feedback add column if not exists language text;
alter table beta_feedback add column if not exists timezone text;
alter table beta_feedback add column if not exists current_url text;
alter table beta_feedback add column if not exists release_channel text;
alter table beta_feedback add column if not exists session_id text;
alter table beta_feedback add column if not exists feedback_page text;
alter table beta_feedback add column if not exists feedback_path text;
alter table beta_feedback add column if not exists feedback_url text;
alter table beta_feedback add column if not exists session_status text;
alter table beta_feedback add column if not exists active_lidar_styles jsonb default '[]'::jsonb;
alter table beta_feedback add column if not exists camera_pitch numeric;
alter table beta_feedback add column if not exists camera_bearing numeric;
alter table beta_feedback add column if not exists view_bounds jsonb default '{}'::jsonb;
alter table beta_feedback add column if not exists view_center jsonb default '{}'::jsonb;
alter table beta_feedback add column if not exists gps_state text;
alter table beta_feedback add column if not exists active_layers jsonb default '[]'::jsonb;
alter table beta_feedback add column if not exists lidar_styles jsonb default '[]'::jsonb;

create index if not exists idx_beta_signups_created_at on beta_signups (created_at desc);
create index if not exists idx_beta_signups_email on beta_signups (email);
create index if not exists idx_beta_feedback_created_at on beta_feedback (created_at desc);
create index if not exists idx_beta_feedback_type on beta_feedback (type);

-- Optional RLS starter policy if RLS is enabled:
-- alter table beta_signups enable row level security;
-- alter table beta_feedback enable row level security;
-- create policy "allow beta signup inserts" on beta_signups for insert to anon with check (true);
-- create policy "allow beta feedback inserts" on beta_feedback for insert to anon with check (true);
