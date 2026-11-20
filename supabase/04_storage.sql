-- 04_storage.sql
-- Idempotent private evidence bucket scoped to <user-id>/... and administrators

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence',
  'evidence',
  false,
  52428800,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'audio/mpeg',
    'audio/wav',
    'audio/mp4',
    'audio/webm',
    'audio/ogg',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "evidence_upload_own_folder" on storage.objects;
create policy "evidence_upload_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
  and not public.is_admin()
  and lower(storage.extension(name)) = any(array[
    'pdf','png','jpg','jpeg','webp','txt','md','csv','zip','docx',
    'mp3','wav','m4a','webm','ogg','mp4','mov'
  ])
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
