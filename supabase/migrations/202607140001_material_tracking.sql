-- Material tracking: log-only expense ledger for material use per job.
--
-- Not a billing/approval workflow — foremen log actual material purchases
-- against the planned quantities from the BOQ, PM/admin see the variance.
-- No RPCs needed: every write here is a single-table insert/update/delete,
-- so there's nothing that needs to be atomic across tables.
--
-- Three tables:
--   material_types       - catalog (name, unit, current reference price)
--   boq_material_items   - planned materials per BOQ job (the "budget" side,
--                          manually typed in from the existing Excel BOQ)
--   material_usage_log   - foreman's actual entries per job_assignment (the
--                          "actual" side). unit_price_at_use is a SNAPSHOT of
--                          material_types.current_price at the time of
--                          logging - it must never be recomputed from the
--                          live catalog price, or historical spend on old
--                          plots would silently change whenever purchasing
--                          updates a price.
--
-- RLS: matches the existing "Allow all access" pattern already used on
-- boq_master / job_assignments / contractor_types / plots in this project -
-- access control for these tables is enforced in the TypeScript action layer
-- (requireModuleAccess / requireAuthRole), not via RLS policies. New tables
-- follow the same model for consistency with the rest of the schema.

-- ===========================================================================
-- material_types
-- ===========================================================================
create table if not exists public.material_types (
  id bigint generated always as identity primary key,
  name text not null unique,
  unit text not null default 'unit',
  current_price numeric not null default 0,
  price_updated_at timestamptz,
  price_updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.material_types enable row level security;

drop policy if exists "Allow all access" on public.material_types;
create policy "Allow all access" on public.material_types
  for all to public
  using (true)
  with check (true);

-- ===========================================================================
-- boq_material_items
-- ===========================================================================
-- The planned/budget side: materials + quantities expected for one BOQ job
-- (e.g. "Primer Painting 1F"), manually typed in from the existing Excel BOQ.
create table if not exists public.boq_material_items (
  id uuid primary key default gen_random_uuid(),
  boq_id uuid not null references public.boq_master(id) on delete cascade,
  material_type_id bigint not null references public.material_types(id),
  planned_quantity numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (boq_id, material_type_id)
);

create index if not exists boq_material_items_boq_id_idx on public.boq_material_items(boq_id);

alter table public.boq_material_items enable row level security;

drop policy if exists "Allow all access" on public.boq_material_items;
create policy "Allow all access" on public.boq_material_items
  for all to public
  using (true)
  with check (true);

-- ===========================================================================
-- material_usage_log
-- ===========================================================================
-- The actual side: what a foreman really bought/used for one job on one
-- specific plot (job_assignments row = a BOQ job instantiated on a plot).
create table if not exists public.material_usage_log (
  id uuid primary key default gen_random_uuid(),
  job_assignment_id uuid not null references public.job_assignments(id) on delete cascade,
  material_type_id bigint not null references public.material_types(id),
  quantity_used numeric not null,
  unit_price_at_use numeric not null default 0,
  purchase_date date not null default current_date,
  note text,
  photo_url text,
  logged_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists material_usage_log_job_assignment_id_idx on public.material_usage_log(job_assignment_id);

alter table public.material_usage_log enable row level security;

drop policy if exists "Allow all access" on public.material_usage_log;
create policy "Allow all access" on public.material_usage_log
  for all to public
  using (true)
  with check (true);
