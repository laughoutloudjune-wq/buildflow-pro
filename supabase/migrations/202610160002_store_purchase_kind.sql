-- Purchase type (MATERIAL_TRAIL_PLAN.md, Phase B - "what is this purchase for?").
--
-- Buying general stock (glass, sponges, brushes, bulk mirrors) used to mean
-- picking the bucket project "สโตร์กลาง (ไม่ระบุงาน)" out of the project list,
-- which nobody could guess. The PR and PO forms now ask the purpose first:
--   ใช้กับโครงการ/แปลง  -> projects.kind = 'development'
--   เติมสต็อกสโตร์       -> projects.kind = 'store' (exactly one project)
--   ค่าใช้จ่ายส่วนกลาง    -> projects.kind = 'overhead'
-- So the purpose needs no new column on purchase_requests / purchase_orders:
-- it is the kind of the project the document is saved against. The store
-- bucket simply becomes its own kind. Every existing filter in the app reads
-- kind = 'development', so moving it out of 'overhead' changes nothing there.

alter table public.projects drop constraint if exists projects_kind_check;
alter table public.projects
  add constraint projects_kind_check check (kind in ('development', 'overhead', 'store'));

update public.projects
set kind = 'store'
where id = '6412729d-1d42-4665-861f-7c195e589b70';

create unique index if not exists projects_single_store
  on public.projects ((true))
  where kind = 'store';

-- Store stock always unloads at the store. Receiving a store-stock line as
-- "ส่งตรงหน้างาน" would charge it to no plot and lose it from the store count.
create or replace function public._gri_store_stock_to_store()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_destination text;
begin
  select pr.kind, coalesce(new.destination, gr.default_destination)
  into v_kind, v_destination
  from public.purchase_order_items poi
  join public.purchase_orders po on po.id = poi.purchase_order_id
  join public.projects pr on pr.id = coalesce(poi.project_id, po.project_id)
  join public.goods_receipts gr on gr.id = new.goods_receipt_id
  where poi.id = new.purchase_order_item_id;

  if v_kind = 'store' and v_destination = 'site' then
    raise exception 'Store-stock items must be received into the store' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public._gri_store_stock_to_store() from public, anon, authenticated;

drop trigger if exists goods_receipt_items_store_stock_to_store on public.goods_receipt_items;
create trigger goods_receipt_items_store_stock_to_store
  before insert or update of destination on public.goods_receipt_items
  for each row execute function public._gri_store_stock_to_store();
