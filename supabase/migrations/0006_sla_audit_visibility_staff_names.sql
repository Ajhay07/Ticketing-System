-- Clickfield AI Ticketing System
-- Migration 0006: SLA deadlines, audit-log visibility tightening, and a
-- minimal staff first-name projection for clients.
-- Spec refs: §10, §11, §24, §25, decision #5.

-- ---------------------------------------------------------------------------
-- 1. SLA deadlines (spec §25, basic V1 tracking - no business hours).
-- On INSERT, and whenever priority changes, derive response_due_at / due_at
-- from sla_policies relative to created_at. SECURITY DEFINER because
-- sla_policies is readable only by internal roles (0002) and tickets are
-- inserted under the client's own JWT. Reads one row; writes nothing else.
-- Overdue tickets are never auto-closed (spec §25).
-- ---------------------------------------------------------------------------

create or replace function apply_ticket_sla()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p sla_policies%rowtype;
  base timestamptz;
begin
  if tg_op = 'INSERT' or new.priority is distinct from old.priority then
    select * into p from sla_policies where priority = new.priority;
    if found then
      base := coalesce(new.created_at, now());
      if tg_op = 'INSERT' or new.response_due_at is not distinct from old.response_due_at then
        new.response_due_at := base + make_interval(mins => p.response_minutes);
      end if;
      -- An explicit due date set in the same UPDATE (CTO "set due dates",
      -- spec §3.2) wins over the recomputed SLA deadline.
      if tg_op = 'INSERT' or new.due_at is not distinct from old.due_at then
        new.due_at := base + make_interval(mins => p.resolution_minutes);
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_apply_sla on tickets;
create trigger tickets_apply_sla
  before insert or update of priority on tickets
  for each row execute function apply_ticket_sla();

-- ---------------------------------------------------------------------------
-- 2. audit_logs visibility (spec §11, §24, decision #5).
-- 0002 let every internal role read every audit row, and let clients read
-- every row on their org's tickets - including "internal_note_added" rows
-- and audit rows for attachments on internal notes. New rule:
--   * SUPER_ADMIN / ADMIN: all rows.
--   * TEAM_MEMBER: rows on tickets currently assigned to them, or rows they
--     wrote themselves (same population as ticket visibility, decision #5).
--   * Clients: rows on their own org's (non-deleted) tickets, EXCEPT
--     internal-only events (internal notes, anything tagged
--     metadata.internal = true by the application).
-- Privileged rows (ticket_id null, e.g. user provisioning) are admin-only.
-- ---------------------------------------------------------------------------

drop policy if exists audit_logs_select on audit_logs;

create policy audit_logs_select on audit_logs
  for select
  using (
    jwt_role() in ('SUPER_ADMIN', 'ADMIN')
    or (
      jwt_role() = 'TEAM_MEMBER'
      and (
        user_id = current_user_id()
        or exists (
          select 1 from tickets t
          where t.id = audit_logs.ticket_id
            and t.assigned_to = current_user_id()
        )
      )
    )
    or (
      jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER')
      and action <> 'internal_note_added'
      and coalesce(metadata ->> 'internal', 'false') <> 'true'
      and exists (
        select 1 from tickets t
        where t.id = audit_logs.ticket_id
          and t.organization_id = jwt_org_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Staff first-name projection for clients (spec §10 shows "Assigned To:
-- Arjun" and staff replies attributed to "ARJUN" in the client-facing
-- conversation). users_select (0002) correctly hides staff rows from
-- clients; these two functions expose ONLY split_part(name, ' ', 1) of a
-- staff member, and only for a ticket/comment the caller can already see
-- under the same rules as the SELECT policies. No email, role, id lookup by
-- arbitrary user id, or any other staff column is exposed.
-- ---------------------------------------------------------------------------

create or replace function ticket_assignee_first_name(p_ticket_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select split_part(u.name, ' ', 1)
  from tickets t
  join users u on u.id = t.assigned_to
  where t.id = p_ticket_id
    and t.deleted_at is null
    and u.role in ('SUPER_ADMIN', 'ADMIN', 'TEAM_MEMBER')
    and (
      jwt_role() in ('SUPER_ADMIN', 'ADMIN')
      or (jwt_role() = 'TEAM_MEMBER' and t.assigned_to = current_user_id())
      or (jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER') and t.organization_id = jwt_org_id())
    );
$$;

create or replace function comment_author_first_name(p_comment_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select split_part(u.name, ' ', 1)
  from ticket_comments c
  join tickets t on t.id = c.ticket_id
  join users u on u.id = c.user_id
  where c.id = p_comment_id
    and c.deleted_at is null
    and t.deleted_at is null
    and u.role in ('SUPER_ADMIN', 'ADMIN', 'TEAM_MEMBER')
    and (
      jwt_role() in ('SUPER_ADMIN', 'ADMIN')
      or (jwt_role() = 'TEAM_MEMBER' and t.assigned_to = current_user_id())
      or (
        jwt_role() in ('CLIENT_ADMIN', 'CLIENT_USER')
        and t.organization_id = jwt_org_id()
        and c.visibility = 'CLIENT'
      )
    );
$$;

revoke all on function ticket_assignee_first_name(uuid) from public, anon;
revoke all on function comment_author_first_name(uuid) from public, anon;
grant execute on function ticket_assignee_first_name(uuid) to authenticated, service_role;
grant execute on function comment_author_first_name(uuid) to authenticated, service_role;
