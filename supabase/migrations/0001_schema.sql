-- Clickfield AI Ticketing System
-- Migration 0001: core schema, enums, tables, indexes
-- Spec refs: docs/Clickfield_AI_Ticketing_System_Documentation.md §27, §29, §49

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type user_role as enum (
  'SUPER_ADMIN',
  'ADMIN',
  'TEAM_MEMBER',
  'CLIENT_ADMIN',
  'CLIENT_USER'
);

create type ticket_priority as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

create type ticket_status as enum (
  'OPEN',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_FOR_CLIENT',
  'RESOLVED',
  'CLOSED',
  'REOPENED'
);

create type comment_visibility as enum ('CLIENT', 'INTERNAL');

create type notification_type as enum (
  'TICKET_ASSIGNED',
  'CLIENT_REPLY',
  'TICKET_OVERDUE',
  'TICKET_RESOLVED',
  'TICKET_STATUS_CHANGED',
  'TICKET_CLOSED',
  'TICKET_REOPENED',
  'NEW_TICKET'
);

create type email_notification_type as enum (
  'NEW_TICKET',
  'TICKET_ASSIGNED',
  'CLIENT_REPLY',
  'STATUS_CHANGED',
  'TICKET_RESOLVED',
  'TICKET_CLOSED'
);

create type email_status as enum ('PENDING', 'SENT', 'FAILED');

-- ---------------------------------------------------------------------------
-- organizations  (spec §27, §4, §18)
-- ---------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  is_internal boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column organizations.is_internal is
  'True only for the single Clickfield AI internal organization that holds staff users (decision #3).';

-- Enforce at most one internal organization.
create unique index organizations_single_internal_idx
  on organizations ((is_internal))
  where is_internal;

-- ---------------------------------------------------------------------------
-- users  (profile table mirroring auth.users; spec §27, §28, §29)
-- ---------------------------------------------------------------------------

create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references organizations (id),
  name text not null,
  email text not null unique,
  role user_role not null,
  avatar_url text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_organization_id_idx on users (organization_id);
create index users_role_idx on users (role);

-- ---------------------------------------------------------------------------
-- categories (spec §7, §27)
-- ---------------------------------------------------------------------------

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- sla_policies (spec §25 — configurable SLA per priority)
-- ---------------------------------------------------------------------------

create table sla_policies (
  priority ticket_priority primary key,
  response_minutes integer not null,
  resolution_minutes integer not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tickets (spec §27, §5, §6, §8, §25, §41, §44, §45)
-- ---------------------------------------------------------------------------

create table tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  organization_id uuid not null references organizations (id),
  created_by uuid not null references users (id),
  assigned_to uuid references users (id),
  category_id uuid references categories (id),
  subject text not null,
  description text not null,
  priority ticket_priority not null default 'MEDIUM',
  status ticket_status not null default 'OPEN',
  resolution_summary text,
  response_due_at timestamptz,
  first_response_at timestamptz,
  due_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  deleted_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column tickets.version is
  'Optimistic concurrency token (decision #6). Incremented on every update; clients must send the version they read.';
comment on column tickets.deleted_at is
  'Soft delete marker (spec §44, decision #6). Normal roles never hard-delete tickets.';
comment on column tickets.resolution_summary is
  'What was done to resolve the ticket (spec §41), set when status moves to RESOLVED.';
comment on column tickets.response_due_at is
  'SLA response deadline, derived from sla_policies at creation time (decision #6).';
comment on column tickets.first_response_at is
  'Timestamp of the first team/admin reply, used to evaluate response SLA (decision #6).';

create index tickets_organization_id_idx on tickets (organization_id);
create index tickets_status_idx on tickets (status);
create index tickets_priority_idx on tickets (priority);
create index tickets_assigned_to_idx on tickets (assigned_to);
create index tickets_created_at_idx on tickets (created_at);
create index tickets_updated_at_idx on tickets (updated_at);
create index tickets_due_at_idx on tickets (due_at);
create index tickets_org_status_priority_idx on tickets (organization_id, status, priority);
create index tickets_not_deleted_idx on tickets (organization_id) where deleted_at is null;

-- ticket_number sequence + generator (spec §8: CF-000001, permanent, never reused)
create sequence ticket_number_seq start 1;

create or replace function next_ticket_number()
returns text
language plpgsql
as $$
declare
  n bigint;
begin
  n := nextval('ticket_number_seq');
  return 'CF-' || lpad(n::text, 6, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- ticket_comments (spec §11, §23, §27)
-- ---------------------------------------------------------------------------

create table ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  user_id uuid not null references users (id),
  comment text not null,
  visibility comment_visibility not null default 'CLIENT',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ticket_comments_ticket_id_idx on ticket_comments (ticket_id);
create index ticket_comments_user_id_idx on ticket_comments (user_id);
create index ticket_comments_visibility_idx on ticket_comments (visibility);

-- ---------------------------------------------------------------------------
-- ticket_attachments (spec §12, §27, §31)
-- ---------------------------------------------------------------------------

create table ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  comment_id uuid references ticket_comments (id) on delete cascade,
  uploaded_by uuid not null references users (id),
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  file_size bigint not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index ticket_attachments_ticket_id_idx on ticket_attachments (ticket_id);
create index ticket_attachments_comment_id_idx on ticket_attachments (comment_id);

-- ---------------------------------------------------------------------------
-- audit_logs (spec §24 — append-only)
-- ---------------------------------------------------------------------------

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets (id),
  user_id uuid references users (id),
  action text not null,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create index audit_logs_ticket_id_idx on audit_logs (ticket_id);
create index audit_logs_user_id_idx on audit_logs (user_id);
create index audit_logs_created_at_idx on audit_logs (created_at);

-- ---------------------------------------------------------------------------
-- notifications (spec §26, §27)
-- ---------------------------------------------------------------------------

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  ticket_id uuid references tickets (id),
  type notification_type not null,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_idx on notifications (user_id);
create index notifications_user_unread_idx on notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- email_logs (spec §20, §27, §46)
-- ---------------------------------------------------------------------------

create table email_logs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets (id),
  recipient text not null,
  notification_type email_notification_type not null,
  provider text not null default 'resend',
  status email_status not null default 'PENDING',
  provider_message_id text,
  error_message text,
  attempt_count integer not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index email_logs_ticket_id_idx on email_logs (ticket_id);
create index email_logs_status_idx on email_logs (status);

-- ---------------------------------------------------------------------------
-- updated_at maintenance trigger (generic)
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on organizations
  for each row execute function set_updated_at();
create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();
create trigger tickets_set_updated_at before update on tickets
  for each row execute function set_updated_at();
create trigger ticket_comments_set_updated_at before update on ticket_comments
  for each row execute function set_updated_at();

-- tickets.version bump on every update (optimistic concurrency, decision #6)
create or replace function bump_ticket_version()
returns trigger
language plpgsql
as $$
begin
  new.version = old.version + 1;
  return new;
end;
$$;

create trigger tickets_bump_version before update on tickets
  for each row execute function bump_ticket_version();
