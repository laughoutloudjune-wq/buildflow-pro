-- Global approver signature image, embedded into generated PO PDFs.
alter table public.organization_settings add column if not exists signature_url text;
