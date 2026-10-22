-- Run after claim_moysklad_transfer.sql and car_stock.sql.
-- Server-only atomic confirmation AFTER verified MoySklad move document.
-- Never call from the browser. No MoySklad API calls happen here.
create or replace function public.sales_map_confirm_transfer(
 p_operation_id uuid, p_document_id uuid
) returns public.sales_map_moysklad_operations
language plpgsql security definer set search_path=public
as $$
declare v_op public.sales_map_moysklad_operations%rowtype;
declare v_qty integer;
begin
 if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
 if p_operation_id is null or p_document_id is null then raise exception 'Missing document ID'; end if;
 select * into v_op from public.sales_map_moysklad_operations
 where id=p_operation_id for update;
 if not found then raise exception 'Operation not found'; end if;
 if v_op.status='succeeded' then
  if v_op.moysklad_document_id=p_document_id then return v_op; end if;
  raise exception 'Operation already confirmed with different document';
 end if;
 if v_op.status not in ('processing','reconciliation_needed')
 then raise exception 'Operation is not ready for confirmation'; end if;
 if exists(select 1 from public.sales_map_moysklad_operations
  where moysklad_document_id=p_document_id and id<>p_operation_id)
 then raise exception 'Document already linked to another operation'; end if;
 -- This row lock is held through stock mutation and status update.
 select qty into v_qty from public.sales_map_car_stock
 where vehicle_id=v_op.vehicle_id and product=v_op.product for update;
 if not found then raise exception 'Vehicle stock row missing'; end if;
 if v_op.direction='return' and v_qty<v_op.qty then
  raise exception 'Local vehicle stock requires reconciliation before return confirmation';
 end if;
 update public.sales_map_car_stock
 set qty=qty + case when v_op.direction='load' then v_op.qty else -v_op.qty end
 where vehicle_id=v_op.vehicle_id and product=v_op.product;
 update public.sales_map_moysklad_operations
 set status='succeeded',moysklad_document_id=p_document_id,
  last_error=null,updated_at=now()
 where id=p_operation_id returning * into v_op;
 return v_op;
end $$;
revoke all on function public.sales_map_confirm_transfer(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sales_map_confirm_transfer(uuid,uuid) to service_role;
-- Note: the server must verify MoySklad document's product, qty,
-- source/destination warehouse and operation externalCode before invoking.
-- Do not invoke on uncertain outcomes; reconcile first.
