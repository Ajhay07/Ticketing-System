"""The authenticated caller's own identity.

Used by the frontend shell to know who is logged in and route them to the
right dashboard (client/team/admin) - spec §32. This is a convenience
endpoint only; it grants no authorization by itself.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_current_principal
from app.core.security import Principal

router = APIRouter(tags=["me"])


@router.get("/api/me")
def read_me(principal: Principal = Depends(get_current_principal)) -> dict[str, str]:
    return {
        "user_id": principal.user_id,
        "organization_id": principal.organization_id,
        "role": principal.role.value,
        "email": principal.email,
    }
