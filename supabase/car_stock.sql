-- Run AFTER vehicle_assignments.sql. Creates separate inventory per car.
-- No historical seller inventory is migrated automatically.
create table if not exists public.sales_map_car_stock (
 vehicle_id text not null references public.sales_map_vehicles(id),
 product text not null check(product in ('EL-001','MA-001','PR-001','KU-001')),
 qty integer not null default 0 check(qty>=0),
 primary key(vehicle_id,product)
);
alter table public.sales_map_car_stock enable row level security;
drop policy if exists sales_map_car_stock_read on public.sales_map_car_stock;
create policy sales_map_car_stock_read on public.sales_map_car_stock
 for select to authenticated using (
  exists(select 1 from public.sales_map_shifts s where s.vehicle_id=sales_map_car_stock.vehicle_id and s.seller_id=auth.uid() and s.ended_at is null)
  or exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin')
 );
insert into public.sales_map_car_stock(vehicle_id,product,qty)
select v.id,p.product,0
from public.sales_map_vehicles v
cross join (values ('EL-001'),('MA-001'),('PR-001'),('KU-001')) as p(product)
on conflict do nothing;
-- Stock cannot be edited directly from the browser. Future server-side
-- MoySklad-confirmed operations must write stock and an idempotency ledger.
-- Existing sales_map_shift_sale / sales_map_move_stock still use seller stock:
-- disable them for assigned vehicle shifts until replacement RPCs are deployed.
create or replace function public.sales_map_guard_legacy_vehicle_stock()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.sales_map_shifts where seller_id=auth.uid() and vehicle_id is not null and ended_at is null)
 then raise exception 'Операции машины ожидают подключения МойСклад'; end if;
 return new;
end $$;
-- Note: the application must also block legacy RPC calls for vehicle shifts.
