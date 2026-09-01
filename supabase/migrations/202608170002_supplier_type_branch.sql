-- Adds supplier type (company vs individual) and Thai tax branch code, to
-- match how a real Thai supplier record is filled in (see PO screen design
-- reference). No existing data to migrate - suppliers is a brand-new table
-- from 202608170001_procurement.sql with no production rows yet.

alter table public.suppliers add column if not exists supplier_type text not null default 'company'
  check (supplier_type in ('company', 'individual'));

alter table public.suppliers add column if not exists branch_code text;
