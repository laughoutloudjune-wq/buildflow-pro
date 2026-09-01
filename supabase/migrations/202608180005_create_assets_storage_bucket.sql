-- The 'assets' bucket that organization + company logo/signature uploads
-- have always written to was never actually created, so every upload failed
-- with "Bucket not found". This affected the existing organization settings
-- upload too, not just the newer per-company one - the code in
-- actions/settings-actions.ts even carries a "// Assumes a bucket named
-- 'assets'" comment, and that assumption was never true.
--
-- Public read because the generated PO document embeds these URLs directly
-- and Puppeteer fetches them without a session; writes stay authenticated.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assets',
  'assets',
  true,
  2097152,
  array['image/png','image/jpeg','image/jpg','image/webp','image/svg+xml','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "assets_public_read" on storage.objects;
create policy "assets_public_read"
  on storage.objects for select
  using (bucket_id = 'assets');

drop policy if exists "assets_authenticated_insert" on storage.objects;
create policy "assets_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'assets');

drop policy if exists "assets_authenticated_update" on storage.objects;
create policy "assets_authenticated_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'assets')
  with check (bucket_id = 'assets');

drop policy if exists "assets_authenticated_delete" on storage.objects;
create policy "assets_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'assets');
