-- Run after vehicle_assignments.sql and car_stock.sql.
-- Durable ledger for future MoySklad transfer posting. No MoySklad writes here.
create table if not exists public.sales_map_moysklad_operations (
 id uuid primary key default gen_random_uuid(),
 idempotency_key uuid not null unique,
 shift_id uuid not null references public.sales_map_shifts(id),
 seller_id uuid not null references auth.users(id),
 vehicle_id text not null references public.sales_map_vehicles(id),
 product text not null check(product in ('EL-001','MA-001','PR-001','KU-001')),
 qty integer not null check(qty between 1 and 100000),
 direction text not null check(direction in ('load','return')),
 status text not null default 'pending' check(status in ('pending','processing','succeeded','reconciliation_needed','failed')),
 moysklad_document_id uuid unique,
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists sales_map_moysklad_operations_vehicle_idx
 on public.sales_map_moysklad_operations(vehicle_id,created_at desc);
alter table public.sales_map_moysklad_operations enable row level security;
drop policy if exists sales_map_moysklad_operations_read on public.sales_map_moysklad_operations;
create policy sales_map_moysklad_operations_read on public.sales_map_moysklad_operations
 for select to authenticated using(
  seller_id=auth.uid() or exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin')
 );
-- No INSERT/UPDATE/DELETE policies for authenticated users.
-- A trusted server will validate Supabase JWT and create/advance operations.
-- Unknown MoySklad outcomes MUST go to reconciliation_needed, never blindly retry.
