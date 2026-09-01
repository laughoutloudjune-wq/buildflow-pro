-- Per-company approving signature.
--
-- companies.logo_url already existed, but the PO document's signature was
-- still read from the single organization_settings row - so every buying
-- company printed the same approver, which is wrong once you issue POs in
-- the name of more than one entity.
--
-- Nullable with a fallback rather than NOT NULL: companies that haven't had
-- a signature uploaded keep using the organization-level one, so this
-- changes nothing for existing data until a signature is actually set.

alter table public.companies
  add column if not exists signature_url text;

comment on column public.companies.signature_url is
  'Approving signature image for POs issued by this company. Falls back to organization_settings.signature_url when null.';
