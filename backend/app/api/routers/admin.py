"""Admin-only user/organization management (spec §18, decision #7).

Only SUPER_ADMIN / ADMIN may create or modify client users in V1. These
endpoints go through app.core.privileged because provisioning auth users and
setting their role/organization_id/ban status requires the Supabase Admin
API (service_role) - it cannot be done under the caller's own JWT. The role
check below is the application-layer gate; Postgres RLS (+ the 0004
users_guard_update trigger) additionally blocks any direct table write by a
non-admin regardless.

Every target organization / user is first looked up on the caller's own
user-scoped connection (RLS), so nonexistent ids are 404 and roles must be
consistent with the organization type (staff roles only in the internal
org, client roles only in client orgs).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import client_ip, get_db, require_roles
from app.api.routers._rows import row_as_dict
from app.core import privileged
from app.core.security import Principal, Role
from app.services import account
from app.services.audit import write_audit
from app.services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/admin", tags=["admin"])

_admin_only = require_roles(Role.SUPER_ADMIN, Role.ADMIN)

STAFF_ROLES = {Role.SUPER_ADMIN, Role.ADMIN, Role.TEAM_MEMBER}
CLIENT_ROLES = {Role.CLIENT_ADMIN, Role.CLIENT_USER}


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    name: str = Field(min_length=1, max_length=200)
    organization_id: UUID
    role: Role


class UpdateUserRequest(BaseModel):
    role: Role | None = None
    organization_id: UUID | None = None


def _forbidden() -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")


def _load_org(conn: psycopg.Connection, organization_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("select id, is_internal, status from organizations where id = %s", (organization_id,))
        org = row_as_dict(cur)
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


def _load_user(conn: psycopg.Connection, user_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("select id, email, role, organization_id, status from users where id = %s", (user_id,))
        user = row_as_dict(cur)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _check_role_matches_org(role: Role, org: dict[str, Any]) -> None:
    if org["is_internal"] and role not in STAFF_ROLES:
        raise HTTPException(status_code=422, detail="Internal organization users must have a staff role")
    if not org["is_internal"] and role not in CLIENT_ROLES:
        raise HTTPException(status_code=422, detail="Client organization users must have a client role")


def _check_can_manage(principal: Principal, target_role: str) -> None:
    # Only a super admin may create, modify or disable another super admin.
    if target_role == Role.SUPER_ADMIN.value and principal.role != Role.SUPER_ADMIN:
        raise _forbidden()


@router.post("/users", status_code=201)
def create_user(
    body: CreateUserRequest,
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, str]:
    _check_can_manage(principal, body.role.value)
    org = _load_org(conn, str(body.organization_id))
    if org["status"] != "ACTIVE":
        raise HTTPException(status_code=422, detail="Organization is disabled")
    _check_role_matches_org(body.role, org)

    auth_user = privileged.provision_user(
        email=body.email,
        password=body.password,
        name=body.name,
        organization_id=str(body.organization_id),
        role=body.role.value,
        actor_user_id=principal.user_id,
    )
    return {"id": auth_user["id"]}


@router.patch("/users/{user_id}", status_code=204, response_class=Response)
def update_user(
    user_id: UUID,
    body: UpdateUserRequest,
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> Response:
    target = _load_user(conn, str(user_id))
    _check_can_manage(principal, target["role"])
    new_role = body.role or Role(target["role"])
    _check_can_manage(principal, new_role.value)
    org = _load_org(conn, str(body.organization_id or target["organization_id"]))
    _check_role_matches_org(new_role, org)
    privileged.update_user_role_or_org(
        target_user_id=str(user_id),
        role=body.role.value if body.role else None,
        organization_id=str(body.organization_id) if body.organization_id else None,
        actor_user_id=principal.user_id,
    )
    return Response(status_code=204)


def _set_status(principal: Principal, conn: psycopg.Connection, user_id: str, new_status: str) -> None:
    target = _load_user(conn, user_id)
    _check_can_manage(principal, target["role"])
    if user_id == principal.user_id:
        raise HTTPException(status_code=422, detail="You cannot change your own account status")
    privileged.set_user_status(target_user_id=user_id, status=new_status, actor_user_id=principal.user_id)


@router.post("/users/{user_id}/disable", status_code=204, response_class=Response)
def disable_user(
    user_id: UUID,
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> Response:
    """Spec §18 "Disable user" / "Remove user" (remove == permanent disable;
    users are never hard-deleted so ticket history keeps its authors)."""
    _set_status(principal, conn, str(user_id), "DISABLED")
    return Response(status_code=204)


@router.post("/users/{user_id}/enable", status_code=204, response_class=Response)
def enable_user(
    user_id: UUID,
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> Response:
    _set_status(principal, conn, str(user_id), "ACTIVE")
    return Response(status_code=204)


@router.post("/users/{user_id}/reset-access", status_code=202)
def reset_access(
    user_id: UUID,
    request: Request,
    principal: Principal = Depends(_admin_only),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, str]:
    """Spec §18 "Reset access": send the user a password-reset email via
    Supabase Auth's public recovery endpoint (no service_role needed)."""
    enforce_rate_limit("password_reset", principal.user_id)
    target = _load_user(conn, str(user_id))
    _check_can_manage(principal, target["role"])
    account.send_password_reset(email=target["email"])
    write_audit(
        conn,
        ticket_id=None,
        user_id=principal.user_id,
        action="user_access_reset",
        new_value={"target_user_id": str(user_id)},
        ip_address=client_ip(request),
    )
    return {"status": "sent"}
