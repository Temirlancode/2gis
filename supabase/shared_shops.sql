-- Run once in Supabase SQL Editor.
create table if not exists public.sales_map_locations (
  id text primary key,
  type text not null check (type in ('client','market')),
  name text not null,
  owner text not null default '',
  phone text not null default '',
  photo text not null default '',
  lat double precision not null,
  lon double precision not null,
  x double precision,
  y double precision,
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.sales_map_boutiques (
  id text primary key,
  market_id text not null references public.sales_map_locations(id) on delete cascade,
  name text not null,
  owner text not null default '',
  phone text not null default '',
  photo text not null default '',
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create index if not exists sales_map_boutiques_market_idx on public.sales_map_boutiques(market_id);
alter table public.sales_map_locations enable row level security;
alter table public.sales_map_boutiques enable row level security;
create policy "profiles read locations" on public.sales_map_locations for select to authenticated using (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role in ('admin','seller')));
create policy "profiles insert locations" on public.sales_map_locations for insert to authenticated with check (created_by=auth.uid() and exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role in ('admin','seller')));
create policy "profiles update locations" on public.sales_map_locations for update to authenticated using (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role in ('admin','seller'))) with check (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role in ('admin','seller')));
create policy "profiles read boutiques" on public.sales_map_boutiques for select to authenticated using (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role in ('admin','seller')));
create policy "profiles insert boutiques" on public.sales_map_boutiques for insert to authenticated with check (created_by=auth.uid() and exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role in ('admin','seller')));
create policy "profiles update boutiques" on public.sales_map_boutiques for update to authenticated using (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role in ('admin','seller'))) with check (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role in ('admin','seller')));
