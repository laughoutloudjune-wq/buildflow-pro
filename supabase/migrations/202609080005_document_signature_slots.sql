-- Configurable signature sections for the three printed documents
-- (purchase request, purchase order, billing/DC slip). Each document type
-- owns an ordered list of slots; a slot can be a "system" one that the
-- renderer auto-fills with a real name/date from the document itself
-- (requester, reviewer, preparer, supplier), or a free-form custom one
-- (system_key null) that's just a label and an optional signature image for
-- someone to physically sign or that already carries a stored stamp.
--
-- Seeded to exactly match today's hardcoded boxes so existing documents look
-- unchanged until someone edits a slot from the new settings page.

create table if not exists public.document_signature_slots (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('purchase_request', 'purchase_order', 'billing')),
  position integer not null,
  label text not null,
  system_key text check (system_key in ('requester', 'reviewer', 'preparer', 'supplier')),
  signature_url text,
  created_at timestamptz not null default now(),
  unique (document_type, position)
);

insert into public.document_signature_slots (document_type, position, label, system_key) values
  ('purchase_request', 1, 'ผู้ขอซื้อ', 'requester'),
  ('purchase_request', 2, 'ผู้อนุมัติ', 'reviewer'),
  ('purchase_order', 1, 'ผู้จัดทำ', 'preparer'),
  ('purchase_order', 2, 'ผู้รับใบสั่งซื้อ', 'supplier'),
  ('billing', 1, 'ผู้เบิก / ผู้รับเหมา', null),
  ('billing', 2, 'โฟร์แมน / ผู้ตรวจงาน', null),
  ('billing', 3, 'ผู้อนุมัติจ่าย (เจ้าของ)', null)
on conflict (document_type, position) do nothing;
