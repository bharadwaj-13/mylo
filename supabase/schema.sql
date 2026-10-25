-- Mylo control-plane schema. Run this once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create type public.mylo_job_status as enum (
  'queued', 'running', 'needs_login', 'needs_otp', 'needs_user_action',
  'compared', 'cart_ready', 'handoff_ready', 'completed', 'failed', 'cancelled'
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  default_location jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store text not null check (store in ('blinkit', 'zepto', 'instamart')),
  status text not null default 'not_connected' check (status in ('not_connected', 'connecting', 'connected', 'expired', 'needs_login')),
  session_ref text,
  phone_hint text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, store)
);

create table if not exists public.shopping_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'dashboard' check (source in ('dashboard', 'whatsapp', 'manual')),
  request_text text not null check (char_length(request_text) <= 1500),
  budget_paise integer,
  location jsonb not null default '{}'::jsonb,
  stores text[] not null default array['blinkit','zepto','instamart'],
  status public.mylo_job_status not null default 'queued',
  selected_store text,
  handoff_url text,
  worker_session_id text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.shopping_jobs(id) on delete cascade,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.shopping_jobs(id) on delete cascade,
  store text not null,
  total_paise integer,
  items_total_paise integer,
  fees_paise integer,
  eta_minutes integer,
  currency text not null default 'INR',
  items jsonb not null default '[]'::jsonb,
  cart_url text,
  available boolean not null default true,
  recommended boolean not null default false,
  captured_at timestamptz not null default now()
);

create table if not exists public.otp_challenges (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.shopping_jobs(id) on delete cascade,
  store text not null,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'expired', 'consumed')),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_message_id text,
  from_address text,
  body text,
  received_at timestamptz not null default now(),
  unique(provider, provider_message_id)
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists store_connections_updated_at on public.store_connections;
create trigger store_connections_updated_at before update on public.store_connections for each row execute function public.set_updated_at();
drop trigger if exists shopping_jobs_updated_at on public.shopping_jobs;
create trigger shopping_jobs_updated_at before update on public.shopping_jobs for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.store_connections enable row level security;
alter table public.shopping_jobs enable row level security;
alter table public.job_events enable row level security;
alter table public.quotes enable row level security;
alter table public.otp_challenges enable row level security;
alter table public.webhook_messages enable row level security;

create policy "profiles own" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "connections own" on public.store_connections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jobs own" on public.shopping_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "events for own jobs" on public.job_events for select using (exists (select 1 from public.shopping_jobs j where j.id = job_id and j.user_id = auth.uid()));
create policy "quotes for own jobs" on public.quotes for select using (exists (select 1 from public.shopping_jobs j where j.id = job_id and j.user_id = auth.uid()));
create policy "otp challenges for own jobs" on public.otp_challenges for select using (exists (select 1 from public.shopping_jobs j where j.id = job_id and j.user_id = auth.uid()));

-- The user creates an account before this trigger can run; it never handles a password.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name','Mylo shopper')) on conflict (id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
