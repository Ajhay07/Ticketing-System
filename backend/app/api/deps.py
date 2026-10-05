"""Shared FastAPI dependencies.

`get_current_principal` is the ONLY way a router should learn who the caller
is. It verifies the bearer token (app.core.security) and returns a Principal
whose fields are the sole source of organization_id/role/user_id for the rest
of the request (CLAUDE.md: never trust client-supplied identity).
"""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.db import user_scoped_connection
from app.core.security import Principal, Role, principal_from_token

_bearer_scheme = HTTPBearer(auto_error=False)


def get_current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> Principal:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return principal_from_token(credentials.credentials)


def require_roles(*allowed: Role):
    def _dependency(principal: Principal = Depends(get_current_principal)) -> Principal:
        if principal.role not in allowed:
            # 403 here is fine (not a tenant-isolation case): the caller is
            # correctly identified, just not permitted to use this endpoint.
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
        return principal

    return _dependency


def get_db(principal: Principal = Depends(get_current_principal)) -> Iterator:
    """Yields a Postgres connection scoped to the caller's JWT (RLS enforced)."""
    with user_scoped_connection(principal) as conn:
        yield conn


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
