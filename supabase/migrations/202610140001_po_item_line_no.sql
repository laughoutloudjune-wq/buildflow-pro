-- PO lines had no stored order, so editing a PO reshuffled them (an in-place
-- UPDATE moves the row in storage and the unordered read followed it).
-- Give every line a line_no. New lines are numbered by a trigger in insert
-- order, which is the order po_create / po_update loop over the payload, so
-- the RPCs need no change: a created PO keeps its typed order, and a line
-- added during an edit goes to the end.

alter table public.purchase_order_items add column if not exists line_no integer;

-- Backfill: current physical order is what users have been seeing.
with numbered as (
  select id, row_number() over (partition by purchase_order_id order by ctid) as n
  from public.purchase_order_items
)
update public.purchase_order_items poi
set line_no = numbered.n
from numbered
where numbered.id = poi.id and poi.line_no is null;

create or replace function public._po_item_assign_line_no()
returns trigger
language plpgsql
as $$
begin
  if new.line_no is null then
    select coalesce(max(line_no), 0) + 1 into new.line_no
    from public.purchase_order_items
    where purchase_order_id = new.purchase_order_id;
  end if;
  return new;
end;
$$;

drop trigger if exists po_item_assign_line_no on public.purchase_order_items;
create trigger po_item_assign_line_no
  before insert on public.purchase_order_items
  for each row execute function public._po_item_assign_line_no();

create index if not exists purchase_order_items_po_line_idx
  on public.purchase_order_items (purchase_order_id, line_no);
