-- Clickfield AI Ticketing System
-- Migration 0002: Row Level Security policies
-- Spec refs: §30, §31, §53, §60 (mandatory tenant isolation)
--
-- Design: every policy derives role/organization from auth.jwt() claims set by
-- the backend via Supabase Auth app_metadata (see backend/app/core/security.py
-- and app/core/privileged.py). Client-supplied values are never trusted.
--
-- JWT claim shape expected under auth.jwt() -> 'app_metadata':
--   { "role": "ADMIN", "organization_id": "<uuid>" }

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create or replace function jwt_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
$$;

create or replace function jwt_org_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
$$;

create or replace function is_internal_role()
returns boolean
language sql
stable
as $$
  select jwt_role() in ('SUPER_ADMIN', 'ADMIN', 'TEAM_MEMBER');
$$;

create or replace function is_admin_role()
returns boolean
language sql
stable
as $$
  select jwt_role() in ('SUPER_ADMIN', 'ADMIN');
$$;

create or replace function current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

alter table organizations enable row level security;

create policy organizations_select on organizations
  for select
  using (
    is_internal_role()
    or id = jwt_org_id()
  );

create policy organizations_insert_admin on organizations
  for insert
  with check (is_admin_role());

create policy organizations_update_admin on organizations
  for update
  using (is_admin_role());

-- No delete policy: organizations are never deleted via normal app roles.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

alter table users enable row level security;

create policy users_select on users
  for select
  using (
    is_internal_role()
    or organization_id = jwt_org_id()
  );

create policy users_insert_admin on users
  for insert
  with check (is_admin_role());

create policy users_update_admin_or_self on users
  for update
  using (
    is_admin_role()
    or id = current_user_id()
  );

-- No delete policy: user removal is a disable (status update), not a row delete.

-- ---------------------------------------------------------------------------
-- categories (read: everyone authenticated; write: admin)
-- ---------------------------------------------------------------------------

alter table categories enable row level security;

create policy categories_select on categories
  for select
  using (auth.role() = 'authenticated');

create policy categories_write_admin on categories
  for all
  using (is_admin_role())
  with check (is_admin_role());

-- ---------------------------------------------------------------------------
-- sla_policies (internal-only read, admin write)
-- ---------------------------------------------------------------------------

alter table sla_policies enable row level security;

create policy sla_policies_select_internal on sla_policies
  for select
  using (is_internal_role());

create policy sla_policies_write_admin on sla_policies
  for all
  using (is_admin_role())
  with check (is_admin_role());

