-- Clickfield AI Ticketing System
-- Migration 0004: soft-delete fix + update-policy hardening
-- Spec refs: §30, §44 (soft delete only), §53, §60. CLAUDE.md rules 4, 6, 9.
--
-- Problem (found in Phase 2): `tickets_update` (0002) had only a USING clause,
-- which Postgres reuses as WITH CHECK. USING requires `deleted_at is null`,
-- so setting deleted_at always failed WITH CHECK. Additionally, Postgres
-- checks the NEW row of an UPDATE against the table's SELECT policies when
-- the statement reads the table (any WHERE clause). `tickets_select` hides
-- soft-deleted rows, so even with a corrected WITH CHECK a plain
-- `update tickets set deleted_at = now() where id = ...` under a user JWT is
-- rejected. The SELECT policies are deliberately left untouched (soft-deleted
-- rows must stay invisible), so soft delete goes through narrowly-scoped
-- SECURITY DEFINER functions below that perform their own authorization.
--
-- This migration:
--   1. Recreates the UPDATE policies on tickets / ticket_comments /
--      ticket_attachments / users / notifications with SEPARATE USING and
--      WITH CHECK clauses. Who may update which row is unchanged (or
--      narrowed); nothing is broadened.
--   2. Adds BEFORE UPDATE guard triggers enforcing immutable columns
--      (organization_id, ticket_id, authorship, storage paths, identity
--      columns) - WITH CHECK cannot compare old vs new values, a trigger can.
--   3. Adds soft_delete_ticket / soft_delete_comment / soft_delete_attachment.
--   4. Resurrection rule (decision, one line): only SUPER_ADMIN/ADMIN or a
--      non-JWT maintenance role (service_role / postgres) may clear a
--      deleted_at; since SELECT policies hide deleted rows, in practice
--      restore is a manual service-role operation.
--
-- Do not edit 0001-0003; this file is forward-only.

-- ---------------------------------------------------------------------------
-- Helper: is the current statement running under a non-JWT maintenance role?
-- (service_role used by app/core/privileged.py, or the migration owner).
-- Inside the SECURITY DEFINER functions below current_user is the function
-- owner, but those functions perform their own authorization first.
-- ---------------------------------------------------------------------------

create or replace function is_maintenance_role()
returns boolean
language sql
stable
as $$
  select current_user not in ('authenticated', 'anon');
$$;

-- ---------------------------------------------------------------------------
-- tickets
-- ---------------------------------------------------------------------------

drop policy if exists tickets_update on tickets;

