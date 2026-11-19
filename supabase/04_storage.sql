-- 04_storage.sql
-- Idempotent private evidence bucket scoped to <user-id>/... and administrators

insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;

drop policy if exists "evidence_upload_own_folder" on storage.objects;
create policy "evidence_upload_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
  and not public.is_admin()
);

drop policy if exists "evidence_read_own_or_admin" on storage.objects;
create policy "evidence_read_own_or_admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "evidence_delete_own_or_admin" on storage.objects;
create policy "evidence_delete_own_or_admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);
