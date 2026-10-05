"""THE mandatory security test suite (spec §60), validated against a REAL
hosted Supabase/PostgreSQL project (not a mock, not a local emulation).

Covers all ten required checks from the Phase-1-Part-2 validation request:

 1. Org A cannot retrieve Org B's ticket.
 2. Org B's ticket does not appear in Org A's ticket list.
 3. No fields from Org B's ticket appear in the response.
 4. Client users cannot access internal comments.
 5. Team members only see their assigned tickets.
 6. Audit logs cannot be updated.
 7. Audit logs cannot be deleted.
 8. Cross-tenant attachment access is denied.
 9. RLS still works when queried with different authenticated JWTs.
10. service_role is only used in the explicitly privileged paths.

This test is an INTEGRATION test: it requires a real Postgres instance with
the Supabase `auth` schema, `supabase/migrations/*.sql` and
`supabase/seed.sql` applied, and real SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY/
JWT_SECRET credentials in backend/.env. It is automatically skipped - not
faked as a pass - when no such database/credentials are reachable.

Design note: checks #1-#3 go through the real HTTP API with a genuinely
signed-in JWT (full chain: Supabase sign-in -> signed JWT -> our verifier ->
RLS). Checks #4-#8 exercise app.core.db.user_scoped_connection directly
with a *verified* Principal (from a real decoded JWT where sign-in was used,
or a hand-built Principal where it wasn't) because no comment/attachment/
audit API endpoints exist yet in Phase 1 (they land in Phase 2) - this is
exactly the DB-layer RLS enforcement those future endpoints will rely on, so
testing it directly here is a faithful proof, not a shortcut.

Test data created in the Supabase project is clearly named (`RLS-TEST ...`)
and soft-deleted (not hard-deleted) at teardown, consistent with the
application's own soft-delete rule - hard-deleting is not attempted here.
"""

from __future__ import annotations

import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.db import user_scoped_connection
from app.core.security import Principal, Role, principal_from_token
from app.main import app
from tests.conftest import postgres_available
from tests.supabase_admin import create_auth_user, sign_in

CREDENTIALS_CONFIGURED = bool(
    settings.supabase_url and settings.supabase_service_role_key and settings.supabase_anon_key
)

pytestmark = pytest.mark.skipif(
    not (postgres_available() and CREDENTIALS_CONFIGURED),
    reason=(
        "Requires a reachable Postgres instance AND Supabase Admin API "
        "credentials (SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY in backend/.env) "
        "with supabase/migrations + supabase/seed already applied. See "
        "README.md 'Running the tenant isolation test' for setup."
    ),
)

INTERNAL_ORG_ID = "00000000-0000-0000-0000-000000000001"  # from supabase/seed.sql

# conftest.py installs an autouse fixture that overwrites settings.supabase_jwt_secret
# with a throwaway test secret for every test (so unit tests never touch a real
# secret). This module is the one place that MUST verify tokens actually signed
# by the real Supabase project, so we capture the real secret at import time
# (before any monkeypatch runs) and restore it for every test in this module.
_REAL_JWT_SECRET = settings.supabase_jwt_secret


@pytest.fixture(autouse=True)
def _use_real_supabase_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "supabase_jwt_secret", _REAL_JWT_SECRET)


def _schema_ready(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "select to_regclass('public.tickets') is not null "
            "and to_regclass('auth.users') is not null"
        )
        row = cur.fetchone()
        return bool(row and row[0])


def _service_conn() -> psycopg.Connection:
    conn = psycopg.connect(settings.database_url)
    with conn.cursor() as cur:
        cur.execute("set role service_role")
    return conn


@pytest.fixture(scope="module")
def module_service_conn():
    """Module-scoped service_role connection, kept separate from conftest's
    function-scoped `service_conn` fixture (scenario below is module-scoped
    for speed - real sign-ins over HTTP are not free - so it cannot depend
    on a function-scoped fixture)."""
    conn = _service_conn()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


