-- Seedline optional admin backend for Supabase.
-- Run this whole file once in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- Everyone can READ. Only users listed in public.admins can WRITE.

create extension if not exists pgcrypto;

-- 1) Who is an admin. Add a row here (with the user's id from Auth -> Users).
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 2) Messages: either an override of a Mixlr recording (mixlr_id set)
--    or a new admin-added message (mixlr_id null, audio_url set).
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  mixlr_id text unique,
  title text,
  series text,
  category text check (category is null or category in
    ('Discipleship','Prayer','Holiness','Revival','Faith','Christian Living','Uncategorised')),
  recorded_on date,
  duration_secs integer,
  audio_url text,          -- direct audio link; only add with the owner's permission
  source_url text,
  artwork_url text,
  permission_confirmed boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint audio_needs_permission check (audio_url is null or permission_confirmed)
);

-- 3) Featured playlists shown on everyone's Home screen.
create table if not exists public.featured_playlists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  item_ids text[] not null default '{}',   -- e.g. {'mx:2552216','sb:<uuid>'}
  sort integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

-- Helper: is the signed-in user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists messages_touch on public.messages;
create trigger messages_touch before update on public.messages
  for each row execute function public.touch_updated_at();

-- Row Level Security
alter table public.admins enable row level security;
alter table public.messages enable row level security;
alter table public.featured_playlists enable row level security;

-- admins: a user may only see their own row; nobody can write through the API
drop policy if exists "admins read own" on public.admins;
create policy "admins read own" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- messages: public read, admin write
drop policy if exists "messages public read" on public.messages;
create policy "messages public read" on public.messages
  for select to anon, authenticated using (true);
drop policy if exists "messages admin insert" on public.messages;
create policy "messages admin insert" on public.messages
  for insert to authenticated with check (public.is_admin());
drop policy if exists "messages admin update" on public.messages;
create policy "messages admin update" on public.messages
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "messages admin delete" on public.messages;
create policy "messages admin delete" on public.messages
  for delete to authenticated using (public.is_admin());

-- featured playlists: public read, admin write
drop policy if exists "featured public read" on public.featured_playlists;
create policy "featured public read" on public.featured_playlists
  for select to anon, authenticated using (true);
drop policy if exists "featured admin insert" on public.featured_playlists;
create policy "featured admin insert" on public.featured_playlists
  for insert to authenticated with check (public.is_admin());
drop policy if exists "featured admin update" on public.featured_playlists;
create policy "featured admin update" on public.featured_playlists
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "featured admin delete" on public.featured_playlists;
create policy "featured admin delete" on public.featured_playlists
  for delete to authenticated using (public.is_admin());

-- After creating your admin user in Authentication -> Users, run (with their real id):
-- insert into public.admins (user_id) values ('PASTE-USER-ID-HERE');
