"""Staff directory for the assignment control (spec §39). Admin/CTO only.
Rows come through RLS (users_select: internal roles may read users)."""

from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends

from app.api.deps import get_db, require_roles
from app.api.routers._rows import rows_as_dicts
from app.core.security import Principal, Role

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/assignable")
def list_assignable_users(
    principal: Principal = Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN)),
    conn: psycopg.Connection = Depends(get_db),
) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, name, email, role from users
            where role in ('SUPER_ADMIN', 'ADMIN', 'TEAM_MEMBER') and status = 'ACTIVE'
            order by name
            """
        )
        return rows_as_dicts(cur)
