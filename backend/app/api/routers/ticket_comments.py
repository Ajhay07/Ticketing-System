"""Ticket conversation: client replies and internal notes (spec §10, §11, §23).

Visibility is enforced by Postgres RLS (ticket_comments_select /
ticket_comments_insert in 0002_rls.sql): a client's SELECT never returns
INTERNAL rows, and a client INSERT with visibility INTERNAL is rejected by
the database. This router deliberately does NOT filter on visibility in its
SELECT, so any RLS regression would surface in the tests instead of being
masked here. The permission checks below are the second, independent layer.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, StringConstraints

from app.api.deps import client_ip, get_current_principal, get_db
from app.api.routers._rows import row_as_dict, rows_as_dicts
from app.core.security import Principal
from app.domain import permissions
from app.services import tickets as ticket_service
from app.services.audit import write_audit
from app.services.notifications import InAppNotification, commit_then_notify
from app.services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/tickets", tags=["comments"])

_COMMENT_SELECT = """
    select tc.id, tc.ticket_id, tc.user_id,
           coalesce(u.name, comment_author_first_name(tc.id)) as author_name, u.role as author_role,
           tc.comment, tc.visibility, tc.created_at
    from ticket_comments tc
    left join users u on u.id = tc.user_id
"""
# Clients cannot read staff user rows (users_select RLS); for them the author
# of a staff reply resolves to the staff member's FIRST NAME only via
# comment_author_first_name() (0006 migration, spec §10 conversation shows
# "ARJUN"), and author_role stays null.


class CreateCommentRequest(BaseModel):
    comment: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10000)]
    visibility: Literal["CLIENT", "INTERNAL"] = "CLIENT"


@router.get("/{ticket_id}/comments")
def list_comments(
    ticket_id: UUID,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    ticket_service.fetch_ticket(conn, str(ticket_id))  # 404 if not visible
    with conn.cursor() as cur:
        cur.execute(_COMMENT_SELECT + " where tc.ticket_id = %s order by tc.created_at", (str(ticket_id),))
        return rows_as_dicts(cur)


@router.post("/{ticket_id}/comments", status_code=201)
def create_comment(
    ticket_id: UUID,
    body: CreateCommentRequest,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    enforce_rate_limit("comment_create", principal.user_id)
    ticket = ticket_service.fetch_ticket(conn, str(ticket_id))
    assigned_to = str(ticket["assigned_to"]) if ticket["assigned_to"] else None
    if not permissions.can_write_comment(
        principal,
        visibility=body.visibility,
        ticket_organization_id=str(ticket["organization_id"]),
        ticket_assigned_to=assigned_to,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into ticket_comments (ticket_id, user_id, comment, visibility)
            values (%s, %s, %s, %s)
            returning id
            """,
            (str(ticket_id), principal.user_id, body.comment, body.visibility),
        )
        row = cur.fetchone()
        assert row is not None
        comment_id = str(row[0])

        if body.visibility == "CLIENT" and principal.role.is_internal:
            # First team/admin reply to the client (decision #6, SLA input).
            cur.execute(
                "update tickets set first_response_at = now() where id = %s and first_response_at is null",
                (str(ticket_id),),
            )

    is_internal = body.visibility == "INTERNAL"
    write_audit(
        conn,
        ticket_id=str(ticket_id),
        user_id=principal.user_id,
        action="internal_note_added" if is_internal else "comment_added",
        # Never copy comment text into the audit row: clients can read audit
        # rows for their own tickets (audit_logs_select).
        new_value={"comment_id": comment_id, "visibility": body.visibility},
        ip_address=client_ip(request),
    )

    with conn.cursor() as cur:
        cur.execute(_COMMENT_SELECT + " where tc.id = %s", (comment_id,))
        created = row_as_dict(cur)
    assert created is not None

    number = ticket["ticket_number"]
    in_app: list[InAppNotification] = []
    job: dict[str, Any] | None = None
    if not is_internal and not principal.role.is_internal:
        # Client reply -> assignee always; CTO when unassigned or urgent (decision #8).
        in_app.append(
            InAppNotification(assigned_to, "CLIENT_REPLY", f"Client replied to {number}", ticket["subject"])
        )
        job = {
            "event": "CLIENT_REPLY",
            "ticket_number": number,
            "comment_id": comment_id,
            "recipient_user_ids": [assigned_to] if assigned_to else [],
            "notify_cto": assigned_to is None or ticket["priority"] in ("HIGH", "CRITICAL"),
        }
    elif not is_internal:
        # Staff reply visible to the client: notify the ticket creator.
        in_app.append(
            InAppNotification(
                str(ticket["created_by"]), "TEAM_REPLY", f"New reply on {number}", ticket["subject"]
            )
        )
        job = {
            "event": "TEAM_REPLY",
            "ticket_number": number,
            "comment_id": comment_id,
            "recipient_user_ids": [str(ticket["created_by"])],
        }
    # Internal notes notify nobody outside the team and enqueue no email.

    commit_then_notify(
        conn, actor_user_id=principal.user_id, ticket_id=str(ticket_id), in_app=in_app, job=job
    )
    return created
