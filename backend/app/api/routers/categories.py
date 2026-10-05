"""Ticket categories (spec §7). Read-only list of active categories for the
create-ticket form. RLS (categories_select) allows any authenticated user."""

from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_principal, get_db
from app.api.routers._rows import rows_as_dicts
from app.core.security import Principal

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("")
def list_categories(
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("select id, name, description from categories where is_active order by name")
        return rows_as_dicts(cur)
