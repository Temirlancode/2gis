-- Run after vehicle_assignments.sql and car_stock.sql.
-- Prevent legacy seller-based stock mutations while an assigned vehicle shift is active.
-- These triggers also protect against direct calls to the old SECURITY DEFINER RPCs.
create or replace function public.sales_map_reject_legacy_vehicle_mutation()
returns trigger language plpgsql security definer set search_path=public as $$
declare actor uuid;
begin
 actor := auth.uid();
 if actor is not null and exists (
  select 1 from public.sales_map_shifts s
  where s.seller_id=actor and s.vehicle_id is not null and s.ended_at is null
 ) then
  raise exception 'Операции с выбранной машиной пока не подключены к МойСклад. Действие отменено.';
 end if;
 return new;
end $$;

drop trigger if exists sales_map_guard_old_vehicle_stock on public.sales_map_vehicle_stock;
create trigger sales_map_guard_old_vehicle_stock
 before insert or update or delete on public.sales_map_vehicle_stock
 for each row execute function public.sales_map_reject_legacy_vehicle_mutation();

drop trigger if exists sales_map_guard_old_movements on public.sales_map_stock_movements;
create trigger sales_map_guard_old_movements
 before insert on public.sales_map_stock_movements
 for each row execute function public.sales_map_reject_legacy_vehicle_mutation();

-- The legacy sale RPC inserts a positive-quantity transaction before decrementing
-- seller stock. Guard it explicitly, while leaving debt payments (qty=0) possible.
create or replace function public.sales_map_reject_legacy_vehicle_sale()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.qty>0 and auth.uid() is not null and exists (
  select 1 from public.sales_map_shifts s
  where s.seller_id=auth.uid() and s.vehicle_id is not null and s.ended_at is null
 ) then
  raise exception 'Продажа с выбранной машины пока не подключена к МойСклад. Действие отменено.';
 end if;
 return new;
end $$;
drop trigger if exists sales_map_guard_old_sale on public.sales_map_transactions;
create trigger sales_map_guard_old_sale
 before insert on public.sales_map_transactions
 for each row execute function public.sales_map_reject_legacy_vehicle_sale();
