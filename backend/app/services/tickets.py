"""Ticket workflow (spec §5, §8, §9, §39-§42, §48).

All functions take a connection from app.core.db.user_scoped_connection, so
every read and write here is governed by Postgres RLS under the caller's own
JWT. None of the queries add organization filters of their own: RLS is the
tenant boundary, and a missing row is reported as 404 (decision #4).

The single privileged call is `privileged.allocate_ticket_number()`
(service_role, sequence allocation only - see app/core/privileged.py). The
ticket INSERT that uses the number runs on the user-scoped connection, so
RLS (tickets_insert) still decides whether the insert is allowed.

Callers own the transaction: they must hand off notifications via
app.services.notifications.commit_then_notify, which commits first.
"""

from __future__ import annotations

from typing import Any

import psycopg
from fastapi import HTTPException, status
from psycopg import sql

from app.api.routers._rows import row_as_dict, rows_as_dicts
from app.core import privileged
from app.core.security import Principal, Role
from app.domain import state_machine
from app.services.audit import write_audit

PAGE_SIZES = (25, 50, 100)

_TICKET_SELECT = """
    select t.id, t.ticket_number, t.organization_id, o.name as organization_name,
           t.subject, t.description, t.status, t.priority,
           t.category_id, c.name as category_name,
           t.assigned_to, au.name as assigned_to_name,
           t.created_by, cu.name as created_by_name,
           t.due_at, t.response_due_at, t.first_response_at, t.resolution_summary,
           t.resolved_at, t.closed_at, t.version, t.created_at, t.updated_at
    from tickets t
    left join organizations o on o.id = t.organization_id
    left join categories c on c.id = t.category_id
    left join users au on au.id = t.assigned_to
    left join users cu on cu.id = t.created_by
"""
# Note: the users joins are themselves RLS-filtered. A client cannot read
# internal staff rows (users_select), so assigned_to_name is null for
# clients - the frontend shows a generic "Clickfield AI team" label instead.


class _Now:
    """Sentinel: set a column to the database's now()."""


NOW = _Now()


def not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")


def fetch_ticket(conn: psycopg.Connection, ticket_id: str, *, for_update: bool = False) -> dict[str, Any]:
    query = _TICKET_SELECT + " where t.id = %s" + (" for update of t" if for_update else "")
    with conn.cursor() as cur:
        cur.execute(query, (ticket_id,))
        ticket = row_as_dict(cur)
    if ticket is None:
        raise not_found()
    return ticket


def list_tickets(
    conn: psycopg.Connection,
    *,
    page: int,
    page_size: int,
    status_filter: str | None,
    priority: str | None,
    assigned_to: str | None,
) -> dict[str, Any]:
    conditions: list[sql.Composable] = []
    params: list[Any] = []
    if status_filter:
        conditions.append(sql.SQL("t.status = %s"))
        params.append(status_filter)
    if priority:
        conditions.append(sql.SQL("t.priority = %s"))
        params.append(priority)
    if assigned_to == "unassigned":
        conditions.append(sql.SQL("t.assigned_to is null"))
    elif assigned_to:
        conditions.append(sql.SQL("t.assigned_to = %s"))
        params.append(assigned_to)
    where = sql.SQL(" where ") + sql.SQL(" and ").join(conditions) if conditions else sql.SQL("")

    with conn.cursor() as cur:
        cur.execute(sql.SQL("select count(*) from tickets t") + where, params)
        count_row = cur.fetchone()
        total = int(count_row[0]) if count_row else 0
        cur.execute(
            sql.SQL(_TICKET_SELECT) + where + sql.SQL(" order by t.created_at desc limit %s offset %s"),
            [*params, page_size, (page - 1) * page_size],
        )
        items = rows_as_dicts(cur)
    return {"items": items, "page": page, "page_size": page_size, "total": total}


