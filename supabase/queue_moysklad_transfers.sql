-- Run AFTER moysklad_operations.sql and vehicle_assignments.sql.
-- Queue only: DOES NOT post documents to MoySklad or change stock.
create or replace function public.sales_map_queue_transfer(
 p_idempotency_key uuid, p_product text, p_qty integer, p_direction text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid := auth.uid(); v_shift public.sales_map_shifts%rowtype;
 v_old public.sales_map_moysklad_operations%rowtype; v_id uuid;
begin
 if v_user is null then raise exception 'Not authenticated'; end if;
 if p_idempotency_key is null or p_product not in ('EL-001','MA-001','PR-001','KU-001')
    or p_qty is null or p_qty not between 1 and 100000
    or p_direction not in ('load','return') then raise exception 'Invalid transfer'; end if;
 perform pg_advisory_xact_lock(hashtext(v_user::text));
 select * into v_shift from public.sales_map_shifts
 where seller_id=v_user and ended_at is null for update;
 if not found or v_shift.vehicle_id is null then raise exception 'Сначала выберите машину и начните смену'; end if;
 select * into v_old from public.sales_map_moysklad_operations where idempotency_key=p_idempotency_key;
 if found then
  if v_old.seller_id<>v_user or v_old.vehicle_id<>v_shift.vehicle_id
    or v_old.product<>p_product or v_old.qty<>p_qty or v_old.direction<>p_direction
  then raise exception 'Idempotency key already used for different operation'; end if;
  return v_old.id;
 end if;
 insert into public.sales_map_moysklad_operations
 (idempotency_key,shift_id,seller_id,vehicle_id,product,qty,direction,status)
 values(p_idempotency_key,v_shift.id,v_user,v_shift.vehicle_id,p_product,p_qty,p_direction,'pending')
 returning id into v_id;
 return v_id;
end $$;
revoke all on function public.sales_map_queue_transfer(uuid,text,integer,text) from public;
grant execute on function public.sales_map_queue_transfer(uuid,text,integer,text) to authenticated;
-- Server worker will process pending operations only after validated MoySklad
-- posting, idempotency, reconciliation and inventory update logic is deployed.
