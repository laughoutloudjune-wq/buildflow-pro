-- New feature: a reusable promotion catalog for the sales plot-detail page
-- (June, 2026-09-24) - a named, priced promotion (e.g. "โปรโมชั่นเปิดตัว -5%")
-- that a deal can be tagged with, instead of only the free-text
-- discount_note that already existed on plot_sales. One promotion per deal
-- (plot_sales.promotion_id, nullable) - discount_note stays as-is for
-- anything one-off that doesn't fit the catalog.
--
-- Managed by admin AND sales (June's explicit choice - not just admin, the
-- way sale_statuses is) - readable by admin/pm/sales, matching every other
-- sales table's RLS shape from Phase 6.

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  discount_type text not null default 'amount' check (discount_type in ('percent','amount')),
  discount_value numeric not null default 0 check (discount_value >= 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plot_sales add column promotion_id uuid references public.promotions(id) on delete set null;

alter table public.promotions enable row level security;

create policy promotions_select on public.promotions for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','sales']));
create policy promotions_write on public.promotions for all to authenticated
  using (_billing_current_role() = any (array['admin','sales']))
  with check (_billing_current_role() = any (array['admin','sales']));
