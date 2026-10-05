"""CTO / admin operations endpoints (spec §13-§18, §24, §37, §38, §50).

Every endpoint requires SUPER_ADMIN / ADMIN (require_roles -> 403 for anyone
else, including team members: decision #5 makes the unassigned queue
admin-only). All data access runs on get_db's user-scoped connection, so
RLS is enforced underneath as an independent layer. No service_role here.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, StringConstraints

from app.api.deps import client_ip, get_db, require_roles
from app.api.routers._rows import row_as_dict, rows_as_dicts
from app.core.security import Principal, Role
from app.services import admin_ops
from app.services import tickets as ticket_service
from app.services.audit import write_audit

router = APIRouter(prefix="/api/admin", tags=["admin-ops"])

_admin_only = require_roles(Role.SUPER_ADMIN, Role.ADMIN)


@router.get("/dashboard")
def dashboard(
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    return admin_ops.dashboard(conn)


@router.get("/unassigned")
def unassigned_queue(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25),
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Spec §15: active tickets with no assignee, most urgent first."""
    if page_size not in ticket_service.PAGE_SIZES:
        raise HTTPException(status_code=422, detail="page_size must be 25, 50 or 100")
    return ticket_service.list_tickets(
        conn,
        page=page,
        page_size=page_size,
        status_filter=None,
        priority=None,
        assigned_to="unassigned",
        open_only=True,
        sort="priority",
    )


@router.get("/workload")
def team_workload(
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    return admin_ops.team_workload(conn)


@router.get("/team")
def list_team(
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    """Spec §50 GET /api/admin/team: internal staff directory (admin only)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, name, email, role, status, created_at from users
            where role in ('SUPER_ADMIN', 'ADMIN', 'TEAM_MEMBER')
            order by name
            """
        )
        return rows_as_dicts(cur)


# --- client organizations (spec §18, §38, §50) ---------------------------------


class CreateClientRequest(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    slug: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] | None = None


class UpdateClientRequest(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)] | None = None
    status: Literal["ACTIVE", "DISABLED"] | None = None


def _client_not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")


@router.get("/clients")
def list_clients(
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    return admin_ops.list_clients(conn)


@router.post("/clients", status_code=201)
def create_client(
    body: CreateClientRequest,
    request: Request,
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    slug = (body.slug or admin_ops.slugify(body.name)).lower()
    if not admin_ops.valid_slug(slug):
        raise HTTPException(status_code=422, detail="slug must be lowercase letters, digits and hyphens")
    with conn.cursor() as cur:
        cur.execute("select 1 from organizations where slug = %s", (slug,))
        if cur.fetchone() is not None:
            raise HTTPException(status_code=409, detail="A client with this slug already exists")
        # is_internal is never client-controllable: always false here.
        cur.execute(
            """
            insert into organizations (name, slug, is_internal) values (%s, %s, false)
            returning id, name, slug, status, created_at
            """,
            (body.name, slug),
        )
        org = row_as_dict(cur)
    assert org is not None
    write_audit(
        conn,
        ticket_id=None,
        user_id=principal.user_id,
        action="organization_created",
        new_value={"organization_id": str(org["id"]), "name": body.name, "slug": slug},
        ip_address=client_ip(request),
    )
    return org


@router.get("/clients/{organization_id}")
def client_detail(
    organization_id: UUID,
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    detail = admin_ops.client_detail(conn, str(organization_id))
    if detail is None:
        raise _client_not_found()
    return detail


@router.patch("/clients/{organization_id}")
def update_client(
    organization_id: UUID,
    body: UpdateClientRequest,
    request: Request,
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            "select id, name, status from organizations where id = %s and not is_internal for update",
            (str(organization_id),),
        )
        current = row_as_dict(cur)
        if current is None:
            raise _client_not_found()
        requested = (("name", body.name), ("status", body.status))
        changes = {k: v for k, v in requested if v is not None and v != current[k]}
        if changes:
            sets = ", ".join(f"{k} = %s" for k in changes)  # keys are code literals
            cur.execute(
                f"update organizations set {sets} where id = %s",  # noqa: S608
                [*changes.values(), str(organization_id)],
            )
            write_audit(
                conn,
                ticket_id=None,
                user_id=principal.user_id,
                action="organization_updated",
                old_value={"organization_id": str(organization_id), **{k: current[k] for k in changes}},
                new_value={"organization_id": str(organization_id), **changes},
                ip_address=client_ip(request),
            )
        cur.execute(
            "select id, name, slug, status, created_at from organizations where id = %s",
            (str(organization_id),),
        )
        org = row_as_dict(cur)
    assert org is not None
    return org


# --- reports & audit (spec §24, §37) -------------------------------------------


@router.get("/reports")
def reports(
    days: int = Query(default=30, ge=1, le=365),
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    return admin_ops.reports(conn, days=days)


@router.get("/audit-logs")
def audit_logs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25),
    ticket_id: UUID | None = None,
    action: Annotated[str | None, Query(max_length=100)] = None,
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    if page_size not in ticket_service.PAGE_SIZES:
        raise HTTPException(status_code=422, detail="page_size must be 25, 50 or 100")
    return admin_ops.audit_log_page(
        conn,
        page=page,
        page_size=page_size,
        ticket_id=str(ticket_id) if ticket_id else None,
        action=action,
    )
