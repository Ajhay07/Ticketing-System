"""Admin-only user/organization management (spec §18, decision #7).

Only SUPER_ADMIN / ADMIN may create or modify client users in V1. These
endpoints go through app.core.privileged because provisioning auth users and
setting their role/organization_id requires the Supabase Admin API
(service_role) - it cannot be done under the caller's own JWT. The role
check below is the application-layer gate; Postgres RLS additionally blocks
any direct table write by a non-admin regardless.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import require_roles
from app.core import privileged
from app.core.security import Principal, Role

router = APIRouter(prefix="/api/admin", tags=["admin"])

_admin_only = require_roles(Role.SUPER_ADMIN, Role.ADMIN)


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=200)
    organization_id: str
    role: Role


class UpdateUserRequest(BaseModel):
    role: Role | None = None
    organization_id: str | None = None


@router.post("/users", status_code=201)
def create_user(
    body: CreateUserRequest,
    principal: Principal = Depends(_admin_only),
) -> dict[str, str]:
    if body.role in (Role.SUPER_ADMIN,) and principal.role != Role.SUPER_ADMIN:
        # Only a super admin may create another super admin.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")

    auth_user = privileged.provision_user(
        email=body.email,
        password=body.password,
        name=body.name,
        organization_id=body.organization_id,
        role=body.role.value,
        actor_user_id=principal.user_id,
    )
    return {"id": auth_user["id"]}


@router.patch("/users/{user_id}", status_code=204, response_class=Response)
def update_user(
    user_id: str,
    body: UpdateUserRequest,
    principal: Principal = Depends(_admin_only),
) -> Response:
    privileged.update_user_role_or_org(
        target_user_id=user_id,
        role=body.role.value if body.role else None,
        organization_id=body.organization_id,
        actor_user_id=principal.user_id,
    )
    return Response(status_code=204)
