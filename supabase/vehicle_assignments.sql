-- Run after seller_shifts.sql. Vehicle stock belongs to a vehicle, not to a seller.
-- This migration adds assignment only; legacy seller-stock RPCs MUST be replaced before enabling MoySklad writes.
create table if not exists public.sales_map_vehicles (
 id text primary key check (id in ('vehicle-1','vehicle-2','vehicle-3')),
 name text not null unique,
 moysklad_store_name text not null unique,
 created_at timestamptz not null default now()
);
insert into public.sales_map_vehicles(id,name,moysklad_store_name) values
 ('vehicle-1','Машина №1','Машина №1'),
 ('vehicle-2','Машина №2','Машина №2'),
 ('vehicle-3','Машина №3','Машина №3')
on conflict(id) do nothing;
alter table public.sales_map_shifts add column if not exists vehicle_id text references public.sales_map_vehicles(id);
create unique index if not exists sales_map_one_open_shift_per_vehicle
 on public.sales_map_shifts(vehicle_id) where ended_at is null and vehicle_id is not null;
alter table public.sales_map_vehicles enable row level security;
drop policy if exists sales_map_vehicles_read on public.sales_map_vehicles;
create policy sales_map_vehicles_read on public.sales_map_vehicles for select to authenticated using(true);
-- Assignment is allowed only for a seller's own active shift.
-- The old start_shift() RPC must not be used for new shifts once vehicle selection is enabled.
create or replace function public.sales_map_start_vehicle_shift(p_vehicle_id text)
returns uuid language plpgsql security definer set search_path=public as $$
declare sid uuid; existing_vehicle text; role_name text;
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 select role into role_name from public.user_profiles where user_id=auth.uid();
 if role_name not in ('seller','admin') then raise exception 'Access denied'; end if;
 if not exists(select 1 from public.sales_map_vehicles where id=p_vehicle_id) then raise exception 'Неизвестная машина'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 perform pg_advisory_xact_lock(hashtext('vehicle:'||p_vehicle_id));
 select id,vehicle_id into sid,existing_vehicle from public.sales_map_shifts where seller_id=auth.uid() and ended_at is null;
 if sid is not null then
  if existing_vehicle is distinct from p_vehicle_id then raise exception 'Сначала завершите текущую смену'; end if;
  return sid;
 end if;
 if exists(select 1 from public.sales_map_shifts where vehicle_id=p_vehicle_id and ended_at is null) then raise exception 'Машина уже занята другим продавцом'; end if;
 insert into public.sales_map_shifts(seller_id,seller_email,vehicle_id)
 values(auth.uid(),coalesce(auth.jwt()->>'email',''),p_vehicle_id) returning id into sid;
 return sid;
end $$;
revoke all on function public.sales_map_start_vehicle_shift(text) from public;
grant execute on function public.sales_map_start_vehicle_shift(text) to authenticated;
-- Existing sales_map_vehicle_stock is keyed by seller_id. Do not migrate historical quantities
-- automatically: they cannot be reliably attributed to a specific car.
-- Next migration must implement vehicle-keyed inventory, server-side MoySklad documents,
-- idempotency and reconciliation before enabling write operations.
