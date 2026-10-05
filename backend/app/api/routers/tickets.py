"""Ticket endpoints (spec §5, §9, §10, §39-§42, §48).

Authorization is enforced in three independent layers:
  1. get_current_principal + app.domain.permissions (here),
  2. app.domain.state_machine for every status change (app/services/tickets.py),
  3. Postgres RLS, because every query runs on get_db's user-scoped
     connection under the caller's own JWT.

None of the SQL filters by organization_id itself: RLS is the tenant
boundary, so an unfiltered `where id = %s` returns nothing for a ticket the
caller may not see, which is reported as 404 (decision #4) - never 403, and
never with any of the ticket's data.

Every state-changing endpoint commits its change + audit row FIRST and only
then hands off notifications (app.services.notifications.commit_then_notify),
which can never fail the request (CLAUDE.md rule 10).
"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, StringConstraints

from app.api.deps import client_ip, get_current_principal, get_db
from app.core.security import Principal
from app.domain import permissions, state_machine
from app.services import tickets as ticket_service
from app.services.notifications import InAppNotification, commit_then_notify

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

Priority = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
Status = Literal[
    "OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_CLIENT", "RESOLVED", "CLOSED", "REOPENED"
]


class CreateTicketRequest(BaseModel):
    subject: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]
    category_id: UUID
    priority: Priority


class VersionedRequest(BaseModel):
    version: int | None = Field(default=None, description="Optimistic concurrency token (decision #6)")


class AssignRequest(VersionedRequest):
    assigned_to: UUID
    set_in_progress: bool = False


class StatusRequest(VersionedRequest):
    status: Status


class ResolveRequest(VersionedRequest):
    resolution_summary: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10000)
    ]


def _forbidden() -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")


def _status_notifications(
    ticket: dict[str, Any], notification_type: str, title: str, message: str
) -> list[InAppNotification]:
    assignee = str(ticket["assigned_to"]) if ticket["assigned_to"] else None
    return [
        InAppNotification(str(ticket["created_by"]), notification_type, title, message),
        InAppNotification(assignee, notification_type, title, message),
    ]


@router.get("")
def list_tickets(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25),
    status_filter: Status | None = Query(default=None, alias="status"),
    priority: Priority | None = None,
    assigned_to: str | None = Query(default=None, description="A user id, or 'unassigned'"),
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Paginated list (spec §48). RLS alone scopes rows to the caller."""
    if page_size not in ticket_service.PAGE_SIZES:
        raise HTTPException(status_code=422, detail="page_size must be 25, 50 or 100")
    if assigned_to not in (None, "unassigned"):
        try:
            assigned_to = str(UUID(assigned_to))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="assigned_to must be a user id") from exc
    return ticket_service.list_tickets(
        conn,
        page=page,
        page_size=page_size,
        status_filter=status_filter,
        priority=priority,
        assigned_to=assigned_to,
    )


