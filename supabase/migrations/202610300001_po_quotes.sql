-- Optional price-comparison note on a purchase order: up to a few typed
-- "supplier / total price" rows with one marked as chosen. Purely
-- informational - nothing reads it for money or stock, so it never blocks.
create table if not exists public.purchase_order_quotes (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id),
  supplier_name text not null,
  total_price numeric not null default 0,
  note text,
  is_chosen boolean not null default false,
  removed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_quotes_po_idx on public.purchase_order_quotes (purchase_order_id);

alter table public.purchase_order_quotes enable row level security;

create policy purchase_order_quotes_all on public.purchase_order_quotes
  for all to authenticated
  using (public._billing_current_role() in ('pm', 'admin'))
  with check (public._billing_current_role() in ('pm', 'admin'));

revoke all on public.purchase_order_quotes from anon;
grant select, insert, update on public.purchase_order_quotes to authenticated;
