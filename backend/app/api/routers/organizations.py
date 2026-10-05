"""Organization read endpoints (spec §18, §38).

Full client-management UI (creating organizations, client detail page with
metrics) is Phase 3. Phase 1 exposes just enough to read organization data
scoped by RLS, proving the user-scoped-connection path works end-to-end.
"""

from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_principal, get_db
from app.api.routers._rows import rows_as_dicts
from app.core.security import Principal

router = APIRouter(prefix="/api/organizations", tags=["organizations"])


@router.get("")
def list_organizations(
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> list[dict]:
    """Returns organizations visible to the caller. RLS (organizations_select
    in 0002_rls.sql) scopes this to the caller's own org unless they are
    internal staff - this endpoint performs NO additional filtering itself,
    so it also serves as a live demonstration that RLS, not application code,
    is the tenant boundary."""
    with conn.cursor() as cur:
        cur.execute(
            "select id, name, slug, status, created_at from organizations order by name"
        )
        return rows_as_dicts(cur)
