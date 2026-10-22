-- Run after moysklad_operations.sql. Server-side atomic claim; no MoySklad writes.
-- Only service_role can call this function; authenticated sellers cannot claim.
create or replace function public.sales_map_claim_transfer(p_operation_id uuid)
returns public.sales_map_moysklad_operations
language plpgsql security definer set search_path=public
as $$
declare v_op public.sales_map_moysklad_operations%rowtype;
begin
 if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
 select * into v_op from public.sales_map_moysklad_operations
 where id=p_operation_id for update;
 if not found then raise exception 'Operation not found'; end if;
 if v_op.status <> 'pending' then raise exception 'Operation not pending'; end if;
 -- Serialize all transfers involving this car, even across seller shifts.
 perform pg_advisory_xact_lock(hashtext('sales-map-car:'||v_op.vehicle_id));
 -- Prevent starting work for a shift that has already ended.
 if not exists(select 1 from public.sales_map_shifts s
  where s.id=v_op.shift_id and s.seller_id=v_op.seller_id
   and s.vehicle_id=v_op.vehicle_id and s.ended_at is null)
 then raise exception 'Shift no longer active'; end if;
 update public.sales_map_moysklad_operations
 set status='processing',updated_at=now(),last_error=null
 where id=v_op.id returning * into v_op;
 return v_op;
end $$;
revoke all on function public.sales_map_claim_transfer(uuid) from public,anon,authenticated;
grant execute on function public.sales_map_claim_transfer(uuid) to service_role;
-- A claimed operation must not be automatically reclaimed after timeout.
-- Reconcile MoySklad by stable external code before any retry.