@pytest.fixture(scope="module")
def scenario(module_service_conn: psycopg.Connection):
    """Builds the full fixture set once per test module run, using the real
    Supabase Auth Admin API for user creation (never raw auth.users SQL -
    a real hosted project rejects that even for service_role, see
    README/report)."""
    service_conn = module_service_conn
    if not _schema_ready(service_conn):
        pytest.skip(
            "Database reachable but migrations/auth schema not applied. "
            "Apply supabase/migrations/*.sql + supabase/seed.sql first."
        )

    run_id = uuid.uuid4().hex[:8]
    password = f"RlsTest!{run_id}"  # throwaway, per-run password for test-only accounts

    org_a = str(uuid.uuid4())
    org_b = str(uuid.uuid4())
    ticket_a_unassigned = str(uuid.uuid4())
    ticket_a_assigned = str(uuid.uuid4())
    ticket_b = str(uuid.uuid4())

    with service_conn.cursor() as cur:
        cur.execute(
            "insert into organizations (id, name, slug) values (%s, %s, %s), (%s, %s, %s)",
            (
                org_a,
                f"RLS-TEST Org A {run_id}",
                f"rls-test-org-a-{run_id}",
                org_b,
                f"RLS-TEST Org B {run_id}",
                f"rls-test-org-b-{run_id}",
            ),
        )

    # Real auth users via the Admin API (mirrors app.core.privileged.provision_user)
    user_a_id = create_auth_user(
        email=f"rls-test-user-a-{run_id}@example.com",
        password=password,
        role="CLIENT_USER",
        organization_id=org_a,
    )
    user_b_id = create_auth_user(
        email=f"rls-test-user-b-{run_id}@example.com",
        password=password,
        role="CLIENT_USER",
        organization_id=org_b,
    )
    arjun_id = create_auth_user(
        email=f"rls-test-arjun-{run_id}@example.com",
        password=password,
        role="TEAM_MEMBER",
        organization_id=INTERNAL_ORG_ID,
    )
    other_team_id = create_auth_user(
        email=f"rls-test-other-team-{run_id}@example.com",
        password=password,
        role="TEAM_MEMBER",
        organization_id=INTERNAL_ORG_ID,
    )

    with service_conn.cursor() as cur:
        cur.execute(
            "insert into users (id, organization_id, name, email, role) values "
            "(%s, %s, 'RLS Test User A', %s, 'CLIENT_USER'), "
            "(%s, %s, 'RLS Test User B', %s, 'CLIENT_USER'), "
            "(%s, %s, 'RLS Test Arjun', %s, 'TEAM_MEMBER'), "
            "(%s, %s, 'RLS Test Other Team', %s, 'TEAM_MEMBER')",
            (
                user_a_id, org_a, f"rls-test-user-a-{run_id}@example.com",
                user_b_id, org_b, f"rls-test-user-b-{run_id}@example.com",
                arjun_id, INTERNAL_ORG_ID, f"rls-test-arjun-{run_id}@example.com",
                other_team_id, INTERNAL_ORG_ID, f"rls-test-other-team-{run_id}@example.com",
            ),
        )
        cur.execute(
            "insert into tickets (id, ticket_number, organization_id, created_by, subject, description) "
            "values (%s, %s, %s, %s, 'RLS-TEST Issue in Org A (unassigned)', 'desc')",
            (ticket_a_unassigned, f"CF-{uuid.uuid4().int % 900000:06d}", org_a, user_a_id),
        )
        cur.execute(
            "insert into tickets "
            "(id, ticket_number, organization_id, created_by, assigned_to, subject, description) "
            "values (%s, %s, %s, %s, %s, 'RLS-TEST Issue in Org A (assigned to Arjun)', 'desc')",
            (ticket_a_assigned, f"CF-{uuid.uuid4().int % 900000:06d}", org_a, user_a_id, arjun_id),
        )
        cur.execute(
            "insert into tickets (id, ticket_number, organization_id, created_by, subject, description) "
            "values (%s, %s, %s, %s, 'RLS-TEST Issue in Org B - SECRET', 'confidential description')",
            (ticket_b, f"CF-{uuid.uuid4().int % 900000:06d}", org_b, user_b_id),
        )

        internal_comment_id = str(uuid.uuid4())
        client_comment_id = str(uuid.uuid4())
        cur.execute(
            "insert into ticket_comments (id, ticket_id, user_id, comment, visibility) values "
            "(%s, %s, %s, 'INTERNAL - checked prod logs, config expired - RLS-TEST', 'INTERNAL'), "
            "(%s, %s, %s, 'CLIENT - we are looking into this - RLS-TEST', 'CLIENT')",
            (
                internal_comment_id, ticket_a_assigned, arjun_id,
                client_comment_id, ticket_a_assigned, arjun_id,
            ),
        )

        attachment_b_id = str(uuid.uuid4())
        cur.execute(
            "insert into ticket_attachments "
            "(id, ticket_id, uploaded_by, file_name, storage_path, mime_type, file_size) "
            "values (%s, %s, %s, 'secret-invoice.pdf', %s, 'application/pdf', 1024)",
            (attachment_b_id, ticket_b, user_b_id, f"{org_b}/{ticket_b}/secret-invoice.pdf"),
        )

        audit_log_id = str(uuid.uuid4())
        cur.execute(
            "insert into audit_logs (id, ticket_id, user_id, action, new_value) "
            "values (%s, %s, %s, 'rls_test_seed_action', %s)",
            (audit_log_id, ticket_a_assigned, user_a_id, '{"note": "RLS-TEST fixture row"}'),
        )

    # Commit now: the HTTP requests and other user-scoped connections used
    # below open SEPARATE Postgres connections, which cannot see these rows
    # until this transaction commits (psycopg3 connections are not
    # autocommit by default).
    service_conn.commit()

    user_a_token = sign_in(email=f"rls-test-user-a-{run_id}@example.com", password=password)
    arjun_token = sign_in(email=f"rls-test-arjun-{run_id}@example.com", password=password)

    data = {
        "org_a": org_a,
        "org_b": org_b,
        "user_a_id": user_a_id,
        "user_b_id": user_b_id,
        "arjun_id": arjun_id,
        "other_team_id": other_team_id,
        "ticket_a_unassigned": ticket_a_unassigned,
        "ticket_a_assigned": ticket_a_assigned,
        "ticket_b": ticket_b,
        "internal_comment_id": internal_comment_id,
        "client_comment_id": client_comment_id,
        "attachment_b_id": attachment_b_id,
        "audit_log_id": audit_log_id,
        "user_a_token": user_a_token,
        "arjun_token": arjun_token,
    }

    yield data

    # --- Teardown: soft-delete only, consistent with CLAUDE.md "soft delete
    # only" rule. Hard-deleting is deliberately NOT attempted: audit_logs is
    # immutable (even to service_role, see test below) and references
    # ticket_a_assigned, so a hard delete of that ticket would fail anyway -
    # which is itself a correctness property, not a test limitation.
    with service_conn.cursor() as cur:
        cur.execute(
            "update tickets set deleted_at = now() where id in (%s, %s, %s)",
            (ticket_a_unassigned, ticket_a_assigned, ticket_b),
        )