create policy tickets_update on tickets
  for update
  -- Which existing rows may be touched: exactly the 0002 rule.
  using (
    deleted_at is null
    and (
      jwt_role() in ('SUPER_ADMIN', 'ADMIN')
      or (jwt_role() = 'TEAM_MEMBER' and assigned_to = current_user_id())
      or (jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER') and organization_id = jwt_org_id())
    )
  )
  -- What the resulting row may look like: same role/assignment/tenant rules.
  -- Only admins may produce a soft-deleted row (spec §44: clients cannot
  -- delete, §30); a team member must still be the assignee afterwards and a
  -- client's row must stay in their own organization.
  with check (
    jwt_role() in ('SUPER_ADMIN', 'ADMIN')
    or (
      deleted_at is null
      and (
        (jwt_role() = 'TEAM_MEMBER' and assigned_to = current_user_id())
        or (jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER') and organization_id = jwt_org_id())
      )
    )
  );

create or replace function guard_ticket_update()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'tickets.organization_id is immutable' using errcode = '42501';
  end if;
  if new.ticket_number is distinct from old.ticket_number
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'tickets identity columns are immutable' using errcode = '42501';
  end if;

  -- Soft delete / resurrection: admin or maintenance role only.
  if new.deleted_at is distinct from old.deleted_at
     and not (is_admin_role() or is_maintenance_role()) then
    raise exception 'not permitted to change tickets.deleted_at' using errcode = '42501';
  end if;

  -- Clients (incl. direct PostgREST access with their own JWT) may only drive
  -- their own lifecycle actions: close, reopen, "I've replied" (spec §41,
  -- §42). They can never change assignment, priority, content, SLA fields.
  if jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER') and not is_maintenance_role() then
    if new.assigned_to is distinct from old.assigned_to
       or new.priority is distinct from old.priority
       or new.category_id is distinct from old.category_id
       or new.subject is distinct from old.subject
       or new.description is distinct from old.description
       or new.resolution_summary is distinct from old.resolution_summary
       or new.due_at is distinct from old.due_at
       or new.response_due_at is distinct from old.response_due_at
       or new.first_response_at is distinct from old.first_response_at then
      raise exception 'clients may not change these ticket fields' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('CLOSED', 'REOPENED', 'IN_PROGRESS') then
      raise exception 'clients may not set this status' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_guard_update on tickets;
create trigger tickets_guard_update
  before update on tickets
  for each row execute function guard_ticket_update();

-- ---------------------------------------------------------------------------
-- ticket_comments
-- 0002 had USING (admin or author) reused as WITH CHECK. No deleted_at in it
-- (so no soft-delete bug), but nothing stopped an author re-pointing the row
-- at another ticket or a client flipping visibility. Fixed here.
-- ---------------------------------------------------------------------------

drop policy if exists ticket_comments_update_own_or_admin on ticket_comments;

create policy ticket_comments_update_own_or_admin on ticket_comments
  for update
  using (
    is_admin_role()
    or user_id = current_user_id()
  )
  with check (
    is_admin_role()
    or (
      user_id = current_user_id()
      and deleted_at is null
      and exists (
        select 1 from tickets t
        where t.id = ticket_comments.ticket_id
          and t.deleted_at is null
          and (
            (jwt_role() = 'TEAM_MEMBER' and t.assigned_to = current_user_id())
            or (
              jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER')
              and t.organization_id = jwt_org_id()
              and ticket_comments.visibility = 'CLIENT'
            )
          )
      )
    )
  );

create or replace function guard_comment_update()
returns trigger
language plpgsql
as $$
begin
  if new.ticket_id is distinct from old.ticket_id
     or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'ticket_comments identity columns are immutable' using errcode = '42501';
  end if;
  if new.visibility is distinct from old.visibility
     and not (is_admin_role() or is_maintenance_role()) then
    raise exception 'not permitted to change comment visibility' using errcode = '42501';
  end if;
  if old.deleted_at is not null and new.deleted_at is null
     and not (is_admin_role() or is_maintenance_role()) then
    raise exception 'not permitted to restore a deleted comment' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_comments_guard_update on ticket_comments;
create trigger ticket_comments_guard_update
  before update on ticket_comments
  for each row execute function guard_comment_update();

-- ---------------------------------------------------------------------------
-- ticket_attachments
-- ---------------------------------------------------------------------------

drop policy if exists ticket_attachments_soft_delete on ticket_attachments;

create policy ticket_attachments_soft_delete on ticket_attachments
  for update
  using (
    is_admin_role()
    or uploaded_by = current_user_id()
  )
  with check (
    is_admin_role()
    or uploaded_by = current_user_id()
  );

create or replace function guard_attachment_update()
returns trigger
language plpgsql
as $$
begin
  if new.ticket_id is distinct from old.ticket_id
     or new.comment_id is distinct from old.comment_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.storage_path is distinct from old.storage_path
     or new.file_name is distinct from old.file_name
     or new.mime_type is distinct from old.mime_type
     or new.file_size is distinct from old.file_size
     or new.created_at is distinct from old.created_at then
    raise exception 'ticket_attachments columns other than deleted_at are immutable'
      using errcode = '42501';
  end if;
  if old.deleted_at is not null and new.deleted_at is null
     and not (is_admin_role() or is_maintenance_role()) then
    raise exception 'not permitted to restore a deleted attachment' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_attachments_guard_update on ticket_attachments;
create trigger ticket_attachments_guard_update
  before update on ticket_attachments
  for each row execute function guard_attachment_update();

-- ---------------------------------------------------------------------------
-- users: self-updates may never change role / organization / status / email.
-- (Authorization reads role/org from JWT app_metadata, set only via the
-- service-role Admin API, so this is defence in depth against a misleading
-- profile row, e.g. a client writing role = 'ADMIN' via PostgREST.)
-- ---------------------------------------------------------------------------

drop policy if exists users_update_admin_or_self on users;

create policy users_update_admin_or_self on users
  for update
  using (
    is_admin_role()
    or id = current_user_id()
  )
  with check (
    is_admin_role()
    or id = current_user_id()
  );

create or replace function guard_user_update()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'users.id is immutable' using errcode = '42501';
  end if;
  if not (is_admin_role() or is_maintenance_role()) then
    if new.role is distinct from old.role
       or new.organization_id is distinct from old.organization_id
       or new.status is distinct from old.status
       or new.email is distinct from old.email then
      raise exception 'not permitted to change role, organization, status or email'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists users_guard_update on users;
create trigger users_guard_update
  before update on users
  for each row execute function guard_user_update();

-- ---------------------------------------------------------------------------
-- notifications: a user may only mark their own notifications read.
-- ---------------------------------------------------------------------------

drop policy if exists notifications_update_own on notifications;

create policy notifications_update_own on notifications
  for update
  using (user_id = current_user_id())
  with check (user_id = current_user_id());

create or replace function guard_notification_update()
returns trigger
language plpgsql
as $$
begin
  if not is_maintenance_role() and (
       new.user_id is distinct from old.user_id
       or new.ticket_id is distinct from old.ticket_id
       or new.type is distinct from old.type
       or new.title is distinct from old.title
       or new.message is distinct from old.message
       or new.created_at is distinct from old.created_at) then
    raise exception 'only notifications.read_at may be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_guard_update on notifications;
create trigger notifications_guard_update
  before update on notifications
  for each row execute function guard_notification_update();

-- ---------------------------------------------------------------------------
-- Soft-delete functions (SECURITY DEFINER, own authorization, fixed
-- search_path). They exist because the SELECT policies (intentionally) hide
-- soft-deleted rows, which makes a plain UPDATE that soft-deletes fail RLS.
-- Each returns true if a row was soft-deleted, false if not found / already
-- deleted / not visible to the caller (callers map false -> 404).
-- ---------------------------------------------------------------------------

create or replace function soft_delete_ticket(p_ticket_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Spec §44: archive/soft delete is an admin (CTO / super admin) action.
  if not is_admin_role() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update tickets set deleted_at = now()
   where id = p_ticket_id and deleted_at is null;
  return found;
end;
$$;

create or replace function soft_delete_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Admin, or the author while they can still see the parent ticket under
  -- the same rules as ticket_comments_select.
  update ticket_comments c set deleted_at = now()
   where c.id = p_comment_id
     and c.deleted_at is null
     and (
       is_admin_role()
       or (
         c.user_id = current_user_id()
         and exists (
           select 1 from tickets t
           where t.id = c.ticket_id
             and t.deleted_at is null
             and (
               (jwt_role() = 'TEAM_MEMBER' and t.assigned_to = current_user_id())
               or (
                 jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER')
                 and t.organization_id = jwt_org_id()
                 and c.visibility = 'CLIENT'
               )
             )
         )
       )
     );
  return found;
end;
$$;

create or replace function soft_delete_attachment(p_attachment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update ticket_attachments a set deleted_at = now()
   where a.id = p_attachment_id
     and a.deleted_at is null
     and (
       is_admin_role()
       or (
         a.uploaded_by = current_user_id()
         and exists (
           select 1 from tickets t
           where t.id = a.ticket_id
             and t.deleted_at is null
             and (
               (jwt_role() = 'TEAM_MEMBER' and t.assigned_to = current_user_id())
               or (jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER') and t.organization_id = jwt_org_id())
             )
         )
       )
     );
  return found;
end;
$$;

revoke all on function soft_delete_ticket(uuid) from public, anon;
revoke all on function soft_delete_comment(uuid) from public, anon;
revoke all on function soft_delete_attachment(uuid) from public, anon;
grant execute on function soft_delete_ticket(uuid) to authenticated, service_role;
grant execute on function soft_delete_comment(uuid) to authenticated, service_role;
grant execute on function soft_delete_attachment(uuid) to authenticated, service_role;
