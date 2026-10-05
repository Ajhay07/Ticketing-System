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
from jwt import PyJWKClient

from app.core.config import settings

# Supabase projects created from ~2024 onward default to ASYMMETRIC JWT
# signing keys (ES256/RS256), verified via a published JWKS endpoint,
# instead of the legacy shared HS256 "JWT Secret". A project can have
# either. PyJWKClient fetches and caches the project's public signing keys;
# verifying with a public key (not a shared secret) is also simply a better
# security posture, since there is nothing here that can leak and be used
# to forge tokens.
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


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

    Supports BOTH JWT signing schemes a Supabase project may use:
      - Legacy shared-secret HS256 (settings.supabase_jwt_secret)
      - Current default: asymmetric ES256/RS256 via the project's JWKS
        endpoint (settings.supabase_url + "/auth/v1/.well-known/jwks.json")

    The token's own header `alg` determines which path is used - this is
    safe (not an "alg confusion" vulnerability) because each path pins its
    own fixed, expected algorithm list and verifies against a key that
    corresponds to that algorithm family; a token can't trick an HS256
    verification into using an RS/ES key as an HMAC secret or vice versa.

    Raises AuthError on any failure (expired, bad signature, malformed,
    unconfigured).
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as exc:
        raise AuthError("Malformed token") from exc

    alg = header.get("alg", "")

    try:
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise AuthError("JWT verification is not configured (HS256 secret missing)")
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
                options={"require": ["exp", "sub"]},
            )
        elif alg in ("ES256", "RS256"):
            if not settings.supabase_url:
                raise AuthError("JWT verification is not configured (SUPABASE_URL missing)")
            signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                audience="authenticated",
                options={"require": ["exp", "sub"]},
            )
        else:
            raise AuthError(f"Unsupported token signing algorithm: {alg!r}")
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Token has expired") from exc
    except (jwt.InvalidTokenError, jwt.PyJWKClientError) as exc:
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
