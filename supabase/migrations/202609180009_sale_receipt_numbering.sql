-- The Supabase JS client's .upsert() can't express an atomic increment (it
-- replaces the conflicting row with the literal values passed, so a naive
-- upsert({counter: 1}, {onConflict: 'receipt_date'}) resets the counter to 1
-- on every call instead of incrementing it - caught this in the action code
-- before it shipped, not after). Every other counter in this app
-- (purchase_order_number_counters, goods_receipt_number_counters, and this
-- migration's own sales_work_request_number_counters) does the increment in
-- SQL via `insert ... on conflict do update set counter = counter + 1
-- returning counter`, which IS atomic - so receipt numbering gets the same
-- one-line RPC rather than trying to force the JS client to do it.
create or replace function public.sale_receipt_next_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_seq int;
begin
  if v_role not in ('admin','pm','sales') then
    raise exception 'Only sales/PM/admin can issue a receipt number' using errcode = '42501';
  end if;

  insert into public.sale_receipt_number_counters (receipt_date, counter)
  values (current_date, 1)
  on conflict (receipt_date) do update set counter = sale_receipt_number_counters.counter + 1
  returning counter into v_seq;

  return 'RC-' || to_char(current_date, 'YYYYMMDD') || lpad(v_seq::text, 3, '0');
end;
$$;

revoke all on function public.sale_receipt_next_number() from public;
revoke all on function public.sale_receipt_next_number() from anon;
grant execute on function public.sale_receipt_next_number() to authenticated;
