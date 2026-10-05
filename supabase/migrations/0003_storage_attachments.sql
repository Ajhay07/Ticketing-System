-- Clickfield AI Ticketing System
-- Migration 0003: private Storage bucket for ticket attachments + storage.objects RLS
-- Spec refs: §12 (attachments, 25 MB limit, allowed types), §31 (private buckets,
-- signed URLs, access validation), decision #1 (no service_role for normal ops).
--
-- Design: the backend asks Supabase Storage for signed upload/download URLs
-- using the CALLER'S OWN JWT, never the service_role key. Storage enforces
-- RLS on storage.objects when signing, so the policies below decide whether
-- the URL can be issued at all. They defer entirely to public.ticket_attachments
-- RLS (0002_rls.sql): the subqueries run as the calling role, so an object is
-- only readable if the caller can see its metadata row, and only uploadable
-- by the user who created that metadata row. Internal-comment attachments and
-- cross-tenant objects are therefore denied by the same rules that hide the
-- metadata rows.
--
-- The bucket-level file_size_limit / allowed_mime_types are a second,
-- storage-side enforcement of the limits the API already validates before
-- issuing any signed URL (app/services/attachments.py).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  false,
  26214400, -- 25 MB
  array[
    'image/png',
    'image/jpeg',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy ticket_attachments_objects_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and exists (
      select 1 from public.ticket_attachments a
      where a.storage_path = storage.objects.name
    )
  );

create policy ticket_attachments_objects_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'ticket-attachments'
    and exists (
      select 1 from public.ticket_attachments a
      where a.storage_path = storage.objects.name
        and a.uploaded_by = auth.uid()
    )
  );

-- No UPDATE / DELETE policies: objects are never overwritten or removed by
-- normal application roles (soft delete happens on the metadata row).
