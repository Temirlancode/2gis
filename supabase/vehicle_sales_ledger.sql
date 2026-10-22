-- Run in Supabase SQL Editor before enabling vehicle sales posting.
-- One sale document per unique operation. No changes to MoySklad or stock here.
create table if not exists public.sales_map_moysklad_sales (
 id uuid primary key default gen_random_uuid(),
 idempotency_key uuid not null unique,
 shift_id uuid not null references public.sales_map_shifts(id),
 seller_id uuid not null references auth.users(id),
 vehicle_id text not null references public.sales_map_vehicles(id),
 target_id text not null,
 product text not null check (product in ('EL-001','MA-001','PR-001','KU-001')),
 qty integer not null check (qty between 1 and 100000),
 price numeric(14,2) not null check (price >= 0),
 paid numeric(14,2) not null check (paid >= 0 and paid <= qty*price),
 status text not null default 'pending' check (status in ('pending','processing','succeeded','reconciliation_needed','failed')),
 moysklad_document_id uuid unique,
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists sales_map_moysklad_sales_vehicle_idx on public.sales_map_moysklad_sales(vehicle_id,created_at desc);
alter table public.sales_map_moysklad_sales enable row level security;
drop policy if exists sales_map_moysklad_sales_read on public.sales_map_moysklad_sales;
create policy sales_map_moysklad_sales_read on public.sales_map_moysklad_sales for select to authenticated
 using (seller_id=auth.uid() or exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin'));
-- No direct browser writes: queue/claim/confirm will be separate audited RPCs.
revoke all on public.sales_map_moysklad_sales from anon;
grant select on public.sales_map_moysklad_sales to authenticated;
