"""Minimal ticket read endpoints.

Full ticket creation/assignment/comments/attachments workflow is Phase 2
(docs/V1_IMPLEMENTATION_PLAN.md §4). This Phase 1 slice exists only to give
the mandatory cross-tenant-isolation test (spec §60) a real HTTP endpoint to
exercise end-to-end: GET a ticket by id must return 404 - not 403, not the
data - for a ticket the caller's organization does not own, and this must be
true because of RLS, not because of an `if` statement here.

Note what this router deliberately does NOT do: it does not filter by
organization_id in the SQL. The whole point of the test is that even a
naive, unfiltered `select * from tickets where id = %s` is safe because
Postgres RLS strips rows the caller isn't allowed to see - that query then
returns zero rows for another org's ticket, which this router reports as 404.
"""

from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_principal, get_db
from app.api.routers._rows import row_as_dict, rows_as_dicts
from app.core.security import Principal

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


@router.get("")
def list_tickets(
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, ticket_number, organization_id, subject, status, priority,
                   assigned_to, created_at
            from tickets
            order by created_at desc
            limit 100
            """
        )
        return rows_as_dicts(cur)


@router.get("/{ticket_id}")
def get_ticket(
    ticket_id: str,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, ticket_number, organization_id, subject, description,
                   status, priority, assigned_to, created_by, created_at, updated_at
            from tickets
            where id = %s
            """,
            (ticket_id,),
        )
        result = row_as_dict(cur)
        if result is None:
            # Decision #4: 404 whether the ticket doesn't exist OR the caller
            # is simply not authorized to see it (RLS already removed it from
            # the result set above) - never distinguish the two cases.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
        return result
