-- Execute as a NEW query in Supabase SQL Editor; do not delete existing tables.
create table if not exists public.sales_map_transactions (
  id text primary key,
  target_id text not null,
  product text,
  qty integer not null default 0 check (qty >= 0),
  price numeric(14,2) not null default 0 check (price >= 0),
  paid numeric(14,2) not null default 0 check (paid >= 0),
  created_by uuid not null references auth.users(id),
  created_by_email text not null default '',
  created_at timestamptz not null default now(),
  check ((qty > 0 and product is not null and paid <= qty * price) or (qty = 0 and product is null and paid > 0))
);
create index if not exists sales_map_transactions_target_idx on public.sales_map_transactions(target_id);
create index if not exists sales_map_transactions_created_idx on public.sales_map_transactions(created_at);
alter table public.sales_map_transactions enable row level security;
create policy "sales map staff read transactions" on public.sales_map_transactions
  for select to authenticated
  using (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role in ('admin','seller')));
create policy "sales map staff insert own transactions" on public.sales_map_transactions
  for insert to authenticated
  with check (created_by=auth.uid() and exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role in ('admin','seller')));
-- No UPDATE/DELETE policies: accounting history is append-only.
