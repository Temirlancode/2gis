-- Run after shared_transactions.sql. Shift stock is tracked per seller in Supabase.
-- MoySklad warehouse transfers are NOT enabled until vehicle warehouse mapping is configured.
create table if not exists public.sales_map_shifts (
 id uuid primary key default gen_random_uuid(),
 seller_id uuid not null references auth.users(id),
 seller_email text not null default '',
 started_at timestamptz not null default now(),
 ended_at timestamptz,
 constraint valid_shift_dates check (ended_at is null or ended_at>=started_at)
);
create unique index if not exists sales_map_one_open_shift on public.sales_map_shifts(seller_id) where ended_at is null;
create table if not exists public.sales_map_vehicle_stock (
 seller_id uuid not null references auth.users(id),
 product text not null check(product in ('EL-001','MA-001','PR-001','KU-001')),
 qty integer not null default 0 check(qty>=0),
 primary key(seller_id,product)
);
create table if not exists public.sales_map_stock_movements (
 id uuid primary key default gen_random_uuid(),
 shift_id uuid not null references public.sales_map_shifts(id),
 seller_id uuid not null references auth.users(id),
 product text not null check(product in ('EL-001','MA-001','PR-001','KU-001')),
 qty integer not null check(qty>0),
 direction text not null check(direction in ('load','return')),
 created_at timestamptz not null default now(),
 -- A real MoySklad transfer must be implemented separately before warehouse stock is considered synced.
 moysklad_status text not null default 'not_synced'
);
create index if not exists sales_map_stock_movements_shift_idx on public.sales_map_stock_movements(shift_id);
alter table public.sales_map_shifts enable row level security;
alter table public.sales_map_vehicle_stock enable row level security;
alter table public.sales_map_stock_movements enable row level security;
drop policy if exists shifts_read on public.sales_map_shifts;
create policy shifts_read on public.sales_map_shifts for select to authenticated using (seller_id=auth.uid() or exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin'));
drop policy if exists vehicle_read on public.sales_map_vehicle_stock;
create policy vehicle_read on public.sales_map_vehicle_stock for select to authenticated using (seller_id=auth.uid() or exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin'));
drop policy if exists movements_read on public.sales_map_stock_movements;
create policy movements_read on public.sales_map_stock_movements for select to authenticated using (seller_id=auth.uid() or exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin'));
-- No direct INSERT/UPDATE/DELETE policies: writes only via locked SECURITY DEFINER RPC.
create or replace function public.sales_map_start_shift()
returns uuid language plpgsql security definer set search_path=public as $$
declare sid uuid; role_name text;
begin
 select role into role_name from public.user_profiles where user_id=auth.uid();
 if role_name not in ('seller','admin') then raise exception 'Access denied'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select id into sid from public.sales_map_shifts where seller_id=auth.uid() and ended_at is null;
 if sid is not null then return sid; end if;
 insert into public.sales_map_shifts(seller_id,seller_email) values(auth.uid(),coalesce(auth.jwt()->>'email','')) returning id into sid;
 return sid;
end $$;
create or replace function public.sales_map_move_stock(p_product text,p_qty integer,p_direction text)
returns integer language plpgsql security definer set search_path=public as $$
declare sid uuid; current_qty integer; new_qty integer;
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 if p_product not in ('EL-001','MA-001','PR-001','KU-001') or p_qty is null or p_qty<1 or p_qty>100000 or p_direction not in ('load','return') then raise exception 'Invalid movement'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select id into sid from public.sales_map_shifts where seller_id=auth.uid() and ended_at is null;
 if sid is null then raise exception 'Сначала выйдите на линию'; end if;
 insert into public.sales_map_vehicle_stock(seller_id,product,qty) values(auth.uid(),p_product,0) on conflict do nothing;
 select qty into current_qty from public.sales_map_vehicle_stock where seller_id=auth.uid() and product=p_product for update;
 new_qty:=current_qty+case when p_direction='load' then p_qty else -p_qty end;
 if new_qty<0 then raise exception 'Недостаточно товара в машине'; end if;
 update public.sales_map_vehicle_stock set qty=new_qty where seller_id=auth.uid() and product=p_product;
 insert into public.sales_map_stock_movements(shift_id,seller_id,product,qty,direction) values(sid,auth.uid(),p_product,p_qty,p_direction);
 return new_qty;
end $$;
create or replace function public.sales_map_finish_shift()
returns uuid language plpgsql security definer set search_path=public as $$
declare sid uuid;
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select id into sid from public.sales_map_shifts where seller_id=auth.uid() and ended_at is null for update;
 if sid is null then raise exception 'Нет активной смены'; end if;
 update public.sales_map_shifts set ended_at=now() where id=sid;
 return sid;
end $$;
-- Atomically record a sale and decrement seller vehicle stock when a shift is active.
-- If no shift is active, reject seller sales to prevent untracked vehicle stock.
create or replace function public.sales_map_shift_sale(p_id text,p_target_id text,p_product text,p_qty integer,p_price numeric,p_paid numeric)
returns void language plpgsql security definer set search_path=public as $$
declare sid uuid; current_qty integer;
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 if p_id is null or length(p_id)>120 or p_target_id is null or length(p_target_id)>120 or p_product not in ('EL-001','MA-001','PR-001','KU-001') or p_qty is null or p_qty<1 or p_price is null or p_price<0 or p_paid is null or p_paid<0 or p_paid>p_qty*p_price then raise exception 'Invalid sale'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select id into sid from public.sales_map_shifts where seller_id=auth.uid() and ended_at is null;
 if sid is null then raise exception 'Сначала нажмите «На линию»'; end if;
 insert into public.sales_map_vehicle_stock(seller_id,product,qty) values(auth.uid(),p_product,0) on conflict do nothing;
 select qty into current_qty from public.sales_map_vehicle_stock where seller_id=auth.uid() and product=p_product for update;
 if current_qty<p_qty then raise exception 'Недостаточно товара в машине'; end if;
 insert into public.sales_map_transactions(id,target_id,product,qty,price,paid,created_by,created_by_email)
 values(p_id,p_target_id,p_product,p_qty,p_price,p_paid,auth.uid(),coalesce(auth.jwt()->>'email',''));
 update public.sales_map_vehicle_stock set qty=qty-p_qty where seller_id=auth.uid() and product=p_product;
end $$;
revoke all on function public.sales_map_start_shift() from public;
revoke all on function public.sales_map_move_stock(text,integer,text) from public;
revoke all on function public.sales_map_finish_shift() from public;
revoke all on function public.sales_map_shift_sale(text,text,text,integer,numeric,numeric) from public;
grant execute on function public.sales_map_start_shift() to authenticated;
grant execute on function public.sales_map_move_stock(text,integer,text) to authenticated;
grant execute on function public.sales_map_finish_shift() to authenticated;
grant execute on function public.sales_map_shift_sale(text,text,text,integer,numeric,numeric) to authenticated;
