-- 20261121000007_storage_policies.sql
-- Hardened private evidence storage bucket, path validation, and immutable submitted evidence protection.

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
  and not public.is_admin()
  and position('..' in name) = 0
  and coalesce(array_length(string_to_array(name, '/'), 1), 0) >= 2
  and (storage.foldername(name))[1] = auth.uid()::text
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

-- Disallow client overwrites of uploaded evidence objects
drop policy if exists "evidence_update_own_folder" on storage.objects;

-- Learners may only remove orphan uploads not referenced by any submission record; admins retain cleanup rights
drop policy if exists "evidence_delete_own_or_admin" on storage.objects;
create policy "evidence_delete_own_or_admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'evidence'
  and (
    public.is_admin()
    or (
      (storage.foldername(name))[1] = auth.uid()::text
      and not exists (
        select 1
        from public.submissions s
        where s.file_path = storage.objects.name
      )
    )
  )
);