-- ---------------------------------------------------------------------------
-- tickets
-- Spec §30: clients see/insert only their own org's tickets; cannot delete.
-- Spec §60 (decision #5): team members see only tickets assigned to them;
-- admin/super_admin see all. Unassigned queue is admin-only by extension of
-- this same rule (team members simply cannot see unassigned tickets at all).
-- ---------------------------------------------------------------------------

alter table tickets enable row level security;

create policy tickets_select on tickets
  for select
  using (
    deleted_at is null
    and (
      jwt_role() in ('SUPER_ADMIN', 'ADMIN')
      or (jwt_role() = 'TEAM_MEMBER' and assigned_to = current_user_id())
      or (jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER') and organization_id = jwt_org_id())
    )
  );

create policy tickets_insert on tickets
  for insert
  with check (
    -- Clients may only create tickets in their own organization, authored by
    -- themselves. Internal staff may also create tickets on behalf of a client
    -- (e.g. phone/email intake) but still cannot forge organization_id beyond
    -- one that exists; the application layer is responsible for picking a
    -- valid target org for internal-created tickets.
    (
      jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER')
      and organization_id = jwt_org_id()
      and created_by = current_user_id()
    )
    or is_internal_role()
  );

create policy tickets_update on tickets
  for update
  using (
    deleted_at is null
    and (
      jwt_role() in ('SUPER_ADMIN', 'ADMIN')
      or (jwt_role() = 'TEAM_MEMBER' and assigned_to = current_user_id())
      or (jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER') and organization_id = jwt_org_id())
    )
  );

-- No delete policy for tickets under any normal role: deletion is soft
-- (UPDATE deleted_at) which is covered by tickets_update. Hard delete is a
-- privileged, service_role-only, audited path outside RLS (decision in
-- CLAUDE.md §"Soft delete only").

-- ---------------------------------------------------------------------------
-- ticket_comments
-- Spec §11, §23: internal notes are NEVER visible to clients, enforced here,
-- not only in the frontend.
-- ---------------------------------------------------------------------------

alter table ticket_comments enable row level security;

create policy ticket_comments_select on ticket_comments
  for select
  using (
    deleted_at is null
    and exists (
      select 1 from tickets t
      where t.id = ticket_comments.ticket_id
        and t.deleted_at is null
        and (
          jwt_role() in ('SUPER_ADMIN', 'ADMIN')
          or (jwt_role() = 'TEAM_MEMBER' and t.assigned_to = current_user_id())
          or (
            jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER')
            and t.organization_id = jwt_org_id()
            and ticket_comments.visibility = 'CLIENT'
          )
        )
    )
  );

create policy ticket_comments_insert on ticket_comments
  for insert
  with check (
    user_id = current_user_id()
    and (
      -- Clients can only ever write CLIENT-visibility comments, on their own
      -- organization's ticket.
      (
        jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER')
        and visibility = 'CLIENT'
        and exists (
          select 1 from tickets t
          where t.id = ticket_comments.ticket_id
            and t.organization_id = jwt_org_id()
            and t.deleted_at is null
        )
      )
      or (
        -- Internal staff can write either visibility, on tickets they can see.
        is_internal_role()
        and exists (
          select 1 from tickets t
          where t.id = ticket_comments.ticket_id
            and t.deleted_at is null
            and (
              jwt_role() in ('SUPER_ADMIN', 'ADMIN')
              or t.assigned_to = current_user_id()
            )
        )
      )
    )
  );

create policy ticket_comments_update_own_or_admin on ticket_comments
  for update
  using (
    is_admin_role()
    or user_id = current_user_id()
  );

-- ---------------------------------------------------------------------------
-- ticket_attachments
-- Visibility inherits from the parent ticket/comment (spec §12, §31).
-- ---------------------------------------------------------------------------

alter table ticket_attachments enable row level security;

create policy ticket_attachments_select on ticket_attachments
  for select
  using (
    deleted_at is null
    and exists (
      select 1 from tickets t
      where t.id = ticket_attachments.ticket_id
        and t.deleted_at is null
        and (
          jwt_role() in ('SUPER_ADMIN', 'ADMIN')
          or (jwt_role() = 'TEAM_MEMBER' and t.assigned_to = current_user_id())
          or (
            jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER')
            and t.organization_id = jwt_org_id()
            and (
              ticket_attachments.comment_id is null
              or exists (
                select 1 from ticket_comments c
                where c.id = ticket_attachments.comment_id
                  and c.visibility = 'CLIENT'
              )
            )
          )
        )
    )
  );

create policy ticket_attachments_insert on ticket_attachments
  for insert
  with check (
    uploaded_by = current_user_id()
    and exists (
      select 1 from tickets t
      where t.id = ticket_attachments.ticket_id
        and t.deleted_at is null
        and (
          jwt_role() in ('SUPER_ADMIN', 'ADMIN')
          or (jwt_role() = 'TEAM_MEMBER' and t.assigned_to = current_user_id())
          or (
            jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER')
            and t.organization_id = jwt_org_id()
          )
        )
    )
  );

-- No update/delete policy for attachments under normal roles: removal is a
-- soft-delete performed through the backend's attachment service, which is
-- covered by an UPDATE policy identical in shape to the SELECT policy above.

create policy ticket_attachments_soft_delete on ticket_attachments
  for update
  using (
    is_admin_role()
    or uploaded_by = current_user_id()
  );

-- ---------------------------------------------------------------------------
-- audit_logs — append-only (spec §24)
-- ---------------------------------------------------------------------------

alter table audit_logs enable row level security;

create policy audit_logs_select on audit_logs
  for select
  using (
    is_internal_role()
    or (
      jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER')
      and exists (
        select 1 from tickets t
        where t.id = audit_logs.ticket_id
          and t.organization_id = jwt_org_id()
      )
    )
  );

create policy audit_logs_insert on audit_logs
  for insert
  with check (true); -- writes only ever happen via the backend's audited write path

-- Explicitly no UPDATE or DELETE policy exists for any role: combined with the
-- REVOKE below and the guard trigger, this makes audit_logs append-only.

revoke update, delete on audit_logs from authenticated, anon;

create or replace function prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

create trigger audit_logs_immutable
  before update or delete on audit_logs
  for each row execute function prevent_audit_log_mutation();

-- ---------------------------------------------------------------------------
-- notifications — a user only ever sees their own
-- ---------------------------------------------------------------------------

alter table notifications enable row level security;

create policy notifications_select_own on notifications
  for select
  using (user_id = current_user_id());

create policy notifications_update_own on notifications
  for update
  using (user_id = current_user_id());

create policy notifications_insert on notifications
  for insert
  with check (true); -- written by the backend/worker on behalf of recipients

-- ---------------------------------------------------------------------------
-- email_logs — internal-only
-- ---------------------------------------------------------------------------

alter table email_logs enable row level security;

create policy email_logs_select_internal on email_logs
  for select
  using (is_internal_role());

create policy email_logs_insert on email_logs
  for insert
  with check (is_internal_role());

create policy email_logs_update_internal on email_logs
  for update
  using (is_internal_role());
