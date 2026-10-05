"""JWT verification and the authenticated-session model.

CLAUDE.md rule: organization_id, user_id, and role are ALWAYS derived from the
verified Supabase JWT, never from request body/query params. This module is
the single place that performs that verification; every router depends on
`get_current_principal` (see app/api/deps.py) rather than re-implementing it.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import jwt
from fastapi import HTTPException, status

from app.core.config import settings


class Role(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ADMIN = "ADMIN"
    TEAM_MEMBER = "TEAM_MEMBER"
    CLIENT_ADMIN = "CLIENT_ADMIN"
    CLIENT_USER = "CLIENT_USER"

    @property
    def is_internal(self) -> bool:
        return self in (Role.SUPER_ADMIN, Role.ADMIN, Role.TEAM_MEMBER)

    @property
    def is_admin(self) -> bool:
        return self in (Role.SUPER_ADMIN, Role.ADMIN)


@dataclass(frozen=True)
class Principal:
    """The verified identity of the caller for the duration of one request.

    Everything downstream (permission checks, RLS-scoped DB connection) is
    derived from this object, never from anything the client sent in the
    request body or query string.
    """

    user_id: str
    organization_id: str
    role: Role
    email: str
    raw_token: str
    """The original, still-valid bearer JWT, forwarded to Postgres so RLS
    policies (which read auth.jwt()) are enforced for this request (decision
    #1: normal requests must run under the user's own JWT, not service_role).
    """


class AuthError(HTTPException):
    def __init__(self, detail: str = "Not authenticated") -> None:
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def decode_supabase_jwt(token: str) -> dict:
    """Verify and decode a Supabase-issued access token.

    Raises AuthError on any failure (expired, bad signature, malformed).
    """
    if not settings.supabase_jwt_secret:
        # Fail closed: never accept unverifiable tokens.
        raise AuthError("JWT verification is not configured")
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError("Invalid token") from exc
    return payload


def principal_from_token(token: str) -> Principal:
    payload = decode_supabase_jwt(token)
    app_metadata = payload.get("app_metadata") or {}
    role_value = app_metadata.get("role")
    organization_id = app_metadata.get("organization_id")
    user_id = payload.get("sub")
    email = payload.get("email", "")

    if not role_value or not organization_id or not user_id:
        # A session that has not been fully provisioned (role/org not yet set
        # in app_metadata) must never be treated as authorized for anything.
        raise AuthError("Session is missing required claims")

    try:
        role = Role(role_value)
    except ValueError as exc:
        raise AuthError("Unknown role claim") from exc

    return Principal(
        user_id=user_id,
        organization_id=organization_id,
        role=role,
        email=email,
        raw_token=token,
    )
