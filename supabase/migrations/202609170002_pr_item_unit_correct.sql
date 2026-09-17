-- pr_update refuses to edit a request once it's past pending_review, on
-- purpose - once approved, the ask itself must not quietly change (see
-- requestQuantities.ts: "the ask never moves"). But a line's UNIT can be
-- wrong for a reason that has nothing to do with the ask: every line created
-- before 202609170001 gave requests their own editable unit silently
-- inherited the material's catalog (purchasing) unit, which for small
-- hardware is the wrong word entirely (e.g. "แพ๊ค" on a line the foreman
-- meant as pieces) - see PR-0023. There was no way to fix that afterwards,
-- since the whole request is locked.
--
-- Correcting the label isn't the same as rewriting the ask - the quantity on
-- the line never changes here, only what unit it's understood to be in.
-- Scoped narrowly on purpose: pm/admin only, this one column, callable
-- regardless of request status (pending_review already has the full edit
-- form for this; approved/ordered/received are exactly the statuses that
-- otherwise have no path to fix a wrong unit at all).
create or replace function public.pr_item_unit_correct(p_item_id uuid, p_unit text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_unit text := nullif(btrim(coalesce(p_unit, '')), '');
  v_pr_id uuid;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can correct a request line unit' using errcode = '42501';
  end if;
  if v_unit is null then
    raise exception 'A unit is required' using errcode = '22023';
  end if;

  update public.purchase_request_items
  set unit = v_unit
  where id = p_item_id
  returning purchase_request_id into v_pr_id;

  if v_pr_id is null then
    raise exception 'Purchase request line not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', p_item_id, 'purchase_request_id', v_pr_id, 'unit', v_unit);
end;
$$;

revoke all on function public.pr_item_unit_correct(uuid, text) from public;
revoke all on function public.pr_item_unit_correct(uuid, text) from anon;
grant execute on function public.pr_item_unit_correct(uuid, text) to authenticated;
