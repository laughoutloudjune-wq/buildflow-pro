-- Promotions become "bundles" of individually-priced free items (June,
-- 2026-09-24) instead of one name + one discount value - a real promotion
-- is things like "free 4 aircons (worth X) + a furnished house (worth Y)",
-- and sales negotiates per deal (add/remove/reprice items on top of
-- whichever bundle(s) they started from, or type in something ad-hoc with
-- no bundle at all). No real promotions or plot_sales.promotion_id values
-- exist yet (shipped same day), so this is a clean redesign, not a
-- migration of real data.

-- Catalog-level items belonging to a bundle template.
create table public.promotion_items (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  name text not null,
  value numeric not null default 0 check (value >= 0),
  created_at timestamptz not null default now()
);

-- Per-deal item instances - what a specific sale actually gets, seeded
-- (copied) from a bundle's promotion_items when applied, then freely
-- edited/added/removed per deal since sales negotiates individually.
-- source_promotion_id is null for anything sales typed in ad-hoc.
create table public.plot_sale_promotion_items (
  id uuid primary key default gen_random_uuid(),
  plot_sale_id uuid not null references public.plot_sales(id) on delete cascade,
  source_promotion_id uuid references public.promotions(id) on delete set null,
  name text not null,
  value numeric not null default 0 check (value >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

-- The old single "one promotion per sale" FK is superseded by the items
-- table above (a deal's promo picture is whatever items exist for it, from
-- one bundle, several bundles, ad-hoc entries, or a mix).
alter table public.plot_sales drop column promotion_id;

-- Bundle-level discount fields are superseded by summing promotion_items.
alter table public.promotions drop column discount_type;
alter table public.promotions drop column discount_value;

alter table public.promotion_items enable row level security;
alter table public.plot_sale_promotion_items enable row level security;

create policy promotion_items_select on public.promotion_items for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','sales']));
create policy promotion_items_write on public.promotion_items for all to authenticated
  using (_billing_current_role() = any (array['admin','sales']))
  with check (_billing_current_role() = any (array['admin','sales']));

create policy plot_sale_promotion_items_select on public.plot_sale_promotion_items for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','sales']));
create policy plot_sale_promotion_items_write on public.plot_sale_promotion_items for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','sales']))
  with check (_billing_current_role() = any (array['admin','pm','sales']));
