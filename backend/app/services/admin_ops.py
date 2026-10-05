"""CTO operations read models (spec §13-§18, §35-§38, decision #5).

Every query here runs on the caller's user-scoped connection
(app.core.db.user_scoped_connection), so Postgres RLS still decides which
rows are counted. The routers in app/api/routers/admin_ops.py additionally
restrict every endpoint to SUPER_ADMIN / ADMIN. Nothing here uses
service_role.

Status buckets used throughout (spec §13 "OPEN / IN PROGRESS / WAITING
CLIENT / OVERDUE / RESOLVED TODAY"):
  open     = OPEN, TRIAGED, ASSIGNED, REOPENED (not yet being worked)
  active   = every status except RESOLVED / CLOSED
"Today" / "this month" boundaries are computed in the database session's
time zone (UTC on Supabase).
"""

from __future__ import annotations

import re
from typing import Any

import psycopg

from app.api.routers._rows import row_as_dict, rows_as_dicts
from app.services import tickets as ticket_service

OPEN_STATUSES = "('OPEN', 'TRIAGED', 'ASSIGNED', 'REOPENED')"
ACTIVE = "t.status not in ('RESOLVED', 'CLOSED')"
OVERDUE = "(t.due_at is not null and t.due_at < now() and t.status not in ('RESOLVED', 'CLOSED'))"
STAFF_ROLES = "('SUPER_ADMIN', 'ADMIN', 'TEAM_MEMBER')"

_TICKET_COUNTS = f"""
    count(t.id) filter (where t.status in {OPEN_STATUSES}) as open,
    count(t.id) filter (where t.status = 'IN_PROGRESS') as in_progress,
    count(t.id) filter (where t.status = 'WAITING_FOR_CLIENT') as waiting_for_client,
    count(t.id) filter (where {OVERDUE}) as overdue
"""


def dashboard(conn: psycopg.Connection) -> dict[str, Any]:
    """Spec §13: top-level metrics, priority queue, recent tickets."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            select {_TICKET_COUNTS},
                   count(t.id) filter (where t.resolved_at >= date_trunc('day', now())) as resolved_today,
                   count(t.id) filter (where t.assigned_to is null and {ACTIVE}) as unassigned
            from tickets t
            """  # noqa: S608 - only code literals are interpolated
        )
        metrics = row_as_dict(cur) or {}
        cur.execute(f"select t.priority, count(*) from tickets t where {ACTIVE} group by t.priority")  # noqa: S608
        by_priority = {str(p): int(n) for p, n in cur.fetchall()}
    priority_queue = [
        {"priority": p, "count": by_priority.get(p, 0)} for p in ("CRITICAL", "HIGH", "MEDIUM", "LOW")
    ]
    recent = ticket_service.list_tickets(
        conn, page=1, page_size=25, status_filter=None, priority=None, assigned_to=None, sort="newest"
    )["items"][:10]
    return {
        "metrics": {k: int(v) for k, v in metrics.items()},
        "priority_queue": priority_queue,
        "recent_tickets": recent,
    }


def team_workload(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """Spec §16. Returns ONLY id, display name, role and counts for each
    active staff member - no email or other personal data."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            select u.id, u.name, u.role, {_TICKET_COUNTS},
                   count(t.id) filter (where {ACTIVE}) as active_total
            from users u
            left join tickets t on t.assigned_to = u.id
            where u.role in {STAFF_ROLES} and u.status = 'ACTIVE'
            group by u.id, u.name, u.role
            order by u.name
            """  # noqa: S608
        )
        return rows_as_dicts(cur)


def list_clients(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """Spec §18, §38: client organizations with user + ticket counts."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            select o.id, o.name, o.slug, o.status, o.created_at,
                   (select count(*) from users u where u.organization_id = o.id and u.status = 'ACTIVE')
                     as active_users,
                   {_TICKET_COUNTS},
                   count(t.id) filter (where t.resolved_at >= date_trunc('month', now()))
                     as resolved_this_month,
                   count(t.id) as total_tickets
            from organizations o
            left join tickets t on t.organization_id = o.id
            where not o.is_internal
            group by o.id
            order by o.name
            """  # noqa: S608
        )
        return rows_as_dicts(cur)