@router.post("", status_code=201)
def create_ticket(
    body: CreateTicketRequest,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    if not permissions.can_create_client_ticket(principal):
        raise _forbidden()
    ticket = ticket_service.create_ticket(
        conn,
        principal,
        subject=body.subject,
        description=body.description,
        category_id=str(body.category_id),
        priority=body.priority,
        ip_address=client_ip(request),
    )
    commit_then_notify(
        conn,
        actor_user_id=principal.user_id,
        ticket_id=str(ticket["id"]),
        job={
            "event": "NEW_TICKET",
            "ticket_number": ticket["ticket_number"],
            "recipient_user_ids": [principal.user_id],  # client confirmation (spec §9 step 6)
            "notify_cto": True,  # spec §9 step 5
        },
    )
    return ticket


@router.get("/{ticket_id}")
def get_ticket(
    ticket_id: UUID,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    # 404 whether the ticket doesn't exist OR RLS hid it (decision #4).
    return ticket_service.fetch_ticket(conn, str(ticket_id))


@router.post("/{ticket_id}/assign")
def assign_ticket(
    ticket_id: UUID,
    body: AssignRequest,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    if not permissions.can_assign_ticket(principal):
        raise _forbidden()
    ticket = ticket_service.fetch_ticket(conn, str(ticket_id), for_update=True)
    updated = ticket_service.assign(
        conn,
        principal,
        ticket,
        assignee_id=str(body.assigned_to),
        set_in_progress=body.set_in_progress,
        expected_version=body.version,
        ip_address=client_ip(request),
    )
    number = updated["ticket_number"]
    commit_then_notify(
        conn,
        actor_user_id=principal.user_id,
        ticket_id=str(ticket_id),
        in_app=[
            InAppNotification(
                str(body.assigned_to), "TICKET_ASSIGNED", f"{number} assigned to you", updated["subject"]
            )
        ],
        job={
            "event": "TICKET_ASSIGNED",
            "ticket_number": number,
            "recipient_user_ids": [str(body.assigned_to)],
            "previous_assignee": str(ticket["assigned_to"]) if ticket["assigned_to"] else None,
        },
    )
    return updated


def _change_status(
    conn: psycopg.Connection,
    principal: Principal,
    ticket_id: str,
    to_status: str,
    *,
    version: int | None,
    ip_address: str,
    resolution_summary: str | None = None,
) -> dict[str, Any]:
    ticket = ticket_service.fetch_ticket(conn, ticket_id, for_update=True)
    org_id = str(ticket["organization_id"])
    assigned_to = str(ticket["assigned_to"]) if ticket["assigned_to"] else None
    number = ticket["ticket_number"]
    extra: dict[str, Any] = {}
    extra_new: dict[str, Any] = {}

    if to_status == state_machine.RESOLVED:
        if not permissions.can_resolve_ticket(principal, ticket_assigned_to=assigned_to):
            raise _forbidden()
        if not resolution_summary:
            raise HTTPException(status_code=422, detail="resolution_summary is required")
        extra = {"resolution_summary": resolution_summary, "resolved_at": ticket_service.NOW}
        extra_new = {"resolution_summary": resolution_summary}
        action, ntype, event = "ticket_resolved", "TICKET_RESOLVED", "RESOLVED"
        title = f"{number} was resolved"
    elif to_status == state_machine.CLOSED:
        if not permissions.can_close_ticket(principal, ticket_organization_id=org_id):
            raise _forbidden()
        extra = {"closed_at": ticket_service.NOW}
        action, ntype, event = "ticket_closed", "TICKET_CLOSED", "CLOSED"
        title = f"{number} was closed"
    elif to_status == state_machine.REOPENED:
        if not permissions.can_reopen_ticket(principal, ticket_organization_id=org_id):
            raise _forbidden()
        extra = {"closed_at": None, "resolved_at": None}
        action, ntype, event = "ticket_reopened", "TICKET_REOPENED", "REOPENED"
        title = f"{number} was reopened"
    else:
        if not permissions.can_change_ticket_status(
            principal, ticket_organization_id=org_id, ticket_assigned_to=assigned_to
        ):
            raise _forbidden()
        action, ntype, event = "status_changed", "TICKET_STATUS_CHANGED", "STATUS_CHANGED"
        title = f"{number} is now {to_status.replace('_', ' ')}"

    updated = ticket_service.transition(
        conn,
        principal,
        ticket,
        to_status=to_status,
        action=action,
        extra=extra,
        extra_new_value=extra_new,
        expected_version=version,
        ip_address=ip_address,
    )
    commit_then_notify(
        conn,
        actor_user_id=principal.user_id,
        ticket_id=ticket_id,
        in_app=_status_notifications(updated, ntype, title, updated["subject"]),
        job={
            "event": event,
            "ticket_number": number,
            "old_status": ticket["status"],
            "new_status": to_status,
            "recipient_user_ids": [str(updated["created_by"])] + ([assigned_to] if assigned_to else []),
            # Decision #8 spirit: a reopen of an unassigned or urgent ticket
            # should also reach the CTO.
            "notify_cto": to_status == state_machine.REOPENED
            and (assigned_to is None or ticket["priority"] in ("HIGH", "CRITICAL")),
        },
    )
    return updated


@router.patch("/{ticket_id}/status")
def change_status(
    ticket_id: UUID,
    body: StatusRequest,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    if body.status == state_machine.RESOLVED:
        # Spec §41: resolving always requires a resolution summary.
        raise HTTPException(status_code=422, detail="Use POST /resolve with a resolution_summary")
    return _change_status(
        conn, principal, str(ticket_id), body.status, version=body.version, ip_address=client_ip(request)
    )


@router.post("/{ticket_id}/resolve")
def resolve_ticket(
    ticket_id: UUID,
    body: ResolveRequest,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    return _change_status(
        conn,
        principal,
        str(ticket_id),
        state_machine.RESOLVED,
        version=body.version,
        ip_address=client_ip(request),
        resolution_summary=body.resolution_summary,
    )


@router.post("/{ticket_id}/close")
def close_ticket(
    ticket_id: UUID,
    request: Request,
    body: VersionedRequest | None = None,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    return _change_status(
        conn,
        principal,
        str(ticket_id),
        state_machine.CLOSED,
        version=body.version if body else None,
        ip_address=client_ip(request),
    )


@router.post("/{ticket_id}/reopen")
def reopen_ticket(
    ticket_id: UUID,
    request: Request,
    body: VersionedRequest | None = None,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    return _change_status(
        conn,
        principal,
        str(ticket_id),
        state_machine.REOPENED,
        version=body.version if body else None,
        ip_address=client_ip(request),
    )