# --- 1, 2, 3: Org A cannot read Org B's ticket, it's absent from the list,
# and no Org B fields leak - exercised over real HTTP with a REAL signed JWT.


def test_org_a_cannot_access_org_b_ticket_via_real_jwt(scenario: dict) -> None:
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {scenario['user_a_token']}"}

    own_ticket_response = client.get(f"/api/tickets/{scenario['ticket_a_unassigned']}", headers=headers)
    assert own_ticket_response.status_code == 200

    other_org_response = client.get(f"/api/tickets/{scenario['ticket_b']}", headers=headers)

    # Decision #4: 404, never 200/403-with-data, and never any protected data.
    assert other_org_response.status_code == 404
    body_text = other_org_response.text
    assert "SECRET" not in body_text
    assert "confidential description" not in body_text
    assert scenario["ticket_b"] not in body_text


def test_org_a_ticket_list_never_includes_org_b_ticket_via_real_jwt(scenario: dict) -> None:
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {scenario['user_a_token']}"}

    tickets = client.get("/api/tickets", headers=headers).json()
    ids = {t["id"] for t in tickets}

    assert scenario["ticket_a_unassigned"] in ids
    assert scenario["ticket_a_assigned"] in ids
    assert scenario["ticket_b"] not in ids
    assert not any("SECRET" in str(t) for t in tickets)


# --- 9: confirm the above actually went through real JWT verification, not
# a dependency override (belt-and-braces: decode the same token ourselves).


def test_real_jwt_decodes_to_expected_principal(scenario: dict) -> None:
    principal = principal_from_token(scenario["user_a_token"])
    assert principal.user_id == scenario["user_a_id"]
    assert principal.organization_id == scenario["org_a"]
    assert principal.role == Role.CLIENT_USER


# --- 5: team members only see their assigned tickets (real JWT for Arjun).


def test_team_member_sees_only_assigned_ticket(scenario: dict) -> None:
    principal = principal_from_token(scenario["arjun_token"])
    assert principal.role == Role.TEAM_MEMBER

    with user_scoped_connection(principal) as conn, conn.cursor() as cur:
        cur.execute("select id from tickets")
        visible_ids = {str(row[0]) for row in cur.fetchall()}

    assert scenario["ticket_a_assigned"] in visible_ids  # assigned to Arjun
    assert scenario["ticket_a_unassigned"] not in visible_ids  # unassigned -> admin-only
    assert scenario["ticket_b"] not in visible_ids  # different org entirely


