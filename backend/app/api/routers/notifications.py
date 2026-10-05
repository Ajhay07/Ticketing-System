"""In-app notifications (spec §26): list, unread count, mark as read.

Runs entirely under the caller's JWT: notifications_select_own /
notifications_update_own RLS (0002, tightened in 0004) means a user only
ever sees or marks their own rows, and only read_at can change.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.api.deps import get_current_principal, get_db
from app.api.routers._rows import rows_as_dicts
from app.core.security import Principal

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=25, ge=1, le=100),
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    where = " where read_at is null" if unread_only else ""
    with conn.cursor() as cur:
        cur.execute(
            "select n.id, n.ticket_id, t.ticket_number, n.type, n.title, n.message, n.read_at, n.created_at "
            "from notifications n left join tickets t on t.id = n.ticket_id"
            + where.replace("read_at", "n.read_at")
            + " order by n.created_at desc limit %s",
            (limit,),
        )
        items = rows_as_dicts(cur)
        cur.execute("select count(*) from notifications where read_at is null")
        row = cur.fetchone()
    return {"items": items, "unread": int(row[0]) if row else 0}


@router.post("/{notification_id}/read", status_code=204, response_class=Response)
def mark_read(
    notification_id: UUID,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> Response:
    with conn.cursor() as cur:
        cur.execute(
            "update notifications set read_at = coalesce(read_at, now()) where id = %s",
            (str(notification_id),),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
    return Response(status_code=204)


@router.post("/read-all", status_code=204, response_class=Response)
def mark_all_read(
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> Response:
    with conn.cursor() as cur:
        cur.execute("update notifications set read_at = now() where read_at is null")
    return Response(status_code=204)