def create_ticket(
    conn: psycopg.Connection,
    principal: Principal,
    *,
    subject: str,
    description: str,
    category_id: str,
    priority: str,
    ip_address: str | None,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("select id from categories where id = %s and is_active", (category_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown category")

    ticket_number = privileged.allocate_ticket_number()

    with conn.cursor() as cur:
        # organization_id / created_by come from the verified JWT (Principal),
        # never the request body; tickets_insert RLS re-checks both.
        cur.execute(
            """
            insert into tickets
              (ticket_number, organization_id, created_by, category_id, subject, description, priority)
            values (%s, %s, %s, %s, %s, %s, %s)
            returning id
            """,
            (
                ticket_number,
                principal.organization_id,
                principal.user_id,
                category_id,
                subject,
                description,
                priority,
            ),
        )
        row = cur.fetchone()
        assert row is not None
        ticket_id = str(row[0])

    write_audit(
        conn,
        ticket_id=ticket_id,
        user_id=principal.user_id,
        action="ticket_created",
        new_value={
            "ticket_number": ticket_number,
            "status": state_machine.OPEN,
            "priority": priority,
            "category_id": category_id,
        },
        ip_address=ip_address,
    )
    return fetch_ticket(conn, ticket_id)


def update_ticket(
    conn: psycopg.Connection,
    ticket_id: str,
    *,
    assignments: dict[str, Any],
    expected_version: int | None,
) -> None:
    """UPDATE a ticket. Column names are code-supplied literals only; values
    are always bound parameters. If `expected_version` is given, the update
    only applies to that version (optimistic concurrency, decision #6)."""
    set_parts: list[sql.Composable] = []
    params: list[Any] = []
    for column, value in assignments.items():
        if isinstance(value, _Now):
            set_parts.append(sql.SQL("{} = now()").format(sql.Identifier(column)))
        else:
            set_parts.append(sql.SQL("{} = %s").format(sql.Identifier(column)))
            params.append(value)
    query = sql.SQL("update tickets set {} where id = %s").format(sql.SQL(", ").join(set_parts))
    params.append(ticket_id)
    if expected_version is not None:
        query += sql.SQL(" and version = %s")
        params.append(expected_version)
    with conn.cursor() as cur:
        cur.execute(query, params)
        if cur.rowcount == 0:
            if expected_version is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Ticket was modified by someone else; reload and try again",
                )
            raise not_found()


def assert_transition(ticket: dict[str, Any], to_status: str, role: Role) -> None:
    try:
        state_machine.assert_transition_allowed(from_status=ticket["status"], to_status=to_status, role=role)
    except state_machine.IllegalTransition as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


def transition(
    conn: psycopg.Connection,
    principal: Principal,
    ticket: dict[str, Any],
    *,
    to_status: str,
    action: str,
    extra: dict[str, Any] | None = None,
    extra_new_value: dict[str, Any] | None = None,
    expected_version: int | None,
    ip_address: str | None,
) -> dict[str, Any]:
    """Validate via the state machine, update, and audit one status change."""
    assert_transition(ticket, to_status, principal.role)
    update_ticket(
        conn,
        str(ticket["id"]),
        assignments={"status": to_status, **(extra or {})},
        expected_version=expected_version,
    )
    write_audit(
        conn,
        ticket_id=str(ticket["id"]),
        user_id=principal.user_id,
        action=action,
        old_value={"status": ticket["status"]},
        new_value={"status": to_status, **(extra_new_value or {})},
        ip_address=ip_address,
    )
    return fetch_ticket(conn, str(ticket["id"]))


def assign(
    conn: psycopg.Connection,
    principal: Principal,
    ticket: dict[str, Any],
    *,
    assignee_id: str,
    set_in_progress: bool,
    expected_version: int | None,
    ip_address: str | None,
) -> dict[str, Any]:
    """Spec §39/§40: assign or reassign, optionally moving to IN_PROGRESS."""
    with conn.cursor() as cur:
        cur.execute("select role, status from users where id = %s", (assignee_id,))
        assignee = row_as_dict(cur)
    if (
        assignee is None
        or assignee["status"] != "ACTIVE"
        or assignee["role"] not in ("SUPER_ADMIN", "ADMIN", "TEAM_MEMBER")
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Assignee must be an active team member"
        )

    old_status = ticket["status"]
    new_status = old_status
    if old_status in (state_machine.OPEN, state_machine.TRIAGED, state_machine.REOPENED):
        assert_transition(ticket, state_machine.ASSIGNED, principal.role)
        new_status = state_machine.ASSIGNED
    if set_in_progress:
        assert_transition({"status": new_status}, state_machine.IN_PROGRESS, principal.role)
        new_status = state_machine.IN_PROGRESS

    assignments: dict[str, Any] = {"assigned_to": assignee_id}
    if new_status != old_status:
        assignments["status"] = new_status
    update_ticket(conn, str(ticket["id"]), assignments=assignments, expected_version=expected_version)

    old_assignee = str(ticket["assigned_to"]) if ticket["assigned_to"] else None
    write_audit(
        conn,
        ticket_id=str(ticket["id"]),
        user_id=principal.user_id,
        action="ticket_assigned" if old_assignee is None else "ticket_reassigned",
        old_value={"assigned_to": old_assignee, "status": old_status},
        new_value={"assigned_to": assignee_id, "status": new_status},
        ip_address=ip_address,
    )
    return fetch_ticket(conn, str(ticket["id"]))