def test_unrelated_team_member_sees_no_tickets(scenario: dict) -> None:
    other_team_principal = Principal(
        user_id=scenario["other_team_id"],
        organization_id=INTERNAL_ORG_ID,
        role=Role.TEAM_MEMBER,
        email="other-team@example.com",
        raw_token="n/a",
    )
    with user_scoped_connection(other_team_principal) as conn, conn.cursor() as cur:
        cur.execute("select id from tickets")
        visible_ids = {str(row[0]) for row in cur.fetchall()}

    assert scenario["ticket_a_assigned"] not in visible_ids
    assert scenario["ticket_a_unassigned"] not in visible_ids
    assert scenario["ticket_b"] not in visible_ids


# --- 4: client users cannot see internal comments (real JWT for User A).


def test_client_cannot_see_internal_comment(scenario: dict) -> None:
    principal = principal_from_token(scenario["user_a_token"])

    with user_scoped_connection(principal) as conn, conn.cursor() as cur:
        cur.execute(
            "select id, visibility from ticket_comments where ticket_id = %s",
            (scenario["ticket_a_assigned"],),
        )
        rows = cur.fetchall()

    visible_comment_ids = {str(row[0]) for row in rows}
    visible_visibilities = {row[1] for row in rows}

    assert scenario["client_comment_id"] in visible_comment_ids
    assert scenario["internal_comment_id"] not in visible_comment_ids
    assert "INTERNAL" not in visible_visibilities


def test_assigned_team_member_can_see_internal_comment(scenario: dict) -> None:
    principal = principal_from_token(scenario["arjun_token"])

    with user_scoped_connection(principal) as conn, conn.cursor() as cur:
        cur.execute(
            "select id from ticket_comments where ticket_id = %s",
            (scenario["ticket_a_assigned"],),
        )
        visible_comment_ids = {str(row[0]) for row in cur.fetchall()}

    assert scenario["internal_comment_id"] in visible_comment_ids
    assert scenario["client_comment_id"] in visible_comment_ids


# --- 8: cross-tenant attachment access is denied.


def test_org_a_cannot_see_org_b_attachment(scenario: dict) -> None:
    principal = principal_from_token(scenario["user_a_token"])

    with user_scoped_connection(principal) as conn, conn.cursor() as cur:
        cur.execute(
            "select id from ticket_attachments where id = %s",
            (scenario["attachment_b_id"],),
        )
        row = cur.fetchone()

    assert row is None  # RLS silently filters it out - not an error, just absent


# --- 6, 7: audit logs cannot be updated or deleted - not even by service_role.


def test_audit_log_cannot_be_updated_by_authenticated_user(scenario: dict) -> None:
    principal = principal_from_token(scenario["user_a_token"])

    with pytest.raises(psycopg.errors.DatabaseError):
        with user_scoped_connection(principal) as conn, conn.cursor() as cur:
            cur.execute(
                "update audit_logs set action = 'TAMPERED' where id = %s",
                (scenario["audit_log_id"],),
            )


def test_audit_log_cannot_be_deleted_by_authenticated_user(scenario: dict) -> None:
    principal = principal_from_token(scenario["user_a_token"])

    with pytest.raises(psycopg.errors.DatabaseError):
        with user_scoped_connection(principal) as conn, conn.cursor() as cur:
            cur.execute("delete from audit_logs where id = %s", (scenario["audit_log_id"],))


def test_audit_log_cannot_be_updated_even_by_service_role(scenario: dict) -> None:
    """Defense in depth: audit_logs_immutable trigger fires regardless of
    role, so even service_role (which bypasses RLS entirely) cannot mutate
    an audit log row - immutability does not depend on RLS at all here."""
    conn = _service_conn()
    try:
        with pytest.raises(psycopg.errors.DatabaseError):
            with conn.cursor() as cur:
                cur.execute(
                    "update audit_logs set action = 'TAMPERED-BY-SERVICE-ROLE' where id = %s",
                    (scenario["audit_log_id"],),
                )
        conn.rollback()

        with conn.cursor() as cur:
            cur.execute("select action from audit_logs where id = %s", (scenario["audit_log_id"],))
            row = cur.fetchone()
        assert row is not None
        assert row[0] == "rls_test_seed_action"
    finally:
        conn.close()


# --- 10: service_role is only used in the explicitly privileged module.


def test_normal_ticket_routes_never_import_privileged_module() -> None:
    """Static guard: the ticket/organization read routers must not reach
    for app.core.privileged (service_role). If this ever starts failing, it
    means someone routed normal data access through service_role, which
    would silently bypass RLS - exactly what decision #1 forbids."""
    import inspect

    from app.api.routers import organizations, tickets

    for module in (tickets, organizations):
        source = inspect.getsource(module)
        assert "privileged" not in source, (
            f"{module.__name__} must not use app.core.privileged "
            "(service_role) for normal, RLS-governed data access"
        )