def client_detail(conn: psycopg.Connection, organization_id: str) -> dict[str, Any] | None:
    """Spec §38: one client's metrics, users and recent ticket history."""
    clients = [c for c in list_clients(conn) if str(c["id"]) == organization_id]
    if not clients:
        return None
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, name, email, role, status, created_at
            from users where organization_id = %s order by name
            """,
            (organization_id,),
        )
        users = rows_as_dicts(cur)
    recent = ticket_service.list_tickets(
        conn,
        page=1,
        page_size=25,
        status_filter=None,
        priority=None,
        assigned_to=None,
        organization_id=organization_id,
        sort="newest",
    )
    return {"organization": clients[0], "users": users, "recent_tickets": recent["items"]}


_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:60] or "client"


def valid_slug(slug: str) -> bool:
    return bool(_SLUG_RE.match(slug)) and len(slug) <= 60


def reports(conn: psycopg.Connection, *, days: int) -> dict[str, Any]:
    """Spec §37 basic V1 reporting. `days` bounds the resolution window."""
    window = (days,)
    with conn.cursor() as cur:
        volume: dict[str, list[dict[str, Any]]] = {}
        for unit, span in (("day", "30 days"), ("week", "12 weeks"), ("month", "12 months")):
            cur.execute(
                f"""
                select date_trunc('{unit}', t.created_at) as period, count(*) as tickets
                from tickets t
                where t.created_at >= date_trunc('{unit}', now()) - interval '{span}'
                group by 1 order by 1
                """  # noqa: S608 - unit/span are code literals
            )
            volume[unit] = rows_as_dicts(cur)

        cur.execute(
            """
            select
              round(avg(extract(epoch from (t.first_response_at - t.created_at)) / 60)
                    filter (where t.first_response_at is not null))::int as avg_response_minutes,
              round(avg(extract(epoch from (t.resolved_at - t.created_at)) / 60)
                    filter (where t.resolved_at is not null))::int as avg_resolution_minutes,
              count(*) filter (where t.resolved_at is not null) as tickets_resolved
            from tickets t
            where t.created_at >= now() - make_interval(days => %s)
            """,
            window,
        )
        resolution = row_as_dict(cur) or {}
        cur.execute(
            """
            select count(*) from audit_logs a
            join tickets t on t.id = a.ticket_id
            where a.action = 'ticket_reopened' and a.created_at >= now() - make_interval(days => %s)
            """,
            window,
        )
        reopened_row = cur.fetchone()
        resolution["tickets_reopened"] = int(reopened_row[0]) if reopened_row else 0

        cur.execute(
            f"""
            select o.id, o.name, count(t.id) as total_tickets,
                   count(t.id) filter (where {ACTIVE}) as open_tickets,
                   count(t.id) filter (where {OVERDUE}) as overdue_tickets
            from organizations o
            left join tickets t on t.organization_id = o.id
            where not o.is_internal
            group by o.id, o.name
            order by total_tickets desc, o.name
            """  # noqa: S608
        )
        by_client = rows_as_dicts(cur)

        cur.execute(
            f"""
            select u.id, u.name, count(t.id) as tickets_assigned,
                   count(t.id) filter (where t.resolved_at is not null) as tickets_resolved,
                   count(t.id) filter (where {ACTIVE}) as open_workload,
                   round(avg(extract(epoch from (t.resolved_at - t.created_at)) / 60)
                         filter (where t.resolved_at is not null))::int as avg_resolution_minutes
            from users u
            left join tickets t on t.assigned_to = u.id
            where u.role in {STAFF_ROLES} and u.status = 'ACTIVE'
            group by u.id, u.name
            order by u.name
            """  # noqa: S608
        )
        by_team = rows_as_dicts(cur)
    return {
        "days": days,
        "volume": volume,
        "resolution": resolution,
        "by_client": by_client,
        "by_team": by_team,
    }


def audit_log_page(
    conn: psycopg.Connection, *, page: int, page_size: int, ticket_id: str | None, action: str | None
) -> dict[str, Any]:
    """Admin audit viewer (spec §24). RLS (audit_logs_select) still applies."""
    conditions = []
    params: list[Any] = []
    if ticket_id:
        conditions.append("a.ticket_id = %s")
        params.append(ticket_id)
    if action:
        conditions.append("a.action = %s")
        params.append(action)
    where = (" where " + " and ".join(conditions)) if conditions else ""
    with conn.cursor() as cur:
        cur.execute("select count(*) from audit_logs a" + where, params)  # noqa: S608
        row = cur.fetchone()
        total = int(row[0]) if row else 0
        cur.execute(
            """
            select a.id, a.ticket_id, t.ticket_number, a.user_id, u.name as actor_name, a.action,
                   a.old_value, a.new_value, a.metadata, a.ip_address, a.created_at
            from audit_logs a
            left join tickets t on t.id = a.ticket_id
            left join users u on u.id = a.user_id
            """
            + where
            + " order by a.created_at desc, a.id limit %s offset %s",  # noqa: S608
            [*params, page_size, (page - 1) * page_size],
        )
        items = rows_as_dicts(cur)
    return {"items": items, "page": page, "page_size": page_size, "total": total}
