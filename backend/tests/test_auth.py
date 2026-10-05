"""Unit tests for JWT verification and Principal construction (spec §28, §53).

These require no database - they test that the backend never trusts a
token it cannot verify, and never fabricates role/organization claims the
token does not actually carry.
"""

from __future__ import annotations

import pytest

from app.core.security import AuthError, Role, principal_from_token
from tests.conftest import make_token


def test_valid_token_yields_expected_principal() -> None:
    token = make_token(user_id="11111111-1111-1111-1111-111111111111", role="ADMIN", organization_id="org-1")
    principal = principal_from_token(token)
    assert principal.user_id == "11111111-1111-1111-1111-111111111111"
    assert principal.role == Role.ADMIN
    assert principal.organization_id == "org-1"


def test_expired_token_is_rejected() -> None:
    token = make_token(user_id="u1", role="ADMIN", organization_id="org-1", expired=True)
    with pytest.raises(AuthError):
        principal_from_token(token)


def test_token_missing_role_and_org_claims_is_rejected() -> None:
    token = make_token(user_id="u1", role="ADMIN", organization_id="org-1", missing_claims=True)
    with pytest.raises(AuthError):
        principal_from_token(token)


def test_tampered_signature_is_rejected() -> None:
    token = make_token(user_id="u1", role="ADMIN", organization_id="org-1")
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    with pytest.raises(AuthError):
        principal_from_token(tampered)


def test_unknown_role_claim_is_rejected() -> None:
    import time

    import jwt

    from tests.conftest import TEST_JWT_SECRET

    now = int(time.time())
    payload = {
        "sub": "u1",
        "aud": "authenticated",
        "iat": now,
        "exp": now + 3600,
        "app_metadata": {"role": "SUPER_USER_HACKER", "organization_id": "org-1"},
    }
    token = jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")
    with pytest.raises(AuthError):
        principal_from_token(token)
